-- Verification checklist for 0024_king_relocate_home.sql (#28).
-- Run in a scratch/dev DB only.

-- 1. Eligible player (level 15+, ability unused) relocates from their
--    current home to another owned territory:
--    - Expect old territory.is_home = false, new territory.is_home = true,
--      players.king_relocation_used_at set non-null.

-- 2. Player below level 15 calls relocate_home(...):
--    - Expect exception 'king ability unlocks at level 15'.

-- 3. Player targets a territory they do not own:
--    - Expect exception 'caller does not own p_new_territory_id'.

-- 4. Player targets their current home territory:
--    - Expect exception 'p_new_territory_id is already your home territory'.

-- 5. Player tries to use the ability twice:
--    - First call succeeds; second call raises
--      'king ability has already been used'.

-- 6. Target territory is under attack / in an unresolved battle:
--    - Expect exception 'cannot relocate home to a territory with an unresolved battle'.

-- 7. Target territory has an active claim lock for any reason:
--    - Expect exception 'cannot relocate home to a territory with an active claim'.
