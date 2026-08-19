-- Adds visibility into incoming attacks for the defending side (backlog
-- follow-up after NPC kingdoms went live): previously `battle_locked_by`
-- only signalled *that* a territory was under attack, with no way to see
-- *who* was attacking or a link to their home, and `get_my_movements()`
-- only ever returned movements the caller personally sent (so a defender
-- never saw an incoming attack in "Moje probíhající akce" at all).
--
-- 1. `get_incoming_attack_info(territory_id)` — richer replacement for the
--    client's old direct `troop_movements` select (which only fetched
--    `transfer_arrives_at`): also returns the attacker's identity and home
--    territory coordinates, for GarrisonModal's territory-detail view.
-- 2. `get_incoming_attacks_on_my_territories()` — every in-transit attack
--    currently converging on a territory the caller owns (or is claiming),
--    for the "Moje probíhající akce" panel's new defender section.

create or replace function get_incoming_attack_info(p_territory_id integer)
returns table (
  transfer_arrives_at timestamptz,
  attacker_id uuid,
  attacker_display_name text,
  attacker_kingdom_name text,
  attacker_is_npc boolean,
  attacker_home_x smallint,
  attacker_home_y smallint
)
language sql
security definer
set search_path = public
as $$
  select
    tm.transfer_arrives_at,
    p.id,
    p.display_name,
    p.kingdom_name,
    p.is_npc,
    h.x,
    h.y
  from troop_movements tm
  join players p on p.id = tm.player_id
  left join territories h on h.owner_id = p.id and h.is_home = true
  where tm.destination_territory_id = p_territory_id
    and tm.kind = 'attack'
    and tm.status = 'in_transit'
  order by tm.started_at desc
  limit 1;
$$;

revoke all on function get_incoming_attack_info(integer) from public;
grant execute on function get_incoming_attack_info(integer) to authenticated;

create or replace function get_incoming_attacks_on_my_territories()
returns table (
  movement_id uuid,
  territory_id integer,
  territory_x smallint,
  territory_y smallint,
  territory_name text,
  attacker_id uuid,
  attacker_display_name text,
  attacker_is_npc boolean,
  attacker_home_x smallint,
  attacker_home_y smallint,
  transfer_arrives_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform resolve_due_movements();
  return query
    select
      tm.id,
      t.id,
      t.x,
      t.y,
      t.name,
      p.id,
      p.display_name,
      p.is_npc,
      h.x,
      h.y,
      tm.transfer_arrives_at
    from troop_movements tm
    join territories t on t.id = tm.destination_territory_id
    join players p on p.id = tm.player_id
    left join territories h on h.owner_id = p.id and h.is_home = true
    where tm.kind = 'attack'
      and tm.status = 'in_transit'
      and (
        t.owner_id = auth.uid()
        or (t.owner_id is null and t.claim_locked_by = auth.uid())
      );
end;
$$;

revoke all on function get_incoming_attacks_on_my_territories() from public;
grant execute on function get_incoming_attacks_on_my_territories() to authenticated;
