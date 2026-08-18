-- Backlog #10: attack-adjacency verification checklist
--
-- Paste into a scratch Supabase SQL editor only after 0017_attack_adjacency.sql
-- is applied. This file is not executed automatically.
--
-- Recommended setup: two scratch player accounts A (owner) and B (attacker),
-- an area of the 256x256 grid you control for the test, and an origin
-- territory already owned by B with some stationed unit cards on it.

-- ---------------------------------------------------------------------
-- 1. Interior territory (all 4 orthogonal neighbors owned by the same
--    player) cannot be attacked.
-- ---------------------------------------------------------------------
-- Substitute :ax, :ay for a 3x3 (or larger) block's center coordinates, all
-- owned by player A, and set up B's origin/cards as usual.

-- Sanity check the block is actually set up as intended:
select x, y, owner_id from territories
where x between :ax - 1 and :ax + 1 and y between :ay - 1 and :ay + 1
order by y, x;
-- Expect: all 9 rows have owner_id = A's id.

-- Attempt the attack as B (via the app or by calling the RPC directly while
-- authenticated as B) against the center (:ax, :ay) territory.
-- Expect: declare_attack raises
--   'target territory is surrounded by owner''s own territory and cannot be attacked directly'

-- ---------------------------------------------------------------------
-- 2. Border territory of the same block (has at least one differing
--    neighbor) can be attacked normally.
-- ---------------------------------------------------------------------
-- Attempt the attack as B against one of the block's edge/corner
-- territories (not the center).
-- Expect: declare_attack succeeds and returns a movement id, exactly as
-- before this migration.

-- ---------------------------------------------------------------------
-- 3. Grid-edge territory is always attackable regardless of its other
--    neighbors, because at least one neighbor coordinate is off-grid.
-- ---------------------------------------------------------------------
-- Set up a small block owned by A that includes a territory at x = 0 (or
-- x = 255 / y = 0 / y = 255), with its in-grid neighbors also owned by A.
-- Attempt the attack as B against that edge territory.
-- Expect: declare_attack succeeds — the off-grid neighbor counts as "not
-- owned by A", so the territory is never fully surrounded.

-- ---------------------------------------------------------------------
-- 4. NPC-garrisoned and truly empty territories (owner_id is null) remain
--    always attackable, regardless of their neighbors' ownership.
-- ---------------------------------------------------------------------
-- Substitute :npc_or_empty_id for a territory with owner_id is null,
-- surrounded on all 4 sides by the same player's territory (if you can
-- construct such a case; otherwise any owner_id is null target suffices).
select id, owner_id from territories where id = :npc_or_empty_id;
-- Expect: owner_id is null.

-- Attempt the attack as B against that territory.
-- Expect: declare_attack succeeds exactly as before this migration (subject
-- to the other existing checks: not caller's own, no existing battle lock,
-- ownership cap, etc.).
