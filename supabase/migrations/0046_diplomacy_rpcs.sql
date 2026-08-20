-- Diplomacy RPCs.

create or replace function diplomacy_require_player()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from players where id = v_player_id) then
    raise exception 'player % not found', v_player_id;
  end if;

  return v_player_id;
end;
$$;

create or replace function diplomacy_lock_pair(
  p_player_a uuid,
  p_player_b uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtext(least(p_player_a::text, p_player_b::text) || greatest(p_player_a::text, p_player_b::text))
  );
end;
$$;

create or replace function diplomacy_expire_visible_offers(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update diplomacy_offers
  set status = 'expired',
      resolved_at = now()
  where status = 'pending'
    and expires_at <= now()
    and (initiator_id = p_player_id or target_id = p_player_id);
end;
$$;

create or replace function diplomacy_validate_cards(
  p_owner_id uuid,
  p_card_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_id uuid;
  v_owner_id uuid;
  v_status text;
  v_stationed_territory_id integer;
  v_category text;
begin
  if coalesce(array_length(p_card_ids, 1), 0) = 0 then
    return;
  end if;

  if (
    select count(*) from unnest(p_card_ids) as ids(card_id)
  ) <> (
    select count(distinct card_id) from unnest(p_card_ids) as ids(card_id)
  ) then
    raise exception 'offered_card_ids contains duplicate card ids';
  end if;

  foreach v_card_id in array p_card_ids loop
    select ci.owner_id, ci.status, ci.stationed_territory_id, ct.category
    into v_owner_id, v_status, v_stationed_territory_id, v_category
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = v_card_id
    for update of ci;

    if not found then
      raise exception 'offered card % not found', v_card_id;
    end if;

    if v_owner_id <> p_owner_id then
      raise exception 'offered card % is not owned by the caller', v_card_id;
    end if;

    if v_category not in ('unit', 'boost') then
      raise exception 'offered card % must be a unit or boost card', v_card_id;
    end if;

    if v_status <> 'stationed' then
      raise exception 'offered card % is not currently stationed', v_card_id;
    end if;

    if v_stationed_territory_id is not null and (
      exists (
        select 1
        from territories t
        where t.id = v_stationed_territory_id
          and t.battle_locked_by is not null
      )
      or exists (
        select 1
        from battles b
        where b.territory_id = v_stationed_territory_id
          and b.status not in ('resolved', 'expired')
      )
    ) then
      raise exception 'offered card % is stationed on a territory with an unresolved battle', v_card_id;
    end if;
  end loop;
end;
$$;

create or replace function diplomacy_validate_territory(
  p_owner_id uuid,
  p_territory_id integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_territory territories%rowtype;
begin
  if p_territory_id is null then
    return;
  end if;

  select *
  into v_territory
  from territories
  where id = p_territory_id
  for update;

  if not found then
    raise exception 'offered territory % not found', p_territory_id;
  end if;

  if v_territory.owner_id <> p_owner_id then
    raise exception 'offered territory % is not owned by the caller', p_territory_id;
  end if;

  if v_territory.is_home then
    raise exception 'home territory cannot be offered as tribute';
  end if;

  if exists (
    select 1
    from card_instances
    where stationed_territory_id = p_territory_id
  ) then
    raise exception 'offered territory % must have no stationed cards', p_territory_id;
  end if;

  if v_territory.claim_locked_by is not null then
    raise exception 'offered territory % has an active claim in progress', p_territory_id;
  end if;

  if v_territory.battle_locked_by is not null then
    raise exception 'offered territory % has an active battle lock', p_territory_id;
  end if;

  if exists (
    select 1
    from battles
    where territory_id = p_territory_id
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'offered territory % has an unresolved battle', p_territory_id;
  end if;

  if exists (
    select 1
    from troop_movements
    where destination_territory_id = p_territory_id
      and kind in ('attack', 'transfer')
      and status = 'in_transit'
  ) then
    raise exception 'offered territory % has an incoming movement', p_territory_id;
  end if;
end;
$$;

create or replace function diplomacy_get_relation(p_other_player_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
begin
  if p_other_player_id is null or p_other_player_id = v_caller then
    return 'peace';
  end if;

  if exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_caller, p_other_player_id)
      and player_b_id = greatest(v_caller, p_other_player_id)
  ) then
    return 'war';
  end if;

  return 'peace';
end;
$$;

create or replace function diplomacy_list_wars()
returns table (
  other_player_id uuid,
  other_player_display_name text,
  other_kingdom_name text,
  other_home_x integer,
  other_home_y integer,
  war_started_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
begin
  perform diplomacy_expire_visible_offers(v_caller);

  return query
  select
    other.id,
    other.display_name,
    other.kingdom_name,
    home.x::integer,
    home.y::integer,
    r.war_started_at
  from diplomacy_relations r
  join players other
    on other.id = case
      when r.player_a_id = v_caller then r.player_b_id
      else r.player_a_id
    end
  left join territories home
    on home.owner_id = other.id
   and home.is_home = true
  where v_caller in (r.player_a_id, r.player_b_id)
  order by r.war_started_at desc, other.display_name;
end;
$$;

create or replace function diplomacy_list_offers()
returns table (
  id uuid,
  initiator_id uuid,
  initiator_display_name text,
  target_id uuid,
  target_display_name text,
  kind text,
  offered_card_ids uuid[],
  offered_territory_id integer,
  offered_territory_name text,
  offered_territory_x integer,
  offered_territory_y integer,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,
  offered_cards jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
begin
  perform diplomacy_expire_visible_offers(v_caller);

  return query
  select
    o.id,
    o.initiator_id,
    initiator.display_name,
    o.target_id,
    target.display_name,
    o.kind,
    o.offered_card_ids,
    o.offered_territory_id,
    territory.name,
    territory.x::integer,
    territory.y::integer,
    o.status,
    o.created_at,
    o.expires_at,
    o.resolved_at,
    trade_cards_payload(o.offered_card_ids)
  from diplomacy_offers o
  join players initiator on initiator.id = o.initiator_id
  join players target on target.id = o.target_id
  left join territories territory on territory.id = o.offered_territory_id
  where o.status = 'pending'
    and v_caller in (o.initiator_id, o.target_id)
  order by o.created_at desc, o.id desc;
end;
$$;

create or replace function diplomacy_propose_peace(
  p_target_id uuid,
  p_kind text,
  p_offered_card_ids uuid[] default '{}'::uuid[],
  p_offered_territory_id integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_offer_id uuid := gen_random_uuid();
begin
  if p_target_id is null or p_target_id = v_caller then
    raise exception 'target player is invalid';
  end if;

  perform diplomacy_lock_pair(v_caller, p_target_id);
  perform diplomacy_expire_visible_offers(v_caller);

  if not exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_caller, p_target_id)
      and player_b_id = greatest(v_caller, p_target_id)
  ) then
    raise exception 'you are not currently at war with this player';
  end if;

  if exists (
    select 1
    from diplomacy_offers
    where initiator_id = v_caller
      and target_id = p_target_id
      and status = 'pending'
    for update
  ) then
    raise exception 'you already have a pending peace offer for this player';
  end if;

  if p_kind = 'white_peace' then
    if coalesce(array_length(p_offered_card_ids, 1), 0) > 0 or p_offered_territory_id is not null then
      raise exception 'white peace cannot include tribute';
    end if;
  elsif p_kind = 'tribute_peace' then
    if coalesce(array_length(p_offered_card_ids, 1), 0) = 0 and p_offered_territory_id is null then
      raise exception 'tribute peace must include at least one card or one territory';
    end if;

    perform diplomacy_validate_cards(v_caller, p_offered_card_ids);
    perform diplomacy_validate_territory(v_caller, p_offered_territory_id);
  else
    raise exception 'invalid peace offer kind: %', p_kind;
  end if;

  insert into diplomacy_offers (
    id,
    initiator_id,
    target_id,
    kind,
    offered_card_ids,
    offered_territory_id,
    status
  ) values (
    v_offer_id,
    v_caller,
    p_target_id,
    p_kind,
    coalesce(p_offered_card_ids, '{}'::uuid[]),
    p_offered_territory_id,
    'pending'
  );

  return v_offer_id;
end;
$$;

create or replace function diplomacy_accept_peace(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_pair record;
  v_offer diplomacy_offers%rowtype;
  v_target_home_id integer;
  v_target_xp integer;
  v_target_limit integer;
  v_target_deck_count integer;
  v_card_id uuid;
begin
  select initiator_id, target_id
  into v_pair
  from diplomacy_offers
  where id = p_offer_id;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  perform diplomacy_lock_pair(v_pair.initiator_id, v_pair.target_id);
  perform diplomacy_expire_visible_offers(v_caller);

  select *
  into v_offer
  from diplomacy_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  if v_offer.target_id <> v_caller then
    raise exception 'only the target player may accept this peace offer';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'peace offer % is no longer pending', p_offer_id;
  end if;

  if not exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_offer.initiator_id, v_offer.target_id)
      and player_b_id = greatest(v_offer.initiator_id, v_offer.target_id)
  ) then
    raise exception 'this war has already been resolved';
  end if;

  if exists (
    select 1
    from battles
    where status not in ('resolved', 'expired')
      and (
        (attacker_id = v_offer.initiator_id and defender_id = v_offer.target_id)
        or (attacker_id = v_offer.target_id and defender_id = v_offer.initiator_id)
      )
  ) then
    raise exception 'peace cannot be accepted while a battle between these players is still unresolved';
  end if;

  perform diplomacy_validate_cards(v_offer.initiator_id, v_offer.offered_card_ids);
  perform diplomacy_validate_territory(v_offer.initiator_id, v_offer.offered_territory_id);

  select id
  into v_target_home_id
  from territories
  where owner_id = v_caller
    and is_home = true
  for update;

  if not found then
    raise exception 'target player has no home territory';
  end if;

  select xp
  into v_target_xp
  from players
  where id = v_caller
  for update;

  v_target_limit := _deck_limit(_level_for_xp(v_target_xp));

  foreach v_card_id in array coalesce(v_offer.offered_card_ids, '{}'::uuid[]) loop
    update card_instances
    set owner_id = v_caller,
        stationed_territory_id = v_target_home_id,
        status = 'stationed',
        deposit_expires_at = null
    where instance_id = v_card_id;

    select count(*)
    into v_target_deck_count
    from card_instances
    where owner_id = v_caller
      and status in ('stationed', 'in_transit');

    if v_target_deck_count > v_target_limit then
      perform _deposit_or_grant_card(v_caller, v_card_id, 'stationed');
    end if;
  end loop;

  if v_offer.offered_territory_id is not null then
    update territories
    set owner_id = v_caller
    where id = v_offer.offered_territory_id;
  end if;

  delete from diplomacy_relations
  where player_a_id = least(v_offer.initiator_id, v_offer.target_id)
    and player_b_id = greatest(v_offer.initiator_id, v_offer.target_id);

  update diplomacy_offers
  set status = 'accepted',
      resolved_at = now()
  where id = v_offer.id;

  update diplomacy_offers
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, now())
  where status = 'pending'
    and id <> v_offer.id
    and (
      (initiator_id = v_offer.initiator_id and target_id = v_offer.target_id)
      or (initiator_id = v_offer.target_id and target_id = v_offer.initiator_id)
    );

  insert into world_events (event_type, payload)
  select
    'peace_signed',
    jsonb_build_object(
      'player_a_id', a.id,
      'player_a_display_name', a.display_name,
      'player_a_home_x', a_home.x::integer,
      'player_a_home_y', a_home.y::integer,
      'player_b_id', b.id,
      'player_b_display_name', b.display_name,
      'player_b_home_x', b_home.x::integer,
      'player_b_home_y', b_home.y::integer,
      'had_tribute', (
        coalesce(array_length(v_offer.offered_card_ids, 1), 0) > 0
        or v_offer.offered_territory_id is not null
      )
    )
  from players a
  left join territories a_home
    on a_home.owner_id = a.id
   and a_home.is_home = true
  join players b
    on b.id = v_offer.target_id
  left join territories b_home
    on b_home.owner_id = b.id
   and b_home.is_home = true
  where a.id = v_offer.initiator_id;
end;
$$;

create or replace function diplomacy_reject_peace(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_pair record;
  v_offer diplomacy_offers%rowtype;
begin
  select initiator_id, target_id
  into v_pair
  from diplomacy_offers
  where id = p_offer_id;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  perform diplomacy_lock_pair(v_pair.initiator_id, v_pair.target_id);
  perform diplomacy_expire_visible_offers(v_caller);

  select *
  into v_offer
  from diplomacy_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  if v_offer.target_id <> v_caller then
    raise exception 'only the target player may reject this peace offer';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'peace offer % is no longer pending', p_offer_id;
  end if;

  update diplomacy_offers
  set status = 'rejected',
      resolved_at = now()
  where id = p_offer_id;
end;
$$;

create or replace function diplomacy_cancel_peace(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_pair record;
  v_offer diplomacy_offers%rowtype;
begin
  select initiator_id, target_id
  into v_pair
  from diplomacy_offers
  where id = p_offer_id;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  perform diplomacy_lock_pair(v_pair.initiator_id, v_pair.target_id);
  perform diplomacy_expire_visible_offers(v_caller);

  select *
  into v_offer
  from diplomacy_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  if v_offer.initiator_id <> v_caller then
    raise exception 'only the initiator may cancel this peace offer';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'peace offer % is no longer pending', p_offer_id;
  end if;

  update diplomacy_offers
  set status = 'cancelled',
      resolved_at = now()
  where id = p_offer_id;
end;
$$;

revoke execute on function diplomacy_require_player() from public, anon, authenticated;
revoke execute on function diplomacy_lock_pair(uuid, uuid) from public, anon, authenticated;
revoke execute on function diplomacy_expire_visible_offers(uuid) from public, anon, authenticated;
revoke execute on function diplomacy_validate_cards(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function diplomacy_validate_territory(uuid, integer) from public, anon, authenticated;

revoke execute on function diplomacy_get_relation(uuid) from public, anon;
revoke execute on function diplomacy_list_wars() from public, anon;
revoke execute on function diplomacy_list_offers() from public, anon;
revoke execute on function diplomacy_propose_peace(uuid, text, uuid[], integer) from public, anon;
revoke execute on function diplomacy_accept_peace(uuid) from public, anon;
revoke execute on function diplomacy_reject_peace(uuid) from public, anon;
revoke execute on function diplomacy_cancel_peace(uuid) from public, anon;

grant execute on function diplomacy_get_relation(uuid) to authenticated;
grant execute on function diplomacy_list_wars() to authenticated;
grant execute on function diplomacy_list_offers() to authenticated;
grant execute on function diplomacy_propose_peace(uuid, text, uuid[], integer) to authenticated;
grant execute on function diplomacy_accept_peace(uuid) to authenticated;
grant execute on function diplomacy_reject_peace(uuid) to authenticated;
grant execute on function diplomacy_cancel_peace(uuid) to authenticated;
