-- ---------------------------------------------------------------------------
-- 0079_admin_movements_monitor.sql
--
-- 1. admin_list_movements(p_include_history) — security definer admin RPC
--    that resolves due movements then returns a full view of troop_movements
--    joined to players and territories.
-- 2. admin_speed_up_movement(p_movement_id) — admin-only speed-up (no
--    ownership check), replaces the player-facing debug_speed_up_movement.
-- 3. Drop debug_speed_up_movement (no longer needed).
-- ---------------------------------------------------------------------------

create or replace function admin_list_movements(p_include_history boolean default false)
returns table (
  id uuid,
  player_id uuid,
  player_display_name text,
  player_is_npc boolean,
  kind text,
  origin_territory_id integer,
  origin_x integer,
  origin_y integer,
  destination_territory_id integer,
  destination_x integer,
  destination_y integer,
  started_at timestamptz,
  transfer_arrives_at timestamptz,
  status text,
  claim_occupation_completes_at timestamptz,
  cancelled_at timestamptz,
  unit_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform admin_require_admin();
  perform resolve_due_movements();

  return query
  select
    m.id,
    m.player_id,
    pl.display_name as player_display_name,
    pl.is_npc as player_is_npc,
    m.kind,
    m.origin_territory_id,
    o.x::integer as origin_x,
    o.y::integer as origin_y,
    m.destination_territory_id,
    d.x::integer as destination_x,
    d.y::integer as destination_y,
    m.started_at,
    m.transfer_arrives_at,
    m.status,
    d.claim_occupation_completes_at,
    m.cancelled_at,
    (select count(*) from troop_movement_units tmu where tmu.movement_id = m.id) as unit_count
  from troop_movements m
  join players pl on pl.id = m.player_id
  join territories o on o.id = m.origin_territory_id
  join territories d on d.id = m.destination_territory_id
  where p_include_history or m.status in ('in_transit', 'occupying')
  order by
    case when m.status in ('in_transit', 'occupying') then 0 else 1 end,
    case when m.status in ('in_transit', 'occupying') then extract(epoch from m.transfer_arrives_at) end asc nulls last,
    m.started_at desc
  limit 200;
end;
$$;

create or replace function admin_speed_up_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement record;
begin
  perform admin_require_admin();

  select * into v_movement
  from troop_movements
  where id = p_movement_id;

  if not found then
    raise exception 'movement % not found', p_movement_id;
  end if;

  if v_movement.status = 'in_transit' then
    update troop_movements
    set transfer_arrives_at = now() + interval '10 seconds'
    where id = p_movement_id;

    if v_movement.kind = 'claim' then
      update territories
      set claim_transfer_arrives_at = now() + interval '10 seconds',
          claim_occupation_completes_at = now() + interval '20 seconds'
      where id = v_movement.destination_territory_id;
    end if;
  elsif v_movement.status = 'occupying' and v_movement.kind = 'claim' then
    update territories
    set claim_occupation_completes_at = now() + interval '10 seconds'
    where id = v_movement.destination_territory_id;
  else
    raise exception 'movement is not in a speed-up-able state';
  end if;

  perform resolve_due_movements();
end;
$$;

-- Drop the player-facing debug RPC (replaced by admin_speed_up_movement)
revoke execute on function debug_speed_up_movement(uuid) from public, anon, authenticated;
drop function if exists debug_speed_up_movement(uuid);
