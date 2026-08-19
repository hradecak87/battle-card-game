-- Backlog #6: allow declaring a single attack with troops drawn from
-- multiple owned origin territories at once. All selected contingents
-- still arrive together as one attack, using the slowest/farthest
-- contingent's ETA (max of the per-origin distance+_min_group_speed
-- formula).
--
-- Design choices:
-- 1. `declare_attack(target_territory_id, origin_groups jsonb)` is the new
--    authoritative entry point. Each JSON object contains one
--    `origin_territory_id` plus its `card_instance_ids`.
-- 2. The legacy single-origin signature is kept as a thin wrapper so any
--    older caller can still submit a one-origin attack without change.
-- 3. The attack still creates exactly one `troop_movements` row / one
--    future `battles` row. Per-card original origins are preserved on a
--    new nullable `troop_movement_units.origin_territory_id` column so
--    recall and post-battle retreat logic can send survivors back to the
--    correct source territory instead of collapsing everything onto one
--    arbitrary origin.
-- 4. All existing declare-time invariants from 0022_claim_limit.sql are
--    preserved verbatim: own-territory rejection, surrounded-target rule,
--    32-territory effective ownership cap, 5-concurrent-claim cap, NPC /
--    empty-claim path distinction, battle lock, etc.

alter table troop_movement_units
  add column if not exists origin_territory_id integer references territories(id);

update troop_movement_units tmu
set origin_territory_id = tm.origin_territory_id
from troop_movements tm
where tm.id = tmu.movement_id
  and tmu.origin_territory_id is null;

create index if not exists troop_movement_units_movement_origin_idx
  on troop_movement_units (movement_id, origin_territory_id);

create or replace function declare_attack(
  target_territory_id integer,
  origin_groups jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  target_x smallint; target_y smallint;
  target_owner uuid;
  target_claim_locked_by uuid;
  target_battle_locked_by uuid;
  target_is_home boolean;
  target_is_empty_claimable boolean;
  active_claim_count integer;
  effective_count integer;
  matching_count integer;
  origin_group jsonb;
  origin_territory_ids integer[] := '{}'::integer[];
  all_card_instance_ids uuid[] := '{}'::uuid[];
  group_card_instance_ids uuid[];
  origin_territory_id integer;
  origin_x smallint;
  origin_y smallint;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  contingent_transfer_hrs numeric;
  max_transfer_hrs numeric := 0;
  primary_origin_territory_id integer;
  arrives_at timestamptz;
  movement_id uuid;
begin
  perform resolve_due_battles();
  perform resolve_due_movements();

  if origin_groups is null or jsonb_typeof(origin_groups) <> 'array' or jsonb_array_length(origin_groups) = 0 then
    raise exception 'origin_groups must be a non-empty array';
  end if;

  select nation into caller_nation from players where id = caller;

  select x, y, owner_id, claim_locked_by, battle_locked_by, is_home
  into target_x, target_y, target_owner, target_claim_locked_by, target_battle_locked_by, target_is_home
  from territories where id = target_territory_id;
  if not found then
    raise exception 'target territory is not available to attack';
  end if;

  for origin_group in select value from jsonb_array_elements(origin_groups)
  loop
    if jsonb_typeof(origin_group) <> 'object' then
      raise exception 'each origin_groups item must be an object';
    end if;

    origin_territory_id := (origin_group->>'origin_territory_id')::integer;
    if origin_territory_id is null then
      raise exception 'origin_territory_id is required for every origin group';
    end if;
    if origin_territory_id = any(origin_territory_ids) then
      raise exception 'origin_territory_id % is duplicated in origin_groups', origin_territory_id;
    end if;

    select coalesce(array_agg(card_id), '{}'::uuid[])
    into group_card_instance_ids
    from (
      select jsonb_array_elements_text(coalesce(origin_group->'card_instance_ids', '[]'::jsonb))::uuid as card_id
    ) as ids;
    if array_length(group_card_instance_ids, 1) is null then
      raise exception 'each origin group must include at least one card_instance_id';
    end if;

    select count(*) into matching_count
    from (select distinct card_id from unnest(group_card_instance_ids) as card_id) distinct_ids;
    if matching_count <> array_length(group_card_instance_ids, 1) then
      raise exception 'card_instance_ids within one origin group must be unique';
    end if;

    if exists (
      select 1
      from unnest(group_card_instance_ids) as card_id
      where card_id = any(all_card_instance_ids)
    ) then
      raise exception 'the same card_instance_id cannot be sent from multiple origins';
    end if;

    select x, y into origin_x, origin_y
    from territories where id = origin_territory_id and owner_id = caller;
    if not found then
      raise exception 'caller does not own origin_territory_id %', origin_territory_id;
    end if;

    select count(*) into matching_count
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = any(group_card_instance_ids)
      and ci.owner_id = caller
      and ci.stationed_territory_id = origin_territory_id
      and ci.status = 'stationed'
      and ct.category = 'unit';
    if matching_count <> array_length(group_card_instance_ids, 1) then
      raise exception 'one or more card instances are not eligible to send';
    end if;

    distance := greatest(abs(target_x - origin_x), abs(target_y - origin_y));
    group_speed := _min_group_speed(group_card_instance_ids);
    speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
    contingent_transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
      * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);

    if primary_origin_territory_id is null or contingent_transfer_hrs > max_transfer_hrs then
      max_transfer_hrs := contingent_transfer_hrs;
      primary_origin_territory_id := origin_territory_id;
    end if;

    origin_territory_ids := array_append(origin_territory_ids, origin_territory_id);
    all_card_instance_ids := all_card_instance_ids || group_card_instance_ids;
  end loop;

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

  target_is_empty_claimable := target_owner is null and target_claim_locked_by is null
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = target_territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
    );
  if target_is_empty_claimable then
    select count(*) into active_claim_count
    from territories where claim_locked_by = caller and owner_id is null;
    if active_claim_count >= 5 then
      raise exception 'concurrent claim limit (5) reached — wait for an in-progress claim to complete or cancel one first';
    end if;
  end if;

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

  target_is_empty_claimable := target_owner is null and target_claim_locked_by is null
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = target_territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
    );
  if target_is_empty_claimable then
    select count(*) into active_claim_count
    from territories where claim_locked_by = caller and owner_id is null;
    if active_claim_count >= 5 then
      raise exception 'concurrent claim limit (5) reached — wait for an in-progress claim to complete or cancel one first';
    end if;
  end if;

  for origin_group in select value from jsonb_array_elements(origin_groups)
  loop
    origin_territory_id := (origin_group->>'origin_territory_id')::integer;
    select coalesce(array_agg(card_id), '{}'::uuid[])
    into group_card_instance_ids
    from (
      select jsonb_array_elements_text(coalesce(origin_group->'card_instance_ids', '[]'::jsonb))::uuid as card_id
    ) as ids;

    select count(*) into matching_count
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = any(group_card_instance_ids)
      and ci.owner_id = caller
      and ci.stationed_territory_id = origin_territory_id
      and ci.status = 'stationed'
      and ct.category = 'unit';
    if matching_count <> array_length(group_card_instance_ids, 1) then
      raise exception 'one or more card instances are not eligible to send';
    end if;

    perform ci.instance_id
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = any(group_card_instance_ids)
      and ci.owner_id = caller
      and ci.stationed_territory_id = origin_territory_id
      and ci.status = 'stationed'
      and ct.category = 'unit'
    for update;
  end loop;

  arrives_at := now() + (max_transfer_hrs || ' hours')::interval;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (caller, 'attack', primary_origin_territory_id, target_territory_id, arrives_at)
  returning id into movement_id;

  for origin_group in select value from jsonb_array_elements(origin_groups)
  loop
    origin_territory_id := (origin_group->>'origin_territory_id')::integer;
    select coalesce(array_agg(card_id), '{}'::uuid[])
    into group_card_instance_ids
    from (
      select jsonb_array_elements_text(coalesce(origin_group->'card_instance_ids', '[]'::jsonb))::uuid as card_id
    ) as ids;

    insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
    select movement_id, unnest(group_card_instance_ids), origin_territory_id;
  end loop;

  update card_instances
  set status = 'in_transit'
  where instance_id = any(all_card_instance_ids);

  update territories
  set battle_locked_by = caller
  where id = target_territory_id;

  return movement_id;
end;
$$;

create or replace function declare_attack(
  origin_territory_id integer,
  target_territory_id integer,
  card_instance_ids uuid[]
)
returns uuid
language sql
security definer
as $$
  select declare_attack(
    target_territory_id,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', origin_territory_id,
        'card_instance_ids', to_jsonb(card_instance_ids)
      )
    )
  );
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
  v_attacker_origin_group record;
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

        insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
        select v_movement_id, unnest(v_moving_ids), v_battle.territory_id;

        update card_instances set status = 'in_transit'
        where instance_id = any(v_moving_ids);
      end if;
    end if;
  else
    update territories set battle_locked_by = null where id = v_battle.territory_id;

    for v_attacker_origin_group in
      select
        coalesce(tmu.origin_territory_id, v_origin_territory_id) as origin_territory_id,
        array_agg(ci.instance_id order by ci.instance_id) as moving_ids
      from card_instances ci
      left join troop_movement_units tmu
        on tmu.movement_id = v_battle.movement_id
       and tmu.card_instance_id = ci.instance_id
      where ci.owner_id = v_battle.attacker_id
        and ci.stationed_territory_id = v_battle.territory_id
      group by coalesce(tmu.origin_territory_id, v_origin_territory_id)
    loop
      v_moving_ids := v_attacker_origin_group.moving_ids;
      if v_moving_ids is null or array_length(v_moving_ids, 1) = 0 then
        continue;
      end if;

      select nation into v_mover_nation from players where id = v_battle.attacker_id;
      select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;
      select x, y into v_to_x, v_to_y from territories where id = v_attacker_origin_group.origin_territory_id;
      v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
      v_group_speed := _min_group_speed(v_moving_ids);
      v_speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(v_group_speed, 5.0)));
      v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult)
        * (case when v_mover_nation = 'mongol_horde' then 0.75 else 1.0 end);
      v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

      insert into troop_movements
        (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
      values (
        v_battle.attacker_id,
        'transfer',
        v_battle.territory_id,
        v_attacker_origin_group.origin_territory_id,
        v_arrives_at
      )
      returning id into v_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
      select v_movement_id, unnest(v_moving_ids), v_battle.territory_id;

      update card_instances set status = 'in_transit'
      where instance_id = any(v_moving_ids);
    end loop;
  end if;

  update battles
  set status = case when p_winner_side is null then 'expired' else 'resolved' end,
      winner_side = p_winner_side,
      resolved_at = now()
  where id = p_battle_id;

  if p_winner_side is not null then
    v_winner_id := case p_winner_side
      when 'attacker' then v_battle.attacker_id
      when 'defender' then v_battle.defender_id
    end;

    if v_winner_id is not null then
      perform _award_xp(v_winner_id, 50);

      if random() < 0.01 then
        v_structure_category := case when random() < 0.5 then 'castle' else 'village' end;
        insert into card_instances (template_id, owner_id, stationed_territory_id, status)
        values (v_structure_category || '-common', v_winner_id, null, 'stationed');
      end if;
    end if;
  end if;
end;
$$;

create or replace function recall_attack(p_movement_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_movement record;
  v_elapsed_hours numeric;
  v_origin_group record;
  v_return_movement_id uuid;
begin
  perform resolve_due_movements();
  perform resolve_due_battles();

  select * into v_movement from troop_movements where id = p_movement_id for update;
  if not found then
    raise exception 'movement not found';
  end if;
  if v_movement.player_id <> caller then
    raise exception 'caller does not own this movement';
  end if;
  if v_movement.kind <> 'attack' then
    raise exception 'only an in-transit attack can be recalled';
  end if;
  if v_movement.status <> 'in_transit' then
    raise exception 'this attack has already arrived and cannot be recalled';
  end if;

  v_elapsed_hours := greatest(0, extract(epoch from (now() - v_movement.started_at)) / 3600.0);

  for v_origin_group in
    select
      coalesce(origin_territory_id, v_movement.origin_territory_id) as origin_territory_id,
      array_agg(card_instance_id order by card_instance_id) as card_instance_ids
    from troop_movement_units
    where movement_id = p_movement_id
    group by coalesce(origin_territory_id, v_movement.origin_territory_id)
  loop
    insert into troop_movements
      (player_id, kind, origin_territory_id, destination_territory_id, started_at, transfer_arrives_at)
    values (
      caller,
      'transfer',
      v_movement.destination_territory_id,
      v_origin_group.origin_territory_id,
      now(),
      now() + (v_elapsed_hours || ' hours')::interval
    )
    returning id into v_return_movement_id;

    insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
    select v_return_movement_id, unnest(v_origin_group.card_instance_ids), v_movement.destination_territory_id;
  end loop;

  delete from troop_movement_units where movement_id = p_movement_id;

  update troop_movements
  set status = 'cancelled',
      cancelled_at = now()
  where id = p_movement_id;

  update territories
  set battle_locked_by = null
  where id = v_movement.destination_territory_id and battle_locked_by = caller;
end;
$$;
