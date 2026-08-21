-- Map movement arrows needs two backend additions:
-- 1) richer incoming-attack rows for defender-side map arrows
--    (`attacker_kingdom_name` + `started_at` for client-side animation),
-- 2) a server-authorized movement-card RPC for the detail modal.
-- It also tightens `troop_movement_units` select RLS so the new RPC is the
-- only client-visible path to movement composition data.

drop function if exists get_incoming_attacks_on_my_territories();

create or replace function get_incoming_attacks_on_my_territories()
returns table (
  movement_id uuid,
  territory_id integer,
  territory_x smallint,
  territory_y smallint,
  territory_name text,
  attacker_id uuid,
  attacker_display_name text,
  attacker_kingdom_name text,
  attacker_is_npc boolean,
  attacker_home_x smallint,
  attacker_home_y smallint,
  started_at timestamptz,
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
      p.kingdom_name,
      p.is_npc,
      h.x,
      h.y,
      tm.started_at,
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

drop policy if exists troop_movement_units_select_all on troop_movement_units;

create policy troop_movement_units_select_all
on troop_movement_units
for select
using (false);

create or replace function get_movement_cards(p_movement_id uuid)
returns table (
  instance_id uuid,
  template_id text,
  owner_id uuid,
  stationed_territory_id integer,
  status text,
  origin_territory_id integer,
  card_templates jsonb
)
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

  perform resolve_due_movements();

  return query
    select
      ci.instance_id,
      ci.template_id,
      ci.owner_id,
      ci.stationed_territory_id,
      ci.status,
      tmu.origin_territory_id,
      jsonb_build_object(
        'id', ct.id,
        'name', ct.name,
        'flavor_text', ct.flavor_text,
        'rank', ct.rank,
        'category', ct.category,
        'unit_type', ct.unit_type,
        'base_stats', ct.base_stats,
        'total_supply', ct.total_supply,
        'defense_bonus_pct', ct.defense_bonus_pct,
        'attack_bonus_pct', ct.attack_bonus_pct,
        'boost_type', ct.boost_type,
        'effect_kind', ct.effect_kind,
        'instant_effect_kind', ct.instant_effect_kind,
        'pct_str', ct.pct_str,
        'pct_lng', ct.pct_lng,
        'pct_def', ct.pct_def,
        'pct_hp', ct.pct_hp
      ) as card_templates
    from troop_movements tm
    join troop_movement_units tmu on tmu.movement_id = tm.id
    join card_instances ci on ci.instance_id = tmu.card_instance_id
    join card_templates ct on ct.id = ci.template_id
    where tm.id = p_movement_id
      and tm.player_id = v_player_id
    order by
      tmu.origin_territory_id nulls first,
      ct.category,
      ct.rank,
      ct.name nulls last,
      ci.instance_id;
end;
$$;

revoke all on function get_movement_cards(uuid) from public;
grant execute on function get_movement_cards(uuid) to authenticated;
