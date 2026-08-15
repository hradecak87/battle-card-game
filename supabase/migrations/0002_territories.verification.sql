-- Territory Map — manual SQL verification checklist
--
-- NOT part of the applied migration. Paste these into the Supabase SQL
-- editor *after* 0002_territories.sql has been applied, to sanity-check
-- schema-level invariants without needing the app running. This is the
-- closest available substitute for spec §12's "SQL/integration tests"
-- until a live Supabase project exists and the RPCs (Tasks 5-7) can be
-- exercised end-to-end (same constraint 0001_players.sql was under).
--
-- Expected result is noted above each query. Run in a scratch/dev project
-- only — several of these intentionally insert rows.

-- ---------------------------------------------------------------------
-- 1. territories_home_unique_idx: a player can have at most one home tile.
-- ---------------------------------------------------------------------
-- Setup: pick or insert a real players.id first, e.g.
--   select id from players limit 1;
-- Then, using that id as :player_id:

insert into territories (x, y, difficulty, owner_id, is_home)
values (1, 1, 1, ':player_id', true);

-- Expect: FAILS with a unique constraint violation on
-- territories_home_unique_idx (assuming the seeded world already gave
-- this player a home tile via complete_kingdom_onboarding — Task 7).
insert into territories (x, y, difficulty, owner_id, is_home)
values (2, 2, 1, ':player_id', true);

-- ---------------------------------------------------------------------
-- 2. card_templates check constraint: village rows must not carry an
--    attack_bonus_pct (castle-only column).
-- ---------------------------------------------------------------------
-- Expect: FAILS the
--   check (category != 'village' or attack_bonus_pct is null)
-- constraint.
insert into card_templates
  (id, category, rank, name, flavor_text, defense_bonus_pct, attack_bonus_pct)
values
  ('village-common-verify', 'village', 'common', 'Test Village', 'flavor',
   10, 5);

-- Expect: SUCCEEDS (village with null attack_bonus_pct).
insert into card_templates
  (id, category, rank, name, flavor_text, defense_bonus_pct, attack_bonus_pct)
values
  ('village-common-verify-ok', 'village', 'common', 'Test Village', 'flavor',
   10, null);

-- ---------------------------------------------------------------------
-- 3. card_templates check constraint: unit rows must carry unit_type
--    and base_stats.
-- ---------------------------------------------------------------------
-- Expect: FAILS (unit_type and base_stats both null).
insert into card_templates
  (id, category, rank, name, flavor_text)
values
  ('unit-verify-bad', 'unit', 'common', 'Test Unit', 'flavor');

-- ---------------------------------------------------------------------
-- 4. RLS: anonymous/public role can select but not write.
-- ---------------------------------------------------------------------
-- Run as the `anon` role (e.g. via the Supabase client with the anon key,
-- or `set role anon;` in a session that has that role available).

-- Expect: SUCCEEDS, returns rows (public read-all policy).
select * from territories limit 5;

-- Expect: FAILS — no update policy exists for any of the 5 new tables.
update territories set owner_id = null where id = 1;

-- Expect: FAILS — no insert policy exists.
insert into territories (x, y, difficulty) values (300, 300, 1);

-- Expect: FAILS — no delete policy exists.
delete from territories where id = 1;

-- ---------------------------------------------------------------------
-- 5. Cleanup (run after verifying, to leave the scratch project tidy).
-- ---------------------------------------------------------------------
-- reset role; -- if you used `set role anon` above
delete from card_templates where id in
  ('village-common-verify', 'village-common-verify-ok');
delete from territories where x in (1, 2) and y in (1, 2) and difficulty = 1;
