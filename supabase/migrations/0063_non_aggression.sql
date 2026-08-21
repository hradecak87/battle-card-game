-- Non-aggression pact RPCs + diplomacy_declare_war extension for pact
-- breaking and coalition-member rejection.

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
    from coalition_members cm_self
    join coalition_members cm_other
      on cm_other.coalition_id = cm_self.coalition_id
     and cm_other.player_id = p_other_player_id
    join coalitions c
      on c.id = cm_self.coalition_id
    where cm_self.player_id = v_caller
      and c.disbanded_at is null
  ) then
    return 'coalition';
  end if;

  if exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_caller, p_other_player_id)
      and player_b_id = greatest(v_caller, p_other_player_id)
      and state = 'war'
  ) then
    return 'war';
  end if;

  if exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_caller, p_other_player_id)
      and player_b_id = greatest(v_caller, p_other_player_id)
      and state = 'non_aggression'
  ) then
    return 'non_aggression';
  end if;

  return 'peace';
end;
$$;

create or replace function diplomacy_list_non_aggression_pacts()
returns table (
  other_player_id uuid,
  other_player_display_name text,
  other_kingdom_name text,
  other_home_x integer,
  other_home_y integer,
  pact_started_at timestamptz
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
    r.created_at
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
    and r.state = 'non_aggression'
  order by r.created_at desc, other.display_name;
end;
$$;

create or replace function diplomacy_propose_non_aggression(p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_offer_id uuid := gen_random_uuid();
  v_target_is_npc boolean;
begin
  if p_target_id is null or p_target_id = v_caller then
    raise exception 'target player is invalid';
  end if;

  select coalesce(is_npc, false)
  into v_target_is_npc
  from players
  where id = p_target_id;

  if not found then
    raise exception 'target player not found';
  end if;

  if v_target_is_npc then
    raise exception 'cannot propose a non-aggression pact to an NPC kingdom';
  end if;

  perform diplomacy_lock_pair(v_caller, p_target_id);
  perform diplomacy_expire_visible_offers(v_caller);

  if exists (
    select 1
    from coalition_members cm_self
    join coalition_members cm_other
      on cm_other.coalition_id = cm_self.coalition_id
     and cm_other.player_id = p_target_id
    join coalitions c
      on c.id = cm_self.coalition_id
    where cm_self.player_id = v_caller
      and c.disbanded_at is null
  ) then
    raise exception 'you already share a coalition with this player';
  end if;

  if exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_caller, p_target_id)
      and player_b_id = greatest(v_caller, p_target_id)
      and state = 'war'
  ) then
    raise exception 'resolve the war with this player first';
  end if;

  if exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_caller, p_target_id)
      and player_b_id = greatest(v_caller, p_target_id)
      and state = 'non_aggression'
  ) then
    raise exception 'you already have a non-aggression pact with this player';
  end if;

  if exists (
    select 1
    from diplomacy_offers
    where status = 'pending'
      and kind = 'non_aggression'
      and (
        (initiator_id = v_caller and target_id = p_target_id)
        or (initiator_id = p_target_id and target_id = v_caller)
      )
    for update
  ) then
    raise exception 'there is already a pending non-aggression proposal for this pair';
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
    'non_aggression',
    '{}'::uuid[],
    null,
    'pending'
  );

  perform _notify(
    p_target_id,
    'peace_offer_received',
    (
      select jsonb_build_object(
        'offer_id', v_offer_id,
        'other_player_id', v_caller,
        'other_display_name', p.display_name
      )
      from players p
      where p.id = v_caller
    )
  );

  return v_offer_id;
end;
$$;

create or replace function diplomacy_accept_non_aggression(p_offer_id uuid)
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
    raise exception 'non-aggression offer % not found', p_offer_id;
  end if;

  perform diplomacy_lock_pair(v_pair.initiator_id, v_pair.target_id);
  perform diplomacy_expire_visible_offers(v_caller);

  select *
  into v_offer
  from diplomacy_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'non-aggression offer % not found', p_offer_id;
  end if;

  if v_offer.kind <> 'non_aggression' then
    raise exception 'offer % is not a non-aggression proposal', p_offer_id;
  end if;

  if v_offer.target_id <> v_caller then
    raise exception 'only the target player may accept this non-aggression proposal';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'non-aggression offer % is no longer pending', p_offer_id;
  end if;

  if exists (
    select 1
    from coalition_members cm_self
    join coalition_members cm_other
      on cm_other.coalition_id = cm_self.coalition_id
     and cm_other.player_id = v_offer.initiator_id
    join coalitions c
      on c.id = cm_self.coalition_id
    where cm_self.player_id = v_offer.target_id
      and c.disbanded_at is null
  ) then
    raise exception 'you already share a coalition with this player';
  end if;

  if exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_offer.initiator_id, v_offer.target_id)
      and player_b_id = greatest(v_offer.initiator_id, v_offer.target_id)
      and state = 'war'
  ) then
    raise exception 'resolve the war with this player first';
  end if;

  if exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_offer.initiator_id, v_offer.target_id)
      and player_b_id = greatest(v_offer.initiator_id, v_offer.target_id)
      and state = 'non_aggression'
  ) then
    raise exception 'you already have a non-aggression pact with this player';
  end if;

  delete from diplomacy_relations
  where player_a_id = least(v_offer.initiator_id, v_offer.target_id)
    and player_b_id = greatest(v_offer.initiator_id, v_offer.target_id);

  insert into diplomacy_relations (
    player_a_id,
    player_b_id,
    state,
    war_started_at
  )
  values (
    least(v_offer.initiator_id, v_offer.target_id),
    greatest(v_offer.initiator_id, v_offer.target_id),
    'non_aggression',
    now()
  );

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
    'non_aggression_signed',
    jsonb_build_object(
      'player_a_id', a.id,
      'player_a_display_name', a.display_name,
      'player_a_home_x', a_home.x::integer,
      'player_a_home_y', a_home.y::integer,
      'player_b_id', b.id,
      'player_b_display_name', b.display_name,
      'player_b_home_x', b_home.x::integer,
      'player_b_home_y', b_home.y::integer
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

create or replace function diplomacy_reject_non_aggression(p_offer_id uuid)
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
    raise exception 'non-aggression offer % not found', p_offer_id;
  end if;

  perform diplomacy_lock_pair(v_pair.initiator_id, v_pair.target_id);
  perform diplomacy_expire_visible_offers(v_caller);

  select *
  into v_offer
  from diplomacy_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'non-aggression offer % not found', p_offer_id;
  end if;

  if v_offer.kind <> 'non_aggression' then
    raise exception 'offer % is not a non-aggression proposal', p_offer_id;
  end if;

  if v_offer.target_id <> v_caller then
    raise exception 'only the target player may reject this non-aggression proposal';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'non-aggression offer % is no longer pending', p_offer_id;
  end if;

  update diplomacy_offers
  set status = 'rejected',
      resolved_at = now()
  where id = p_offer_id;
end;
$$;

create or replace function diplomacy_cancel_non_aggression(p_offer_id uuid)
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
    raise exception 'non-aggression offer % not found', p_offer_id;
  end if;

  perform diplomacy_lock_pair(v_pair.initiator_id, v_pair.target_id);
  perform diplomacy_expire_visible_offers(v_caller);

  select *
  into v_offer
  from diplomacy_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'non-aggression offer % not found', p_offer_id;
  end if;

  if v_offer.kind <> 'non_aggression' then
    raise exception 'offer % is not a non-aggression proposal', p_offer_id;
  end if;

  if v_offer.initiator_id <> v_caller then
    raise exception 'only the initiator may cancel this non-aggression proposal';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'non-aggression offer % is no longer pending', p_offer_id;
  end if;

  update diplomacy_offers
  set status = 'cancelled',
      resolved_at = now()
  where id = p_offer_id;
end;
$$;

create or replace function diplomacy_declare_war(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_target_is_npc boolean;
  v_relation_state text;
begin
  if p_target_id = v_caller then
    raise exception 'cannot declare war on yourself';
  end if;

  select coalesce(is_npc, false)
  into v_target_is_npc
  from players
  where id = p_target_id;

  if not found then
    raise exception 'target player not found';
  end if;

  if v_target_is_npc then
    raise exception 'cannot declare war on an NPC kingdom';
  end if;

  perform diplomacy_lock_pair(v_caller, p_target_id);

  if exists (
    select 1
    from coalition_members cm_self
    join coalition_members cm_other
      on cm_other.coalition_id = cm_self.coalition_id
     and cm_other.player_id = p_target_id
    join coalitions c
      on c.id = cm_self.coalition_id
    where cm_self.player_id = v_caller
      and c.disbanded_at is null
  ) then
    raise exception 'cannot declare war on a coalition member';
  end if;

  select state
  into v_relation_state
  from diplomacy_relations
  where player_a_id = least(v_caller, p_target_id)
    and player_b_id = greatest(v_caller, p_target_id)
  for update;

  if v_relation_state = 'war' then
    raise exception 'already at war with this player';
  end if;

  if v_relation_state = 'non_aggression' then
    delete from diplomacy_relations
    where player_a_id = least(v_caller, p_target_id)
      and player_b_id = greatest(v_caller, p_target_id);

    insert into world_events (event_type, payload)
    select
      'non_aggression_broken',
      jsonb_build_object(
        'player_a_id', a.id,
        'player_a_display_name', a.display_name,
        'player_a_home_x', a_home.x::integer,
        'player_a_home_y', a_home.y::integer,
        'player_b_id', b.id,
        'player_b_display_name', b.display_name,
        'player_b_home_x', b_home.x::integer,
        'player_b_home_y', b_home.y::integer
      )
    from players a
    left join territories a_home
      on a_home.owner_id = a.id
     and a_home.is_home = true
    join players b
      on b.id = p_target_id
    left join territories b_home
      on b_home.owner_id = b.id
     and b_home.is_home = true
    where a.id = v_caller;
  end if;

  insert into diplomacy_relations (
    player_a_id,
    player_b_id,
    state,
    war_started_at
  )
  values (
    least(v_caller, p_target_id),
    greatest(v_caller, p_target_id),
    'war',
    now()
  );

  insert into world_events (event_type, payload)
  select
    'war_declared',
    jsonb_build_object(
      'attacker_id', attacker.id,
      'attacker_display_name', attacker.display_name,
      'attacker_home_x', attacker_home.x::integer,
      'attacker_home_y', attacker_home.y::integer,
      'defender_id', defender.id,
      'defender_display_name', defender.display_name,
      'defender_home_x', defender_home.x::integer,
      'defender_home_y', defender_home.y::integer
    )
  from players attacker
  left join territories attacker_home
    on attacker_home.owner_id = attacker.id
   and attacker_home.is_home = true
  join players defender
    on defender.id = p_target_id
  left join territories defender_home
    on defender_home.owner_id = defender.id
   and defender_home.is_home = true
  where attacker.id = v_caller;

  perform _notify(
    v_caller,
    'war_declared',
    (
      select jsonb_build_object(
        'other_player_id', defender.id,
        'other_display_name', defender.display_name
      )
      from players defender
      where defender.id = p_target_id
    )
  );

  perform _notify(
    p_target_id,
    'war_declared',
    (
      select jsonb_build_object(
        'other_player_id', attacker.id,
        'other_display_name', attacker.display_name
      )
      from players attacker
      where attacker.id = v_caller
    )
  );
end;
$$;

revoke execute on function diplomacy_get_relation(uuid) from public, anon;
revoke execute on function diplomacy_list_non_aggression_pacts() from public, anon;
revoke execute on function diplomacy_propose_non_aggression(uuid) from public, anon;
revoke execute on function diplomacy_accept_non_aggression(uuid) from public, anon;
revoke execute on function diplomacy_reject_non_aggression(uuid) from public, anon;
revoke execute on function diplomacy_cancel_non_aggression(uuid) from public, anon;
revoke execute on function diplomacy_declare_war(uuid) from public, anon;

grant execute on function diplomacy_get_relation(uuid) to authenticated;
grant execute on function diplomacy_list_non_aggression_pacts() to authenticated;
grant execute on function diplomacy_propose_non_aggression(uuid) to authenticated;
grant execute on function diplomacy_accept_non_aggression(uuid) to authenticated;
grant execute on function diplomacy_reject_non_aggression(uuid) to authenticated;
grant execute on function diplomacy_cancel_non_aggression(uuid) to authenticated;
grant execute on function diplomacy_declare_war(uuid) to authenticated;
