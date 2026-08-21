-- Small UX fix: /world's "Útoky na cestě" section shows the target
-- territory's owner name (e.g. "hráče hradecak.1987"), but it isn't a
-- clickable link to their home territory like the attacker's name is.
-- Adds target_owner_home_x/y so the UI can render it the same way.
--
-- New output columns, so the function must be dropped first —
-- `create or replace function` cannot change a function's return type.

drop function if exists world_list_attacks_in_transit();

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
  target_owner_id uuid,
  target_owner_display_name text,
  target_owner_is_npc boolean,
  target_owner_home_x integer,
  target_owner_home_y integer,
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
    dest.owner_id,
    dest_owner.display_name,
    coalesce(dest_owner.is_npc, false),
    dest_owner_home.x::integer,
    dest_owner_home.y::integer,
    tm.transfer_arrives_at
  from troop_movements tm
  join players p on p.id = tm.player_id
  left join territories home on home.owner_id = tm.player_id and home.is_home = true
  join territories dest on dest.id = tm.destination_territory_id
  left join players dest_owner on dest_owner.id = dest.owner_id
  left join territories dest_owner_home
    on dest_owner_home.owner_id = dest.owner_id
   and dest_owner_home.is_home = true
  where tm.kind = 'attack'
    and tm.status = 'in_transit'
  order by tm.transfer_arrives_at asc, tm.id asc;
end;
$$;

revoke execute on function world_list_attacks_in_transit() from public, anon;
grant execute on function world_list_attacks_in_transit() to authenticated;
