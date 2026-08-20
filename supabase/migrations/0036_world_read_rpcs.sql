create or replace function world_list_attacks_in_transit()
returns table (
  movement_id uuid,
  attacker_id uuid,
  attacker_display_name text,
  attacker_home_x integer,
  attacker_home_y integer,
  target_territory_id integer,
  target_x integer,
  target_y integer,
  arrives_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  return query
  select
    tm.id,
    tm.player_id,
    p.display_name,
    home.x::integer,
    home.y::integer,
    tm.destination_territory_id,
    dest.x::integer,
    dest.y::integer,
    tm.transfer_arrives_at
  from troop_movements tm
  join players p on p.id = tm.player_id
  left join territories home on home.owner_id = tm.player_id and home.is_home = true
  join territories dest on dest.id = tm.destination_territory_id
  where tm.kind = 'attack'
    and tm.status = 'in_transit'
  order by tm.transfer_arrives_at asc, tm.id asc;
end;
$$;

revoke execute on function world_list_attacks_in_transit() from public, anon;
grant execute on function world_list_attacks_in_transit() to authenticated;

create or replace function world_list_claims_in_progress()
returns table (
  territory_id integer,
  claimant_id uuid,
  claimant_display_name text,
  claimant_home_x integer,
  claimant_home_y integer,
  territory_x integer,
  territory_y integer,
  claim_completes_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  return query
  select
    t.id,
    p.id,
    p.display_name,
    home.x::integer,
    home.y::integer,
    t.x::integer,
    t.y::integer,
    t.claim_occupation_completes_at
  from territories t
  join players p on p.id = t.claim_locked_by
  left join territories home on home.owner_id = p.id and home.is_home = true
  where t.claim_locked_by is not null
  order by t.claim_occupation_completes_at asc, t.id asc;
end;
$$;

revoke execute on function world_list_claims_in_progress() from public, anon;
grant execute on function world_list_claims_in_progress() to authenticated;

create or replace function world_list_active_battles()
returns table (
  battle_id uuid,
  attacker_id uuid,
  attacker_display_name text,
  attacker_home_x integer,
  attacker_home_y integer,
  defender_id uuid,
  defender_display_name text,
  defender_home_x integer,
  defender_home_y integer,
  territory_id integer,
  territory_x integer,
  territory_y integer,
  status text,
  current_round integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  return query
  select
    b.id,
    attacker.id,
    attacker.display_name,
    attacker_home.x::integer,
    attacker_home.y::integer,
    defender.id,
    defender.display_name,
    defender_home.x::integer,
    defender_home.y::integer,
    territory.id,
    territory.x::integer,
    territory.y::integer,
    b.status,
    b.current_round
  from battles b
  join players attacker on attacker.id = b.attacker_id
  left join territories attacker_home
    on attacker_home.owner_id = attacker.id
   and attacker_home.is_home = true
  left join players defender on defender.id = b.defender_id
  left join territories defender_home
    on defender_home.owner_id = defender.id
   and defender_home.is_home = true
  join territories territory on territory.id = b.territory_id
  where b.status in ('awaiting_ready', 'active')
  order by b.created_at desc, b.id desc;
end;
$$;

revoke execute on function world_list_active_battles() from public, anon;
grant execute on function world_list_active_battles() to authenticated;

create or replace function world_list_events(
  p_page integer default 0,
  p_page_size integer default 10
)
returns table (
  event_type text,
  created_at timestamptz,
  payload jsonb,
  total_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 0), 0);
  v_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 10);
  v_total integer;
  v_offset integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select least(count(*), 50)
  into v_total
  from world_events;

  v_offset := v_page * v_page_size;
  if v_offset >= v_total then
    return;
  end if;

  return query
  with limited_events as (
    select we.event_type, we.created_at, we.payload, we.id
    from world_events we
    order by we.created_at desc, we.id desc
    limit 50
  )
  select
    le.event_type,
    le.created_at,
    le.payload,
    v_total
  from limited_events le
  order by le.created_at desc, le.id desc
  limit v_page_size
  offset v_offset;
end;
$$;

revoke execute on function world_list_events(integer, integer) from public, anon;
grant execute on function world_list_events(integer, integer) to authenticated;
