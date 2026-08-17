-- Trading / Exchange ("Směnárna")
--
-- Adds asynchronous direct trades, public marketplace listings, counter-
-- offers, and lazy expiration (same no-cron pattern as resolve_due_battles()).

create table trade_offers (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'public')),
  status text not null default 'pending'
    check (status in ('pending', 'countered', 'accepted', 'rejected', 'cancelled', 'expired')),
  initiator_id uuid not null references players(id),
  target_player_id uuid references players(id),
  parent_offer_id uuid references trade_offers(id),
  root_offer_id uuid not null references trade_offers(id),
  offered_card_ids uuid[] not null,
  requested_card_ids uuid[],
  requested_criteria jsonb,
  message text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  check (
    (type = 'public' and target_player_id is null)
    or (type = 'direct' and target_player_id is not null)
  )
);

create index trade_offers_target_idx on trade_offers (target_player_id, status);
create index trade_offers_initiator_idx on trade_offers (initiator_id, status);
create index trade_offers_expires_idx on trade_offers (expires_at)
  where status in ('pending');
create index trade_offers_public_idx on trade_offers (status)
  where type = 'public';

alter table trade_offers enable row level security;
create policy trade_offers_select_all on trade_offers for select using (true);

create or replace function trade_require_player()
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

create or replace function trade_assert_pending_limit(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending_count integer;
begin
  select count(*)
  into v_pending_count
  from trade_offers
  where initiator_id = p_player_id
    and status = 'pending';

  if v_pending_count >= 10 then
    raise exception 'active trade-offer cap (10) reached';
  end if;
end;
$$;

create or replace function trade_validate_card_bundle(
  p_card_ids uuid[],
  p_expected_owner uuid,
  p_require_eligibility boolean,
  p_label text
) returns void
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
  if p_card_ids is null or coalesce(array_length(p_card_ids, 1), 0) = 0 then
    raise exception '% must contain at least one card', p_label;
  end if;

  if (
    select count(*) from unnest(p_card_ids) as ids(card_id)
  ) <> (
    select count(distinct card_id) from unnest(p_card_ids) as ids(card_id)
  ) then
    raise exception '% contains duplicate card ids', p_label;
  end if;

  foreach v_card_id in array p_card_ids loop
    select ci.owner_id, ci.status, ci.stationed_territory_id, ct.category
    into v_owner_id, v_status, v_stationed_territory_id, v_category
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = v_card_id;

    if not found then
      raise exception '% card % not found', p_label, v_card_id;
    end if;

    if v_category <> 'unit' then
      raise exception '% card % is not a unit card', p_label, v_card_id;
    end if;

    if p_expected_owner is not null and v_owner_id <> p_expected_owner then
      raise exception '% card % does not belong to the expected player', p_label, v_card_id;
    end if;

    if p_require_eligibility then
      if v_status <> 'stationed' then
        raise exception '% card % is not trade-eligible (status %)', p_label, v_card_id, v_status;
      end if;

      if v_stationed_territory_id is not null and (
        exists (
          select 1
          from battles b
          where b.territory_id = v_stationed_territory_id
            and b.status not in ('resolved', 'expired')
        )
        or exists (
          select 1
          from territories t
          where t.id = v_stationed_territory_id
            and t.battle_locked_by is not null
        )
      ) then
        raise exception '% card % is currently involved in an active battle', p_label, v_card_id;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function trade_cards_payload(p_card_ids uuid[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  with ids as (
    select card_id, ord
    from unnest(coalesce(p_card_ids, '{}'::uuid[])) with ordinality as t(card_id, ord)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'instance_id', ci.instance_id,
        'template_id', ci.template_id,
        'owner_id', ci.owner_id,
        'stationed_territory_id', ci.stationed_territory_id,
        'status', ci.status,
        'template_name', ct.name,
        'template_rank', ct.rank,
        'template_unit_type', ct.unit_type,
        'template_flavor_text', ct.flavor_text,
        'template_base_stats', ct.base_stats,
        'template_total_supply', ct.total_supply
      )
      order by ids.ord
    ),
    '[]'::jsonb
  )
  from ids
  join card_instances ci on ci.instance_id = ids.card_id
  join card_templates ct on ct.id = ci.template_id;
$$;

create or replace function resolve_expired_trade_offers()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update trade_offers
  set status = 'expired',
      resolved_at = now()
  where status = 'pending'
    and expires_at <= now();
end;
$$;

create or replace function create_trade_offer(
  p_type text,
  p_target_player_id uuid default null,
  p_offered_card_ids uuid[] default null,
  p_requested_card_ids uuid[] default null,
  p_requested_criteria jsonb default null,
  p_message text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := trade_require_player();
  v_offer_id uuid := gen_random_uuid();
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();
  perform trade_assert_pending_limit(v_caller);
  perform trade_validate_card_bundle(p_offered_card_ids, v_caller, true, 'offered_card_ids');

  if p_type not in ('direct', 'public') then
    raise exception 'invalid trade offer type: %', p_type;
  end if;

  if p_type = 'direct' then
    if p_target_player_id is null then
      raise exception 'direct offers require a target player';
    end if;
    if p_target_player_id = v_caller then
      raise exception 'cannot create a direct offer targeting yourself';
    end if;
    if p_requested_criteria is not null then
      raise exception 'direct offers do not accept requested_criteria';
    end if;

    perform trade_validate_card_bundle(
      p_requested_card_ids,
      p_target_player_id,
      false,
      'requested_card_ids'
    );
  else
    if p_target_player_id is not null then
      raise exception 'public offers cannot target a specific player';
    end if;
    if p_requested_card_ids is not null and coalesce(array_length(p_requested_card_ids, 1), 0) > 0 then
      raise exception 'public offers cannot include requested_card_ids';
    end if;
  end if;

  insert into trade_offers (
    id,
    type,
    status,
    initiator_id,
    target_player_id,
    parent_offer_id,
    root_offer_id,
    offered_card_ids,
    requested_card_ids,
    requested_criteria,
    message,
    expires_at
  ) values (
    v_offer_id,
    p_type,
    'pending',
    v_caller,
    p_target_player_id,
    null,
    v_offer_id,
    p_offered_card_ids,
    case when p_type = 'direct' then p_requested_card_ids else null end,
    case when p_type = 'public' then p_requested_criteria else null end,
    nullif(trim(p_message), ''),
    now() + interval '3 days'
  );

  return v_offer_id;
end;
$$;

create or replace function counter_trade_offer(
  p_parent_offer_id uuid,
  p_offered_card_ids uuid[],
  p_requested_card_ids uuid[] default null,
  p_message text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := trade_require_player();
  v_parent trade_offers%rowtype;
  v_offer_id uuid := gen_random_uuid();
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();

  select *
  into v_parent
  from trade_offers
  where id = p_parent_offer_id
  for update;

  if not found then
    raise exception 'trade offer % not found', p_parent_offer_id;
  end if;
  if v_parent.status <> 'pending' then
    raise exception 'trade offer % is not pending', p_parent_offer_id;
  end if;
  if v_parent.target_player_id is null then
    raise exception 'public listings must be answered via respond_to_public_offer()';
  end if;
  if v_parent.target_player_id <> v_caller then
    raise exception 'only the current target may counter this offer';
  end if;

  perform trade_assert_pending_limit(v_caller);
  perform trade_validate_card_bundle(p_offered_card_ids, v_caller, true, 'offered_card_ids');
  perform trade_validate_card_bundle(
    p_requested_card_ids,
    v_parent.initiator_id,
    false,
    'requested_card_ids'
  );

  update trade_offers
  set status = 'countered',
      resolved_at = now()
  where id = v_parent.id;

  insert into trade_offers (
    id,
    type,
    status,
    initiator_id,
    target_player_id,
    parent_offer_id,
    root_offer_id,
    offered_card_ids,
    requested_card_ids,
    requested_criteria,
    message,
    expires_at
  ) values (
    v_offer_id,
    'direct',
    'pending',
    v_caller,
    v_parent.initiator_id,
    v_parent.id,
    v_parent.root_offer_id,
    p_offered_card_ids,
    p_requested_card_ids,
    null,
    nullif(trim(p_message), ''),
    now() + interval '3 days'
  );

  return v_offer_id;
end;
$$;

create or replace function respond_to_public_offer(
  p_public_offer_id uuid,
  p_offered_card_ids uuid[],
  p_message text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := trade_require_player();
  v_public_offer trade_offers%rowtype;
  v_offer_id uuid := gen_random_uuid();
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();

  select *
  into v_public_offer
  from trade_offers
  where id = p_public_offer_id
  for update;

  if not found then
    raise exception 'public trade offer % not found', p_public_offer_id;
  end if;
  if v_public_offer.type <> 'public' then
    raise exception 'offer % is not a public listing', p_public_offer_id;
  end if;
  if v_public_offer.status <> 'pending' then
    raise exception 'public listing % is not pending', p_public_offer_id;
  end if;
  if v_public_offer.initiator_id = v_caller then
    raise exception 'cannot respond to your own public listing';
  end if;

  perform trade_assert_pending_limit(v_caller);
  perform trade_validate_card_bundle(p_offered_card_ids, v_caller, true, 'offered_card_ids');

  insert into trade_offers (
    id,
    type,
    status,
    initiator_id,
    target_player_id,
    parent_offer_id,
    root_offer_id,
    offered_card_ids,
    requested_card_ids,
    requested_criteria,
    message,
    expires_at
  ) values (
    v_offer_id,
    'direct',
    'pending',
    v_caller,
    v_public_offer.initiator_id,
    v_public_offer.id,
    v_public_offer.root_offer_id,
    p_offered_card_ids,
    null,
    null,
    nullif(trim(p_message), ''),
    now() + interval '3 days'
  );

  return v_offer_id;
end;
$$;

create or replace function accept_trade_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := trade_require_player();
  v_offer trade_offers%rowtype;
  v_root_public trade_offers%rowtype;
  v_root_offer trade_offers%rowtype;
  v_target_bundle uuid[];
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();

  select *
  into v_offer
  from trade_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'trade offer % not found', p_offer_id;
  end if;
  if v_offer.type <> 'direct' then
    raise exception 'public listings cannot be accepted directly';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'trade offer % is not pending', p_offer_id;
  end if;
  if v_offer.target_player_id <> v_caller then
    raise exception 'only the current target may accept this offer';
  end if;

  select *
  into v_root_offer
  from trade_offers
  where id = v_offer.root_offer_id
  for update;

  if found and v_root_offer.type = 'public' then
    v_root_public := v_root_offer;
  end if;

  perform trade_validate_card_bundle(v_offer.offered_card_ids, v_offer.initiator_id, true, 'offered_card_ids');

  if coalesce(array_length(v_offer.requested_card_ids, 1), 0) > 0 then
    v_target_bundle := v_offer.requested_card_ids;
    perform trade_validate_card_bundle(v_target_bundle, v_caller, true, 'requested_card_ids');
  else
    if v_root_public.id is null then
      raise exception 'trade offer % has no valid public root listing to accept against', p_offer_id;
    end if;
    if v_root_public.status <> 'pending' then
      raise exception 'root public listing % is no longer active', v_root_public.id;
    end if;
    if v_root_public.initiator_id <> v_caller then
      raise exception 'only the public listing owner may accept this response';
    end if;

    v_target_bundle := v_root_public.offered_card_ids;
    perform trade_validate_card_bundle(v_target_bundle, v_caller, true, 'root_public_offered_card_ids');
  end if;

  if exists (
    select 1
    from unnest(v_offer.offered_card_ids) as a(card_id)
    join unnest(v_target_bundle) as b(card_id)
      on a.card_id = b.card_id
  ) then
    raise exception 'the same card cannot appear on both sides of a trade';
  end if;

  update card_instances
  set owner_id = v_caller
  where instance_id = any(v_offer.offered_card_ids);

  update card_instances
  set owner_id = v_offer.initiator_id
  where instance_id = any(v_target_bundle);

  update trade_offers
  set status = 'accepted',
      resolved_at = now()
  where id = v_offer.id;

  if v_root_public.id is not null then
    update trade_offers
    set status = 'accepted',
        resolved_at = coalesce(resolved_at, now())
    where id = v_root_public.id;

    update trade_offers
    set status = 'cancelled',
        resolved_at = coalesce(resolved_at, now())
    where root_offer_id = v_root_public.id
      and id <> v_offer.id
      and type = 'direct'
      and status = 'pending';
  end if;
end;
$$;

create or replace function reject_trade_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := trade_require_player();
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();

  update trade_offers
  set status = 'rejected',
      resolved_at = now()
  where id = p_offer_id
    and type = 'direct'
    and status = 'pending'
    and target_player_id = v_caller;

  if not found then
    raise exception 'only the current target may reject a pending direct offer';
  end if;
end;
$$;

create or replace function cancel_trade_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := trade_require_player();
  v_offer trade_offers%rowtype;
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();

  select *
  into v_offer
  from trade_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'trade offer % not found', p_offer_id;
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'only pending offers can be cancelled';
  end if;
  if v_offer.initiator_id <> v_caller then
    raise exception 'only the current initiator may cancel this offer';
  end if;

  update trade_offers
  set status = 'cancelled',
      resolved_at = now()
  where id = v_offer.id;

  if v_offer.type = 'public' then
    update trade_offers
    set status = 'cancelled',
        resolved_at = coalesce(resolved_at, now())
    where root_offer_id = v_offer.id
      and id <> v_offer.id
      and type = 'direct'
      and status = 'pending';
  end if;
end;
$$;

create or replace function list_my_trade_offers()
returns table (
  id uuid,
  type text,
  status text,
  initiator_id uuid,
  initiator_display_name text,
  target_player_id uuid,
  target_display_name text,
  parent_offer_id uuid,
  root_offer_id uuid,
  offered_card_ids uuid[],
  requested_card_ids uuid[],
  requested_criteria jsonb,
  message text,
  created_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,
  offered_cards jsonb,
  requested_cards jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := trade_require_player();
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();

  return query
  select
    o.id,
    o.type,
    o.status,
    o.initiator_id,
    initiator.display_name,
    o.target_player_id,
    target.display_name,
    o.parent_offer_id,
    o.root_offer_id,
    o.offered_card_ids,
    o.requested_card_ids,
    o.requested_criteria,
    o.message,
    o.created_at,
    o.expires_at,
    o.resolved_at,
    trade_cards_payload(o.offered_card_ids) as offered_cards,
    case
      when coalesce(array_length(o.requested_card_ids, 1), 0) > 0 then trade_cards_payload(o.requested_card_ids)
      when root.type = 'public' then trade_cards_payload(root.offered_card_ids)
      else '[]'::jsonb
    end as requested_cards
  from trade_offers o
  join players initiator on initiator.id = o.initiator_id
  left join players target on target.id = o.target_player_id
  left join trade_offers root on root.id = o.root_offer_id
  where o.type = 'direct'
    and (o.initiator_id = v_caller or o.target_player_id = v_caller)
  order by o.created_at desc;
end;
$$;

create or replace function list_public_trade_marketplace(
  p_rank text default null,
  p_unit_type text default null,
  p_owner_name text default null
) returns table (
  id uuid,
  type text,
  status text,
  initiator_id uuid,
  initiator_display_name text,
  target_player_id uuid,
  target_display_name text,
  parent_offer_id uuid,
  root_offer_id uuid,
  offered_card_ids uuid[],
  requested_card_ids uuid[],
  requested_criteria jsonb,
  message text,
  created_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,
  offered_cards jsonb,
  requested_cards jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();

  return query
  select
    o.id,
    o.type,
    o.status,
    o.initiator_id,
    initiator.display_name,
    o.target_player_id,
    null::text as target_display_name,
    o.parent_offer_id,
    o.root_offer_id,
    o.offered_card_ids,
    o.requested_card_ids,
    o.requested_criteria,
    o.message,
    o.created_at,
    o.expires_at,
    o.resolved_at,
    trade_cards_payload(o.offered_card_ids) as offered_cards,
    '[]'::jsonb as requested_cards
  from trade_offers o
  join players initiator on initiator.id = o.initiator_id
  where o.type = 'public'
    and o.status = 'pending'
    and (p_owner_name is null or initiator.display_name ilike '%' || p_owner_name || '%')
    and (
      p_rank is null
      or o.requested_criteria ->> 'rank' = p_rank
      or exists (
        select 1
        from unnest(o.offered_card_ids) as ids(card_id)
        join card_instances ci on ci.instance_id = ids.card_id
        join card_templates ct on ct.id = ci.template_id
        where ct.rank = p_rank
      )
    )
    and (
      p_unit_type is null
      or o.requested_criteria ->> 'unit_type' = p_unit_type
      or exists (
        select 1
        from unnest(o.offered_card_ids) as ids(card_id)
        join card_instances ci on ci.instance_id = ids.card_id
        join card_templates ct on ct.id = ci.template_id
        where ct.unit_type = p_unit_type
      )
    )
  order by o.created_at desc;
end;
$$;

create or replace function list_trade_history()
returns table (
  id uuid,
  type text,
  status text,
  initiator_id uuid,
  initiator_display_name text,
  target_player_id uuid,
  target_display_name text,
  parent_offer_id uuid,
  root_offer_id uuid,
  offered_card_ids uuid[],
  requested_card_ids uuid[],
  requested_criteria jsonb,
  message text,
  created_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,
  offered_cards jsonb,
  requested_cards jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();

  return query
  select
    o.id,
    o.type,
    o.status,
    o.initiator_id,
    initiator.display_name,
    o.target_player_id,
    target.display_name,
    o.parent_offer_id,
    o.root_offer_id,
    o.offered_card_ids,
    o.requested_card_ids,
    o.requested_criteria,
    o.message,
    o.created_at,
    o.expires_at,
    o.resolved_at,
    trade_cards_payload(o.offered_card_ids) as offered_cards,
    case
      when coalesce(array_length(o.requested_card_ids, 1), 0) > 0 then trade_cards_payload(o.requested_card_ids)
      when root.type = 'public' then trade_cards_payload(root.offered_card_ids)
      else '[]'::jsonb
    end as requested_cards
  from trade_offers o
  join players initiator on initiator.id = o.initiator_id
  left join players target on target.id = o.target_player_id
  left join trade_offers root on root.id = o.root_offer_id
  where o.type = 'direct'
    and o.status = 'accepted'
  order by coalesce(o.resolved_at, o.created_at) desc;
end;
$$;
