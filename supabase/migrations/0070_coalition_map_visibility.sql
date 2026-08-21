-- Coalition shared map visibility (phase 3): coalition members can see each
-- other's in-transit movements on the map, incoming attacks on coalition
-- territories, and movement composition for allied movements.

create or replace function _coalition_member_ids(p_player_id uuid)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select cm_target.player_id
  from coalition_members cm_self
  join coalition_members cm_target
    on cm_target.coalition_id = cm_self.coalition_id
  join coalitions c
    on c.id = cm_self.coalition_id
  where cm_self.player_id = p_player_id
    and c.disbanded_at is null;
$$;

revoke all on function _coalition_member_ids(uuid) from public;

create or replace function get_coalition_movements()
returns table (
  id uuid,
  player_id uuid,
  kind text,
  origin_territory_id integer,
  destination_territory_id integer,
  started_at timestamptz,
  transfer_arrives_at timestamptz,
  status text,
  cancelled_at timestamptz,
  display_name text,
  kingdom_name text,
  is_npc boolean
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
      tm.id,
      tm.player_id,
      tm.kind::text,
      tm.origin_territory_id,
      tm.destination_territory_id,
      tm.started_at,
      tm.transfer_arrives_at,
      tm.status::text,
      tm.cancelled_at,
      p.display_name,
      p.kingdom_name,
      p.is_npc
    from troop_movements tm
    join players p
      on p.id = tm.player_id
    where tm.player_id <> v_player_id
      and tm.player_id in (select _coalition_member_ids(v_player_id))
      and tm.status in ('in_transit', 'occupying');
end;
$$;

revoke all on function get_coalition_movements() from public;
grant execute on function get_coalition_movements() to authenticated;

create or replace function get_incoming_attacks_on_coalition_territories()
returns table (
  movement_id uuid,
  territory_id integer,
  territory_x smallint,
  territory_y smallint,
  territory_name text,
  defender_id uuid,
  defender_display_name text,
  defender_kingdom_name text,
  defender_is_npc boolean,
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
declare
  v_player_id uuid := auth.uid();
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();

  return query
    select
      tm.id,
      t.id,
      t.x,
      t.y,
      t.name,
      defender.id,
      defender.display_name,
      defender.kingdom_name,
      defender.is_npc,
      p.id,
      p.display_name,
      p.kingdom_name,
      p.is_npc,
      h.x,
      h.y,
      tm.started_at,
      tm.transfer_arrives_at
    from troop_movements tm
    join territories t
      on t.id = tm.destination_territory_id
    join players p
      on p.id = tm.player_id
    join players defender
      on defender.id = coalesce(t.owner_id, t.claim_locked_by)
    left join territories h
      on h.owner_id = p.id
     and h.is_home = true
    where tm.kind = 'attack'
      and tm.status = 'in_transit'
      and (
        (
          t.owner_id is not null
          and t.owner_id <> v_player_id
          and t.owner_id in (select _coalition_member_ids(v_player_id))
        )
        or (
          t.owner_id is null
          and t.claim_locked_by is not null
          and t.claim_locked_by <> v_player_id
          and t.claim_locked_by in (select _coalition_member_ids(v_player_id))
        )
      );
end;
$$;

revoke all on function get_incoming_attacks_on_coalition_territories() from public;
grant execute on function get_incoming_attacks_on_coalition_territories() to authenticated;

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
    join troop_movement_units tmu
      on tmu.movement_id = tm.id
    join card_instances ci
      on ci.instance_id = tmu.card_instance_id
    join card_templates ct
      on ct.id = ci.template_id
    where tm.id = p_movement_id
      and (
        tm.player_id = v_player_id
        or (
          tm.player_id <> v_player_id
          and tm.player_id in (select _coalition_member_ids(v_player_id))
        )
      )
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
