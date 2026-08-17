-- ---------------------------------------------------------------------------
-- 0011_claim_xp.sql
--
-- Claim-completion XP: award XP when a player successfully finishes
-- occupying a previously-unowned territory via the non-combat claim flow.
--
-- 1. Adds `_award_xp(player_id, amount)` so XP mutation + level-milestone
--    structure-card grants live in one shared helper.
-- 2. Replaces `_finalize_battle` to reuse `_award_xp(..., 50)` for battle-win
--    XP, preserving the existing 1% battle-only bonus structure-card roll.
-- 3. Replaces `resolve_due_movements()` so a completed empty-territory claim
--    also awards 15 XP at occupation completion time.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. _award_xp(player_id, amount) — shared XP mutation + level-milestone
--    structure grant logic reused by both battle wins and peaceful claims.
--    The milestone rule intentionally mirrors 0009_structure_card_rewards.sql:
--    crossing a multiple-of-5 level boundary grants exactly one random
--    castle-common or village-common card.
-- ---------------------------------------------------------------------------
create or replace function _award_xp(
  p_player_id uuid,
  p_amount integer
) returns void
language plpgsql
security definer
as $$
declare
  v_old_xp integer;
  v_old_level integer;
  v_new_level integer;
  v_structure_category text;
begin
  if p_amount <= 0 then
    return;
  end if;

  select xp into v_old_xp
  from players
  where id = p_player_id
  for update;
  if not found then
    raise exception 'player % not found', p_player_id;
  end if;

  -- Row-lock the player so concurrent XP awards cannot race the
  -- old/new-level comparison and double-grant (or miss) a milestone card.
  v_old_level := xp_level(v_old_xp);

  update players
  set xp = xp + p_amount
  where id = p_player_id;

  v_new_level := xp_level(v_old_xp + p_amount);

  if floor(v_new_level::numeric / 5) > floor(v_old_level::numeric / 5) then
    v_structure_category := case when random() < 0.5 then 'castle' else 'village' end;
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_structure_category || '-common', p_player_id, null, 'stationed');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. _finalize_battle — full replacement to reuse _award_xp for the existing
--    50-XP battle-win path. All battle-resolution behavior remains unchanged;
--    only the XP/milestone block is deduplicated into the shared helper.
-- ---------------------------------------------------------------------------
create or replace function _finalize_battle(
  p_battle_id uuid,
  p_winner_side text
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

    -- Send home any lingering defender-owned cards still stationed there.
    -- Only relevant for a no-combat outright win (Task 10) — a combat win
    -- (Task 12) guarantees the defender/NPC has zero cards left there, so
    -- this is a harmless no-op in that case. NPC defender_id is null and
    -- NPC battles never reach this no-combat path, so this is PvP-only.
    if v_battle.defender_id is not null then
      select array_agg(instance_id) into v_moving_ids
      from card_instances
      where owner_id = v_battle.defender_id
        and stationed_territory_id = v_battle.territory_id;

      if v_moving_ids is not null and array_length(v_moving_ids, 1) > 0 then
        select id into v_defender_home_id
        from territories where owner_id = v_battle.defender_id and is_home;

        select nation into v_mover_nation from players where id = v_battle.defender_id;
        select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;
        select x, y into v_to_x, v_to_y from territories where id = v_defender_home_id;
        v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
        v_transfer_hrs := greatest(0.25, v_distance * 0.3)
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
    -- survivors plus any mid-battle captures for a combat outcome.
    select array_agg(instance_id) into v_moving_ids
    from card_instances
    where owner_id = v_battle.attacker_id
      and stationed_territory_id = v_battle.territory_id;

    if v_moving_ids is not null and array_length(v_moving_ids, 1) > 0 then
      select nation into v_mover_nation from players where id = v_battle.attacker_id;
      select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;
      select x, y into v_to_x, v_to_y from territories where id = v_origin_territory_id;
      v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
      v_transfer_hrs := greatest(0.25, v_distance * 0.3)
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

  -- Award the existing 50-XP battle-win reward through the shared helper,
  -- which also preserves the level-milestone structure-card grant.
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

-- ---------------------------------------------------------------------------
-- 3. resolve_due_movements() — full replacement adding peaceful-claim XP at
--    the exact moment a completed empty-territory claim flips owner_id.
--    Claiming an empty tile awards only 15 XP, intentionally well below the
--    50-XP battle-win reward because it costs time but carries no combat risk.
--    All other movement/battle behavior remains identical to 0003_battles.sql.
-- ---------------------------------------------------------------------------
create or replace function resolve_due_movements()
returns void
language plpgsql
security definer
as $$
declare
  arrival record;
  battle_id uuid;
  claim_movement_id uuid;
  target_owner uuid;
  target_claim_locked_by uuid;
  target_is_home boolean;
  arrival_card_instance_ids uuid[];
  occupation_hrs numeric;
  effective_count integer;
  v_completed_claim record;
begin
  -- Step 1: attack arrival. Like a transfer, the cards physically land
  -- first; combat/claim classification happens only after re-reading the
  -- territory's current state at arrival time.
  update card_instances ci
  set stationed_territory_id = tm.destination_territory_id,
      status = 'stationed'
  from troop_movements tm
  where tm.status = 'in_transit'
    and tm.transfer_arrives_at <= now()
    and tm.kind = 'attack'
    and ci.instance_id in (
      select tmu.card_instance_id from troop_movement_units tmu
      where tmu.movement_id = tm.id
    );

  for arrival in
    update troop_movements
    set status = 'completed'
    where status = 'in_transit'
      and transfer_arrives_at <= now()
      and kind = 'attack'
    returning id, player_id, origin_territory_id, destination_territory_id
  loop
    select owner_id, claim_locked_by, is_home
    into target_owner, target_claim_locked_by, target_is_home
    from territories
    where id = arrival.destination_territory_id
    for update;

    if target_owner is not null and target_owner <> arrival.player_id then
      insert into battles
        (territory_id, attacker_id, defender_id, is_home_target, movement_id, status, ready_deadline)
      values
        (
          arrival.destination_territory_id,
          arrival.player_id,
          target_owner,
          target_is_home,
          arrival.id,
          'awaiting_ready',
          now() + interval '10 days'
        )
      returning id into battle_id;

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;
    elsif target_owner is null
      and target_claim_locked_by is not null
      and target_claim_locked_by <> arrival.player_id then
      insert into battles
        (territory_id, attacker_id, defender_id, is_home_target, movement_id, status, ready_deadline)
      values
        (
          arrival.destination_territory_id,
          arrival.player_id,
          target_claim_locked_by,
          false,
          arrival.id,
          'awaiting_ready',
          now() + interval '10 days'
        )
      returning id into battle_id;

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;
    elsif target_owner is null
      and target_claim_locked_by is null
      and exists (
        select 1
        from card_instances ci
        join card_templates ct on ct.id = ci.template_id
        where ci.stationed_territory_id = arrival.destination_territory_id
          and ci.owner_id is null
          and ct.category = 'unit'
      ) then
      insert into battles
        (
          territory_id,
          attacker_id,
          defender_id,
          is_home_target,
          movement_id,
          status,
          ready_deadline,
          round_deadline
        )
      values
        (
          arrival.destination_territory_id,
          arrival.player_id,
          null,
          target_is_home,
          arrival.id,
          'active',
          now() + interval '10 days',
          now()
        )
      returning id into battle_id;

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      -- Safe forward reference: _start_next_round is appended later in
      -- this same migration and resolves at runtime, not function-creation
      -- time.
      perform _start_next_round(battle_id);
    else
      select array_agg(tmu.card_instance_id order by tmu.card_instance_id)
      into arrival_card_instance_ids
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      select count(*) into effective_count
      from territories
      where owner_id = arrival.player_id or claim_locked_by = arrival.player_id;
      if effective_count >= 32 then
        raise exception 'territory ownership cap (32) reached';
      end if;

      -- Safe forward reference: the shared claim-occupation helper is
      -- defined later in this migration.
      occupation_hrs := _claim_occupation_hours(
        arrival.player_id,
        arrival.destination_territory_id,
        arrival_card_instance_ids
      );

      update territories
      set claim_locked_by = arrival.player_id,
          claim_started_at = now(),
          claim_transfer_arrives_at = now(),
          claim_occupation_completes_at = now() + (occupation_hrs || ' hours')::interval,
          battle_locked_by = null
      where id = arrival.destination_territory_id;

      insert into troop_movements
        (
          player_id,
          kind,
          origin_territory_id,
          destination_territory_id,
          transfer_arrives_at,
          status
        )
      values
        (
          arrival.player_id,
          'claim',
          arrival.origin_territory_id,
          arrival.destination_territory_id,
          now(),
          'occupying'
        )
      returning id into claim_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id)
      select claim_movement_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;
    end if;
  end loop;

  -- Step 1: transfer/claim arrival. For 'transfer', complete the trip
  -- outright. For 'claim', flip to 'occupying' — its
  -- claim_occupation_completes_at was already precomputed at claim-start.
  update card_instances ci
  set stationed_territory_id = tm.destination_territory_id,
      status = 'stationed'
  from troop_movements tm
  where tm.status = 'in_transit'
    and tm.transfer_arrives_at <= now()
    and ci.instance_id in (
      select tmu.card_instance_id from troop_movement_units tmu
      where tmu.movement_id = tm.id
    );

  update troop_movements
  set status = 'completed'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'transfer';

  update troop_movements
  set status = 'occupying'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'claim';

  -- Step 2: occupation completion. Flip ownership, clear the claim lock,
  -- and complete the corresponding troop_movements row. Peaceful empty-
  -- territory claims award only 15 XP here, intentionally below the
  -- 50-XP battle-win reward because they cost time but carry no combat risk.
  for v_completed_claim in
    select t.claim_locked_by
    from territories t
    where t.claim_occupation_completes_at <= now()
      and t.claim_locked_by is not null
    for update
  loop
    perform _award_xp(v_completed_claim.claim_locked_by, 15);
  end loop;

  update troop_movements tm
  set status = 'completed'
  from territories t
  where tm.kind = 'claim'
    and tm.status = 'occupying'
    and tm.destination_territory_id = t.id
    and t.claim_occupation_completes_at <= now()
    and t.claim_locked_by is not null;

  update territories
  set owner_id = claim_locked_by,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null
  where claim_occupation_completes_at <= now()
    and claim_locked_by is not null;
end;
$$;


