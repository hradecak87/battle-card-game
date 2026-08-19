-- Manual verification checklist for 0019_battle_surrender.sql
-- Run each block against a live/staging DB with two real player accounts.

-- 1. Attacker surrenders an active battle:
--    - Call surrender_battle(battle_id) as the attacker.
--    - Expect: battle.status = 'resolved', winner_side = 'defender'.
--    - Territory ownership unchanged (still defender's).
--    - Attacker's remaining roster cards get a new troop_movements row
--      (kind='transfer') back to the attack's original origin territory,
--      with the FULL transfer duration (not shortened).
--    - Defender gets +50 XP.

-- 2. Defender surrenders an active battle (non-home territory, attacker
--    under the 32-territory cap):
--    - Call surrender_battle(battle_id) as the defender.
--    - Expect: battle.status = 'resolved', winner_side = 'attacker'.
--    - Territory ownership flips to the attacker.
--    - Defender's remaining roster cards get a new troop_movements row
--      to the defender's NEAREST other owned territory (by Chebyshev
--      distance), not necessarily their home.
--    - Attacker gets +50 XP.

-- 3. Defender surrenders while the battle's territory is their home
--    (is_home_target = true):
--    - Expect: territory NOT captured (owner unchanged), battle_locked_by
--      cleared, winner_side = 'attacker' still recorded, defender's
--      remaining cards untouched (capture branch didn't run).

-- 4. Non-participant (spectator) calls surrender_battle:
--    - Expect: exception 'caller is not a participant in this battle'.

-- 5. surrender_battle called on a battle with status != 'active'
--    (e.g. 'awaiting_ready' or already 'resolved'):
--    - Expect: exception 'battle is not currently active and cannot be
--      surrendered'.

-- 6. Existing (non-surrender) call sites of _finalize_battle
--    (_start_next_round's win-condition checks, resolve_due_battles'
--    awaiting_ready timeout branch) still behave exactly as before —
--    p_defender_surrendered defaults to false, so a normal combat win or
--    a no-show walkover still sends the defender's cards home.
