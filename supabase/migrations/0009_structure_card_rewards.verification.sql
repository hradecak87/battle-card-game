-- Structure card rewards — manual SQL verification checklist
--
-- NOT part of the applied migration. Paste these into the Supabase SQL
-- editor *after* 0009_structure_card_rewards.sql has been applied, to
-- sanity-check the new logic without needing the app running.
-- Run in a scratch/dev project only.

-- ---------------------------------------------------------------------
-- 1. xp_level correctness
-- ---------------------------------------------------------------------
-- xpRequiredForLevel(1) = 0, xpRequiredForLevel(2) = 100, level 5 = 1000
-- Expect: 1
select xp_level(0);
-- Expect: 1
select xp_level(99);
-- Expect: 2
select xp_level(100);
-- Expect: 4
select xp_level(999);
-- Expect: 5
select xp_level(1000);
-- Expect: 5
select xp_level(1499);
-- Expect: 6
select xp_level(1500);

-- ---------------------------------------------------------------------
-- 2. XP +50 on attacker win — finalize a real PvP battle as 'attacker'
-- ---------------------------------------------------------------------
-- Setup: create a test player, a test battle with that player as attacker,
-- and a human defender (defender_id NOT null so XP fires).
-- :test_attacker_id, :test_defender_id, :test_battle_id

-- Expect: attacker's xp increases by exactly 50.
do $$
declare
  v_before integer;
  v_after integer;
begin
  select xp into v_before from players where id = :'test_attacker_id';
  -- Manually insert a minimal resolved-but-check test: call _finalize_battle
  -- on a pre-created battle row in status 'active'. See battle setup below.
  perform _finalize_battle(:'test_battle_id', 'attacker');
  select xp into v_after from players where id = :'test_attacker_id';
  assert v_after = v_before + 50,
    format('Expected xp %s + 50 = %s, got %s', v_before, v_before + 50, v_after);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. No XP on NPC win — battle with defender_id = null (NPC garrison)
-- ---------------------------------------------------------------------
-- Setup: create a test battle with defender_id = null (NPC target).
-- :test_npc_battle_id, :npc_attacker_id

-- Expect: attacker's xp does NOT change (NPC defender means attacker wins
-- vs NPC, but defender_id = null means NO XP awarded — only the winner's
-- player id matters; see §A logic).
-- Actually §A awards XP to the winner, and if winner is attacker and
-- attacker_id is not null, XP IS awarded. For NPC wins attacker wins,
-- so XP IS awarded to the attacker (non-null attacker_id).
-- The "skip NPC wins" comment means: when NPC *defends* and *wins*
-- (defender_id = null, winner_side = 'defender') — no XP since the
-- defender is null (NPC). When human attacks and wins vs NPC, XP IS
-- awarded to the human attacker. Verify:

do $$
declare
  v_before integer;
  v_after integer;
begin
  select xp into v_before from players where id = :'npc_attacker_id';
  perform _finalize_battle(:'test_npc_battle_id', 'attacker');  -- human wins vs NPC
  select xp into v_after from players where id = :'npc_attacker_id';
  assert v_after = v_before + 50,
    format('Expected xp %s + 50, got %s', v_before, v_after);
end;
$$;

-- Expect: no XP change when an NPC "wins" (defender_id null, winner_side = 'defender').
do $$
declare
  v_count_before integer;
begin
  select count(*) into v_count_before from players;
  -- Calling _finalize_battle with winner_side = 'defender' on a battle
  -- where defender_id = null: winner_id = null, so the XP block is skipped.
  -- Verify by checking no XP update occurred.
  -- (In practice you can confirm no UPDATE on players fired.)
  perform _finalize_battle(:'test_npc_defender_battle_id', 'defender');
end;
$$;

-- ---------------------------------------------------------------------
-- 4. No XP on expired battle (winner_side = null)
-- ---------------------------------------------------------------------
-- Setup: :test_expired_battle_id with both sides having real player ids.
-- Expect: neither player's xp changes.
do $$
declare
  v_xp_a integer; v_xp_d integer;
  v_xp_a2 integer; v_xp_d2 integer;
begin
  select xp into v_xp_a from players where id = :'expired_attacker_id';
  select xp into v_xp_d from players where id = :'expired_defender_id';
  perform _finalize_battle(:'test_expired_battle_id', null);
  select xp into v_xp_a2 from players where id = :'expired_attacker_id';
  select xp into v_xp_d2 from players where id = :'expired_defender_id';
  assert v_xp_a2 = v_xp_a and v_xp_d2 = v_xp_d,
    'Expected no XP change on expired battle';
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Level-milestone structure grant fires at level-5 boundary
-- ---------------------------------------------------------------------
-- xpRequiredForLevel(5) = 100 * 4 * 5 / 2 = 1000
-- xpRequiredForLevel(6) = 100 * 5 * 6 / 2 = 1500
-- A player with 950 XP is at level 4. After +50 XP they are at 1000 = level 5.
-- floor(5/5)=1 > floor(4/5)=0, so milestone fires.

-- Setup: set a test player's xp to 950, then finalize a win.
-- Expect: card_instances gains 1 new row with owner_id = :milestone_player_id
-- and template_id in ('castle-common', 'village-common').
do $$
declare
  v_count_before integer;
  v_count_after integer;
begin
  update players set xp = 950 where id = :'milestone_player_id';
  select count(*) into v_count_before
  from card_instances
  where owner_id = :'milestone_player_id'
    and template_id in ('castle-common', 'village-common');

  perform _finalize_battle(:'milestone_battle_id', 'attacker');  -- milestone player is attacker

  select count(*) into v_count_after
  from card_instances
  where owner_id = :'milestone_player_id'
    and template_id in ('castle-common', 'village-common');

  -- Count should increase by 1 (possibly 2 if the 1% bonus also fired,
  -- but the milestone grant is deterministic here).
  assert v_count_after >= v_count_before + 1,
    format('Expected at least 1 new structure card, before=%s after=%s',
           v_count_before, v_count_after);
end;
$$;

-- Verify milestone does NOT fire when not crossing a boundary:
-- Player at 850 XP (level 4) → 900 XP (still level 4). No milestone.
-- floor(4/5) = 0 = floor(4/5) → no grant.
-- (Manual check: repeat with xp = 850 and verify count stays the same
-- except for any 1% bonus roll.)

-- ---------------------------------------------------------------------
-- 6. Starter kit: 2 structure cards on onboarding
-- ---------------------------------------------------------------------
-- Setup: a fresh player with onboarding_completed = false.
-- Expect: after complete_kingdom_onboarding, card_instances contains
-- exactly 1 castle-common and 1 village-common for that player,
-- plus 6 unit cards = 8 total.
do $$
declare
  v_unit_count integer;
  v_castle_count integer;
  v_village_count integer;
begin
  -- Call onboarding for a test player.
  -- (Set auth.uid() = :onboarding_player_id via SET LOCAL role / jwt claims
  -- or use a service-role workaround in a real test environment.)
  perform complete_kingdom_onboarding('Test Království', 'coat_1');

  select count(*) into v_unit_count
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = auth.uid() and ct.category = 'unit';

  select count(*) into v_castle_count
  from card_instances
  where owner_id = auth.uid() and template_id = 'castle-common';

  select count(*) into v_village_count
  from card_instances
  where owner_id = auth.uid() and template_id = 'village-common';

  assert v_unit_count = 6,
    format('Expected 6 unit cards, got %s', v_unit_count);
  assert v_castle_count = 1,
    format('Expected 1 castle-common, got %s', v_castle_count);
  assert v_village_count = 1,
    format('Expected 1 village-common, got %s', v_village_count);
end;
$$;

-- Also verify the structure cards have stationed_territory_id = null
-- (general inventory, not physically stationed anywhere).
select instance_id, template_id, stationed_territory_id, status
from card_instances
where owner_id = auth.uid()
  and template_id in ('castle-common', 'village-common');
-- Expect: 2 rows, both with stationed_territory_id = null and status = 'stationed'.
