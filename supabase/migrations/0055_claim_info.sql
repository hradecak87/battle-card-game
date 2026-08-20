-- Adds visibility into who is currently claiming an empty territory,
-- mirroring `get_incoming_attack_info` (0028) for the battle case:
-- previously `claim_locked_by` only signalled *that* a territory was being
-- claimed, with no way to see *who* was claiming it or a link to their
-- home, so GarrisonModal could only show a bare "zábor probíhá" countdown.
--
-- `claim_locked_by` already holds the claiming player's id directly (set
-- once their claim transfer arrives, cleared when occupation completes or
-- the claim is beaten off — see 0002_territories.sql), so this doesn't
-- need a `troop_movements` join like the battle case did.

create or replace function get_claim_info(p_territory_id integer)
returns table (
  claimant_id uuid,
  claimant_display_name text,
  claimant_kingdom_name text,
  claimant_is_npc boolean,
  claimant_home_x smallint,
  claimant_home_y smallint
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.display_name,
    p.kingdom_name,
    p.is_npc,
    h.x,
    h.y
  from territories t
  join players p on p.id = t.claim_locked_by
  left join territories h on h.owner_id = p.id and h.is_home = true
  where t.id = p_territory_id
    and t.claim_locked_by is not null;
$$;

revoke all on function get_claim_info(integer) from public;
grant execute on function get_claim_info(integer) to authenticated;
