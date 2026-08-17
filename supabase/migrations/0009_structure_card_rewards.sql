-- ---------------------------------------------------------------------------
-- 0009_structure_card_rewards.sql
--
-- Structure card rewards: XP awarding on battle win, level-milestone
-- structure card grants, 1% battle-win bonus, and starter kit structure
-- cards at onboarding.
--
-- 1. Adds `xp_level(p_xp integer) returns integer` — SQL mirror of
--    `levelForXp` in lib/players/leveling.ts.
-- 2. Replaces `_finalize_battle` to award 50 XP on real wins (non-NPC),
--    grant a random castle/village-common card at level-5-multiple milestones,
--    and independently roll a 1% bonus structure card grant.
-- 3. Replaces `complete_kingdom_onboarding` to also grant 1 castle-common
--    and 1 village-common card instance in the starter kit.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. xp_level(p_xp) — SQL mirror of levelForXp / xpRequiredForLevel from
--    lib/players/leveling.ts:
--      xpRequiredForLevel(level) = 100 * (level-1) * level / 2
--      levelForXp: advance level while xp >= xpRequiredForLevel(level+1)
--
--    NOTE: This duplicates client-side logic in lib/players/leveling.ts and
--    must be kept in sync manually if that formula ever changes. There is no
--    perfect single-source-of-truth option here without a larger refactor
--    that is out of scope for this task.
-- ---------------------------------------------------------------------------
create or replace function xp_level(p_xp integer) returns integer
language plpgsql
immutable
security definer
as $$
declare
  v_level integer := 1;
begin
  -- Advance level while xp >= xpRequiredForLevel(level+1),
  -- where xpRequiredForLevel(n) = 100 * (n-1) * n / 2.
  -- xpRequiredForLevel(v_level + 1) = 100 * v_level * (v_level + 1) / 2
  loop
    exit when p_xp < (100 * v_level * (v_level + 1)) / 2;
    v_level := v_level + 1;
  end loop;
  return v_level;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. _finalize_battle — full replacement adding XP award (§A), level-
--    milestone structure grant (§B), and 1% battle-win bonus grant (§C).
--    All other logic is identical to the 0003_battles.sql version.
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
  -- XP / level-milestone variables (§A, §B, §C)
  v_winner_id uuid;
  v_old_xp integer;
  v_old_level integer;
  v_new_level integer;
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

  -- -------------------------------------------------------------------------
  -- §A: Award 50 XP to the winner on a real win (non-null winner_side, real
  -- human player — NPC defenders have defender_id = null, so skip those).
  -- No XP for expired/timeout-with-no-winner (p_winner_side is null).
  -- -------------------------------------------------------------------------
  if p_winner_side is not null then
    v_winner_id := case p_winner_side
      when 'attacker' then v_battle.attacker_id
      when 'defender' then v_battle.defender_id
    end;

    if v_winner_id is not null then
      -- Capture current XP before the update so we can compare levels.
      select xp into v_old_xp from players where id = v_winner_id;
      v_old_level := xp_level(v_old_xp);

      update players set xp = xp + 50 where id = v_winner_id;

      v_new_level := xp_level(v_old_xp + 50);

      -- -------------------------------------------------------------------
      -- §B: Level-milestone structure grant — fires when the 50-XP award
      -- crosses a multiple-of-5 level boundary (e.g. 5, 10, 15 ...).
      -- floor(new_level / 5) > floor(old_level / 5).
      -- NOTE: We only grant ONE card even if the jump theoretically skips
      -- more than one multiple-of-5 boundary (extremely unlikely at 50 XP
      -- per win, but kept simple intentionally).
      -- -------------------------------------------------------------------
      if floor(v_new_level::numeric / 5) > floor(v_old_level::numeric / 5) then
        v_structure_category := case when random() < 0.5 then 'castle' else 'village' end;
        insert into card_instances (template_id, owner_id, stationed_territory_id, status)
        values (v_structure_category || '-common', v_winner_id, null, 'stationed');
      end if;

      -- -------------------------------------------------------------------
      -- §C: 1% battle-win bonus structure card — independent of §B; both
      -- can trigger on the same win (intended).
      -- -------------------------------------------------------------------
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
-- 3. complete_kingdom_onboarding — full replacement adding 1 castle-common
--    and 1 village-common to the starter kit (§D). All other logic is
--    identical to the 0002_territories.sql version.
--    Structure cards sit in general inventory (stationed_territory_id = null)
--    until the player chooses where to build — build_structure only checks
--    card ownership, not location.
-- ---------------------------------------------------------------------------
create or replace function complete_kingdom_onboarding(new_kingdom_name text, new_coat_of_arms_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed_name text := trim(new_kingdom_name);
  caller uuid := auth.uid();
  home_id integer;
  starter_templates text[];
  tmpl_id text;
begin
  perform resolve_due_movements();

  if not is_valid_coat_of_arms_id(new_coat_of_arms_id) then
    raise exception 'invalid coat_of_arms_id: %', new_coat_of_arms_id;
  end if;
  if char_length(trimmed_name) < 3 or char_length(trimmed_name) > 30 then
    raise exception 'kingdom_name must be 3-30 characters';
  end if;

  update players
  set kingdom_name = trimmed_name,
      coat_of_arms_id = new_coat_of_arms_id,
      onboarding_completed = true
  where id = caller
    and onboarding_completed = false;

  if not found then
    raise exception 'onboarding already completed or player not found';
  end if;

  -- Home-territory assignment (§5), retried until a row-locked candidate
  -- is actually still free (closes the concurrent-onboarding race).
  for _ in 1..10 loop
    select c.id into home_id
    from (
      select t.id, t.x, t.y
      from territories t
      where t.owner_id is null and t.claim_locked_by is null
        and t.castle_rank is null and t.village_rank is null
        and t.difficulty <= 2
      order by (
        select coalesce(min(greatest(abs(t.x - h.x), abs(t.y - h.y))), 999999)
        from territories h where h.is_home
      ) desc
      limit 20
    ) c
    order by random()
    limit 1;

    if home_id is null then
      raise exception 'no candidate home territory found';
    end if;

    perform id from territories
    where id = home_id and owner_id is null and claim_locked_by is null
    for update;
    if found then
      update territories set owner_id = caller, is_home = true where id = home_id;
      exit;
    end if;
    home_id := null;
  end loop;

  if home_id is null then
    raise exception 'failed to assign a home territory after retries';
  end if;

  -- Starter army (§5): 6 common-rank unit templates, a spread of unit
  -- types, admin-minted and stationed at the new home tile.
  select array_agg(id) into starter_templates
  from (
    select id from card_templates
    where category = 'unit' and rank = 'common'
    order by random()
    limit 6
  ) s;

  foreach tmpl_id in array starter_templates loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (tmpl_id, caller, home_id, 'stationed');
  end loop;

  -- Starter structure cards (§D): 1 castle-common + 1 village-common,
  -- seated in general inventory (stationed_territory_id = null) so the
  -- player can later choose where to build via build_structure.
  -- Template IDs follow the pattern established in scripts/seed-card-templates.ts.
  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('castle-common', caller, null, 'stationed');
  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('village-common', caller, null, 'stationed');
end;
$$;
