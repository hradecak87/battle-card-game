-- Backlog #12: Speed attribute (movement-only, not combat/rank-scaled).
-- See docs/superpowers/specs/2026-08-19-speed-attribute-design.md.
--
-- 1. New shared helper `_min_group_speed(card_instance_ids uuid[])`: the
--    minimum `base_stats.speed` among the given unit-category card
--    instances — the slowest unit in a group sets the pace for the whole
--    group. Returns null if none of the instances resolve to a unit
--    template (defensive; callers should never hit this in practice).
-- 2. `declare_attack`, `start_transfer`, `start_claim` (all redefined here
--    with unchanged signatures, so a plain `create or replace` is safe —
--    no overload-duplication risk) and both card-movement branches of
--    `_finalize_battle` (also unchanged signature) now multiply their
--    distance-based transfer_hrs formula by `least(3.0, greatest(0.4,
--    5.0 / group_speed))` instead of using the plain distance*0.3
--    formula. Baseline reference speed is 5 — a mid-pack unit reproduces
--    today's unmodified duration exactly. The multiplier is clamped to
--    [0.4, 3.0] so no future speed value produces a degenerate duration.
-- 3. Does NOT touch `_claim_occupation_hours` (occupation time stays
--    power-based, unrelated to travel) or `_recall_movement_to_origin`
--    (#23 — uses elapsed wall-clock time, not the distance formula).

create or replace function _min_group_speed(card_instance_ids uuid[])
returns numeric
language sql
security definer
as $$
  select min((ct.base_stats->>'speed')::numeric)
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = any(card_instance_ids)
    and ct.category = 'unit';
$$;

create or replace function declare_attack(
  origin_territory_id integer,
  target_territory_id integer,
  card_instance_ids uuid[]
)
returns uuid
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  origin_x smallint; origin_y smallint;
  target_x smallint; target_y smallint;
  target_owner uuid;
  target_claim_locked_by uuid;
  target_battle_locked_by uuid;
  target_is_home boolean;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  transfer_hrs numeric;
  effective_count integer;
  matching_count integer;
  arrives_at timestamptz;
  movement_id uuid;
begin
  perform resolve_due_battles();
  perform resolve_due_movements();

  if card_instance_ids is null or array_length(card_instance_ids, 1) is null then
    raise exception 'card_instance_ids must be non-empty';
  end if;

  select nation into caller_nation from players where id = caller;

  select x, y into origin_x, origin_y
  from territories where id = origin_territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own origin_territory_id';
  end if;

  select x, y, owner_id, claim_locked_by, battle_locked_by, is_home
  into target_x, target_y, target_owner, target_claim_locked_by, target_battle_locked_by, target_is_home
  from territories where id = target_territory_id;
  if not found then
    raise exception 'target territory is not available to attack';
  end if;

  select count(*) into matching_count
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = any(card_instance_ids)
    and ci.owner_id = caller
    and ci.stationed_territory_id = origin_territory_id
    and ci.status = 'stationed'
    and ct.category = 'unit';
  if matching_count <> array_length(card_instance_ids, 1) then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  if target_owner = caller or target_claim_locked_by = caller then
    raise exception 'caller cannot attack their own owned/claimed territory';
  end if;
  if target_battle_locked_by is not null then
    raise exception 'target territory already has a battle in progress';
  end if;

  if target_owner is not null and not exists (
    select 1
    from (values (target_x - 1, target_y), (target_x + 1, target_y),
                 (target_x, target_y - 1), (target_x, target_y + 1)) as n(nx, ny)
    left join territories t2 on t2.x = n.nx and t2.y = n.ny
    where t2.id is null or t2.owner_id is distinct from target_owner
  ) then
    raise exception 'target territory is surrounded by owner''s own territory and cannot be attacked directly';
  end if;

  if not target_is_home then
    select count(*) into effective_count
    from territories where owner_id = caller or claim_locked_by = caller;
    if effective_count >= 32 then
      raise exception 'territory ownership cap (32) reached';
    end if;
  end if;

  distance := greatest(abs(target_x - origin_x), abs(target_y - origin_y));
  group_speed := _min_group_speed(card_instance_ids);
  speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
  transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);

  select x, y, owner_id, claim_locked_by, battle_locked_by, is_home
  into target_x, target_y, target_owner, target_claim_locked_by, target_battle_locked_by, target_is_home
  from territories
  where id = target_territory_id
  for update;
  if not found then
    raise exception 'target territory is not available to attack';
  end if;
  if target_owner = caller or target_claim_locked_by = caller then
    raise exception 'caller cannot attack their own owned/claimed territory';
  end if;
  if target_battle_locked_by is not null then
    raise exception 'target territory already has a battle in progress';
  end if;

  if target_owner is not null and not exists (
    select 1
    from (values (target_x - 1, target_y), (target_x + 1, target_y),
                 (target_x, target_y - 1), (target_x, target_y + 1)) as n(nx, ny)
    left join territories t2 on t2.x = n.nx and t2.y = n.ny
    where t2.id is null or t2.owner_id is distinct from target_owner
  ) then
    raise exception 'target territory is surrounded by owner''s own territory and cannot be attacked directly';
  end if;

  if not target_is_home then
    select count(*) into effective_count
    from territories where owner_id = caller or claim_locked_by = caller;
    if effective_count >= 32 then
      raise exception 'territory ownership cap (32) reached';
    end if;
  end if;

  -- Row-lock the selected instances and re-verify immediately before writing.
  perform instance_id from card_instances
  where instance_id = any(card_instance_ids)
    and owner_id = caller
    and stationed_territory_id = origin_territory_id
    and status = 'stationed'
  for update;
  if not found then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  arrives_at := now() + (transfer_hrs || ' hours')::interval;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (caller, 'attack', origin_territory_id, target_territory_id, arrives_at)
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);

  update territories
  set battle_locked_by = caller
  where id = target_territory_id;

  return movement_id;
end;
$$;

create or replace function start_transfer(
  origin_territory_id integer,
  destination_territory_id integer,
  card_instance_ids uuid[]
)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  origin_x smallint; origin_y smallint;
  dest_x smallint; dest_y smallint;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  transfer_hrs numeric;
  matching_count integer;
  arrives_at timestamptz;
  movement_id uuid;
begin
  perform resolve_due_movements();

  if card_instance_ids is null or array_length(card_instance_ids, 1) is null then
    raise exception 'card_instance_ids must be non-empty';
  end if;

  select nation into caller_nation from players where id = caller;

  select x, y into origin_x, origin_y
  from territories where id = origin_territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own origin_territory_id';
  end if;

  select x, y into dest_x, dest_y
  from territories where id = destination_territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own destination_territory_id (use start_claim instead)';
  end if;

  if exists (
    select 1 from battles
    where territory_id = destination_territory_id
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'cannot reinforce a territory with an unresolved battle';
  end if;

  select count(*) into matching_count
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = any(card_instance_ids)
    and ci.owner_id = caller
    and ci.stationed_territory_id = origin_territory_id
    and ci.status = 'stationed'
    and ct.category = 'unit';
  if matching_count <> array_length(card_instance_ids, 1) then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  distance := greatest(abs(dest_x - origin_x), abs(dest_y - origin_y));
  group_speed := _min_group_speed(card_instance_ids);
  speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
  transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);

  -- Row-lock the selected instances and re-verify immediately before writing.
  perform instance_id from card_instances
  where instance_id = any(card_instance_ids)
    and owner_id = caller
    and stationed_territory_id = origin_territory_id
    and status = 'stationed'
  for update;
  if not found then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  arrives_at := now() + (transfer_hrs || ' hours')::interval;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (caller, 'transfer', origin_territory_id, destination_territory_id, arrives_at)
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);
end;
$$;

create or replace function start_claim(
  origin_territory_id integer,
  destination_territory_id integer,
  card_instance_ids uuid[]
)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  origin_x smallint; origin_y smallint;
  dest_x smallint; dest_y smallint;
  dest_difficulty smallint;
  dest_owner uuid; dest_locked_by uuid; dest_battle_locked_by uuid;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  power numeric;
  difficulty_mult numeric;
  transfer_hrs numeric;
  occupation_hrs numeric;
  effective_count integer;
  matching_count integer;
  arrives_at timestamptz;
  occupies_at timestamptz;
  movement_id uuid;
begin
  perform resolve_due_battles();
  perform resolve_due_movements();

  if card_instance_ids is null or array_length(card_instance_ids, 1) is null then
    raise exception 'card_instance_ids must be non-empty';
  end if;

  select nation into caller_nation from players where id = caller;

  select x, y into origin_x, origin_y
  from territories where id = origin_territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own origin_territory_id';
  end if;

  select x, y, difficulty, owner_id, claim_locked_by, battle_locked_by
  into dest_x, dest_y, dest_difficulty, dest_owner, dest_locked_by, dest_battle_locked_by
  from territories where id = destination_territory_id;
  if dest_owner is not null or dest_locked_by is not null or dest_battle_locked_by is not null then
    raise exception 'destination territory is not available to claim';
  end if;
  if exists (
    select 1
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = destination_territory_id
      and ci.owner_id is null
      and ct.category = 'unit'
  ) then
    raise exception 'destination territory is not available to claim';
  end if;

  select count(*) into effective_count
  from territories where owner_id = caller or claim_locked_by = caller;
  if effective_count >= 32 then
    raise exception 'territory ownership cap (32) reached';
  end if;

  select count(*) into matching_count
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = any(card_instance_ids)
    and ci.owner_id = caller
    and ci.stationed_territory_id = origin_territory_id
    and ci.status = 'stationed'
    and ct.category = 'unit';
  if matching_count <> array_length(card_instance_ids, 1) then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  distance := greatest(abs(dest_x - origin_x), abs(dest_y - origin_y));

  group_speed := _min_group_speed(card_instance_ids);
  speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
  transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);
  occupation_hrs := _claim_occupation_hours(caller, destination_territory_id, card_instance_ids);

  -- Row-lock the destination and re-verify immediately before writing.
  perform id from territories
  where id = destination_territory_id
    and owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = destination_territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
    )
  for update;
  if not found then
    raise exception 'destination territory is not available to claim';
  end if;

  -- Row-lock the selected instances and re-verify immediately before writing.
  perform instance_id from card_instances
  where instance_id = any(card_instance_ids)
    and owner_id = caller
    and stationed_territory_id = origin_territory_id
    and status = 'stationed'
  for update;
  if not found then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  arrives_at := now() + (transfer_hrs || ' hours')::interval;
  occupies_at := arrives_at + (occupation_hrs || ' hours')::interval;

  update territories
  set claim_locked_by = caller,
      claim_started_at = now(),
      claim_transfer_arrives_at = arrives_at,
      claim_occupation_completes_at = occupies_at
  where id = destination_territory_id;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (caller, 'claim', origin_territory_id, destination_territory_id, arrives_at)
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);
end;
$$;

create or replace function _finalize_battle(
  p_battle_id uuid,
  p_winner_side text,
  p_defender_surrendered boolean default false
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_origin_territory_id integer;
  v_capture boolean := false;
  v_owned_count integer;
  v_defender_home_id integer;
  v_mover_nation nation_id;
  v_moving_ids uuid[];
  v_from_x smallint; v_from_y smallint;
  v_to_x smallint; v_to_y smallint;
  v_distance numeric;
  v_group_speed numeric;
  v_speed_mult numeric;
  v_transfer_hrs numeric;
  v_arrives_at timestamptz;
  v_movement_id uuid;
  v_winner_id uuid;
  v_structure_category text;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  select origin_territory_id into v_origin_territory_id
  from troop_movements where id = v_battle.movement_id;

  if p_winner_side = 'attacker' then
    select count(*) into v_owned_count
    from territories where owner_id = v_battle.attacker_id or claim_locked_by = v_battle.attacker_id;
    v_capture := (not v_battle.is_home_target) and v_owned_count < 32;
  end if;

  if v_capture then
    update territories
    set owner_id = v_battle.attacker_id,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null,
        battle_locked_by = null
    where id = v_battle.territory_id;

    -- Send home (or, on surrender, to the nearest other owned territory)
    -- any lingering defender-owned cards still stationed there. In a
    -- fully fought-out combat win the defender always has 0 cards left
    -- here (harmless no-op); the two reachable non-empty cases are the
    -- awaiting_ready walkover (destination = home, unchanged) and a
    -- mid-battle surrender (destination = nearest owned territory, new).
    if v_battle.defender_id is not null then
      select array_agg(instance_id) into v_moving_ids
      from card_instances
      where owner_id = v_battle.defender_id
        and stationed_territory_id = v_battle.territory_id;

      if v_moving_ids is not null and array_length(v_moving_ids, 1) > 0 then
        select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;

        if p_defender_surrendered then
          select id into v_defender_home_id
          from territories
          where owner_id = v_battle.defender_id
            and id <> v_battle.territory_id
          order by greatest(abs(x - v_from_x), abs(y - v_from_y)) asc
          limit 1;
        else
          select id into v_defender_home_id
          from territories where owner_id = v_battle.defender_id and is_home;
        end if;

        select nation into v_mover_nation from players where id = v_battle.defender_id;
        select x, y into v_to_x, v_to_y from territories where id = v_defender_home_id;
        v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
        v_group_speed := _min_group_speed(v_moving_ids);
        v_speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(v_group_speed, 5.0)));
        v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult)
          * (case when v_mover_nation = 'mongol_horde' then 0.75 else 1.0 end);
        v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

        insert into troop_movements
          (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
        values (v_battle.defender_id, 'transfer', v_battle.territory_id, v_defender_home_id, v_arrives_at)
        returning id into v_movement_id;

        insert into troop_movement_units (movement_id, card_instance_id)
        select v_movement_id, unnest(v_moving_ids);

        update card_instances set status = 'in_transit'
        where instance_id = any(v_moving_ids);
      end if;
    end if;
  else
    -- Not captured (defender/expired win, or is_home_target/cap-blocked
    -- attacker win): territory ownership is unchanged, only the lock clears.
    update territories set battle_locked_by = null where id = v_battle.territory_id;

    -- Send home whatever the attacker currently owns at the territory —
    -- the whole untouched roster for a no-combat outcome, or roster
    -- survivors plus any mid-battle captures for a combat outcome. Also
    -- covers an attacker surrender: remaining roster takes the full
    -- original transfer duration back to its origin, same as any other
    -- attacker loss here.
    select array_agg(instance_id) into v_moving_ids
    from card_instances
    where owner_id = v_battle.attacker_id
      and stationed_territory_id = v_battle.territory_id;

    if v_moving_ids is not null and array_length(v_moving_ids, 1) > 0 then
      select nation into v_mover_nation from players where id = v_battle.attacker_id;
      select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;
      select x, y into v_to_x, v_to_y from territories where id = v_origin_territory_id;
      v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
      v_group_speed := _min_group_speed(v_moving_ids);
      v_speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(v_group_speed, 5.0)));
      v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult)
        * (case when v_mover_nation = 'mongol_horde' then 0.75 else 1.0 end);
      v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

      insert into troop_movements
        (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
      values (v_battle.attacker_id, 'transfer', v_battle.territory_id, v_origin_territory_id, v_arrives_at)
      returning id into v_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id)
      select v_movement_id, unnest(v_moving_ids);

      update card_instances set status = 'in_transit'
      where instance_id = any(v_moving_ids);
    end if;
  end if;

  update battles
  set status = case when p_winner_side is null then 'expired' else 'resolved' end,
      winner_side = p_winner_side,
      resolved_at = now()
  where id = p_battle_id;

  -- Award the existing 50-XP battle-win reward through the shared helper
  -- (also applies to a surrender-ended battle — still a decisive win).
  if p_winner_side is not null then
    v_winner_id := case p_winner_side
      when 'attacker' then v_battle.attacker_id
      when 'defender' then v_battle.defender_id
    end;

    if v_winner_id is not null then
      perform _award_xp(v_winner_id, 50);

      -- Battle-only bonus: independent 1% random structure-card reward.
      if random() < 0.01 then
        v_structure_category := case when random() < 0.5 then 'castle' else 'village' end;
        insert into card_instances (template_id, owner_id, stationed_territory_id, status)
        values (v_structure_category || '-common', v_winner_id, null, 'stationed');
      end if;
    end if;
  end if;
end;
$$;
