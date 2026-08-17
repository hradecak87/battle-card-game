-- Multi-Army RTS Battle — manual SQL verification checklist
--
-- NOT part of the applied migration. Run these *after* 0003_battles.sql
-- has been applied (Supabase SQL editor for the SQL statements below, and
-- psql or another client that supports `\d` for the schema-inspection
-- step), to sanity-check schema-level invariants without needing the app
-- running. This is the closest available substitute for the battle
-- spec's SQL/integration checks until a live or staging Supabase project
-- exists to run them against.
--
-- This checklist can only actually be executed once a live/staging
-- Supabase project exists, and must never be run against the live project
-- without explicit user go-ahead and a backup.
--
-- Expected result is noted above each query. Run in a scratch/dev project
-- only — several of these intentionally insert rows.

-- ---------------------------------------------------------------------
-- 1. battles table shape: confirm \d shows the expected check constraints.
-- ---------------------------------------------------------------------
-- Run in psql (or another client that supports `\d`).
-- Expect: `\d battles` shows the status and winner_side check constraints,
-- plus the expected PK/FK columns from the migration.
\d battles

-- ---------------------------------------------------------------------
-- 2. battles.status check constraint rejects invalid values.
-- ---------------------------------------------------------------------
-- Setup: pick real ids first, e.g.
--   select id from territories limit 1;
--   select id from players limit 1;
--   select id from troop_movements limit 1;
-- Then substitute them below as :territory_id, :attacker_id, :movement_id.

-- Expect: FAILS the
--   check (status in ('awaiting_ready','active','resolved','expired'))
-- constraint.
insert into battles
  (territory_id, attacker_id, movement_id, status, ready_deadline)
values
  (:territory_id, ':attacker_id', ':movement_id', 'invalid_status', now() + interval '10 days');

-- ---------------------------------------------------------------------
-- 3. RLS: anonymous/public role can read battle_rounds but cannot insert.
-- ---------------------------------------------------------------------
-- Run as the `anon` role (e.g. via the Supabase client with the anon key,
-- or `set role anon;` in a session that has that role available).

-- Expect: SUCCEEDS, returns rows if any exist (public read-all policy).
select * from battle_rounds limit 5;

-- Expect: FAILS — no insert policy exists for battle_rounds.
insert into battle_rounds (battle_id, round_number)
values ('00000000-0000-0000-0000-000000000001', 1);

-- ---------------------------------------------------------------------
-- 4. troop_movements.kind now accepts 'attack'.
-- ---------------------------------------------------------------------
-- Setup: pick a real player and two real territory ids first, e.g.
--   select id from players limit 1;
--   select id from territories limit 2;
-- Then substitute them below as :player_id, :origin_id, :destination_id.

-- Expect: SUCCEEDS (assuming the FK ids are real), proving the widened
-- troop_movements_kind_check now accepts 'attack'.
insert into troop_movements
  (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
values
  (':player_id', 'attack', :origin_id, :destination_id, now() + interval '1 hour');

-- ---------------------------------------------------------------------
-- 5. Cleanup (run after verifying, to leave the scratch project tidy).
-- ---------------------------------------------------------------------
-- reset role; -- if you used `set role anon` above
delete from troop_movements
where kind = 'attack'
  and player_id = ':player_id'
  and origin_territory_id = :origin_id
  and destination_territory_id = :destination_id;

-- ---------------------------------------------------------------------
-- 6. declare_attack() rejection paths (Task 7). Run authenticated as a
--    real test player (so auth.uid() resolves), substituting real ids.
-- ---------------------------------------------------------------------

-- Expect: FAILS with 'target territory already has a battle in progress'
-- (target territory has battle_locked_by set / an active non-resolved battle).
select declare_attack(:origin_id, :battle_locked_target_id, array[:card_instance_id]::uuid[]);

-- Expect: FAILS with 'caller cannot attack their own owned/claimed territory'
-- (target is either owned by the caller or claim_locked_by = caller).
select declare_attack(:origin_id, :my_own_or_claimed_target_id, array[:card_instance_id]::uuid[]);

-- Expect: FAILS with 'one or more card instances are not eligible to send'
-- (card is not owned by the caller, not stationed at origin_id, or not stationed).
select declare_attack(:origin_id, :valid_enemy_target_id, array[:non_owned_or_non_stationed_card_instance_id]::uuid[]);

-- Expect: FAILS with 'territory ownership cap (32) reached'
-- (caller already owns/claims 32 territories and target is non-home, so capture is plausible).
select declare_attack(:origin_id, :non_home_enemy_target_id, array[:card_instance_id]::uuid[]);

-- ---------------------------------------------------------------------
-- 7. Amended RPC rejection paths (Task 8). Run authenticated as a real
--    test player, substituting real ids.
-- ---------------------------------------------------------------------

-- Expect: FAILS with 'destination territory is not available to claim'
-- (destination has an NPC garrison: owner_id is null, claim_locked_by is
-- null, and at least one ownerless unit card is stationed there).
select start_claim(:origin_id, :npc_garrison_destination_id, array[:card_instance_id]::uuid[]);

-- Expect: FAILS with 'destination territory is not available to claim'
-- (destination has battle_locked_by set by another in-progress attack/battle).
select start_claim(:origin_id, :battle_locked_destination_id, array[:card_instance_id]::uuid[]);

-- Expect: FAILS with 'cannot cancel a claim while defending an active battle on this territory'
-- (caller is the defender of an active contested-claim battle on territory_id).
select cancel_claim(:actively_defended_claim_territory_id);

-- Expect: FAILS with 'territory is currently battle-locked'
-- (territory has battle_locked_by set while the caller tries to build).
select build_structure(:battle_locked_owned_territory_id, :structure_card_instance_id);

-- ---------------------------------------------------------------------
-- 8. resolve_due_movements() attack-arrival classification (Task 9).
-- ---------------------------------------------------------------------
-- Setup for each case below: in a scratch project, prepare a due
-- `troop_movements.kind = 'attack'` row plus its
-- `troop_movement_units` rows, with `transfer_arrives_at <= now()` and
-- the destination territory already `battle_locked_by = attacker_id`
-- from the original declare_attack() call. Then run:
select resolve_due_movements();

-- 8a. Occupied enemy territory.
-- Expect: SUCCEEDS; a battles row exists for the attack movement with
-- `defender_id = owner_id`, `status = 'awaiting_ready'`, and the
-- attacker's roster copied into battle_attacker_roster.
select b.id, b.territory_id, b.attacker_id, b.defender_id, b.status, b.is_home_target
from battles b
where b.movement_id = ':occupied_attack_movement_id';

select bar.card_instance_id
from battle_attacker_roster bar
where bar.battle_id = ':occupied_battle_id'
order by bar.card_instance_id;

-- 8b. Contested claim.
-- Expect: SUCCEEDS; a battles row exists with `defender_id =
-- claim_locked_by`, `status = 'awaiting_ready'`, the territory's
-- original `claim_locked_by` is unchanged, and the original claimant's
-- troop_movement row is untouched.
select b.id, b.territory_id, b.attacker_id, b.defender_id, b.status, b.is_home_target
from battles b
where b.movement_id = ':contested_claim_attack_movement_id';

select t.claim_locked_by, t.battle_locked_by
from territories t
where t.id = :contested_claim_territory_id;

select tm.id, tm.kind, tm.status
from troop_movements tm
where tm.id = ':original_claim_movement_id';

-- 8c. NPC-garrisoned territory.
-- Expect: SUCCEEDS; a battles row exists with `defender_id is null`,
-- `status = 'active'`, and `round_deadline` already due (`<= now()`),
-- ready for the immediate _start_next_round() handoff.
select b.id, b.territory_id, b.attacker_id, b.defender_id, b.status, b.round_deadline
from battles b
where b.movement_id = ':npc_attack_movement_id';

select bar.card_instance_id
from battle_attacker_roster bar
where bar.battle_id = ':npc_battle_id'
order by bar.card_instance_id;

-- 8d. Now truly empty territory.
-- Expect: SUCCEEDS; no battles row exists for the original attack
-- movement, `claim_locked_by` is set to the attacker instead,
-- `battle_locked_by` is cleared, and a fresh `kind = 'claim'`
-- troop_movement row now carries the occupation phase.
select count(*) as battle_rows_for_empty_arrival
from battles
where movement_id = ':empty_arrival_attack_movement_id';

select t.claim_locked_by, t.battle_locked_by, t.claim_transfer_arrives_at, t.claim_occupation_completes_at
from territories t
where t.id = :empty_arrival_territory_id;

select tm.id, tm.kind, tm.origin_territory_id, tm.destination_territory_id, tm.status, tm.transfer_arrives_at
from troop_movements tm
where tm.kind = 'claim'
  and tm.player_id = ':attacker_id'
  and tm.destination_territory_id = :empty_arrival_territory_id
order by tm.started_at desc
limit 1;

-- =====================================================================
-- CHUNK 5: resolve_due_battles() verification batches (Tasks 10-12)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 9. Ready-timeout outcomes (Task 10, 4 sub-cases). Setup for each: a
-- 'awaiting_ready' battles row with ready_deadline already <= now(),
-- linked to a real troop_movements row (movement_id) whose
-- origin_territory_id is the attacker's real origin, and a real
-- battle_attacker_roster with a couple of card_instance_ids currently
-- owned by the attacker and stationed at the battle's territory_id.
-- ---------------------------------------------------------------------

-- 9a. Neither ready: expired outcome.
-- Setup: attacker_ready_at = null, defender_ready_at = null.
select resolve_due_battles();
-- Expect: battles.status = 'expired', winner_side = null, resolved_at set.
select b.status, b.winner_side, b.resolved_at
from battles b where b.id = ':neither_ready_battle_id';
-- Expect: territories.battle_locked_by cleared, owner_id/claim_locked_by unchanged.
select t.owner_id, t.claim_locked_by, t.battle_locked_by
from territories t where t.id = :neither_ready_territory_id;
-- Expect: the attacker's roster cards are now 'in_transit' (a new
-- kind='transfer' troop_movements row back to their origin was created).
select ci.instance_id, ci.status, ci.stationed_territory_id
from card_instances ci
where ci.instance_id = any(array[':roster_card_1', ':roster_card_2']::uuid[]);
select tm.id, tm.kind, tm.origin_territory_id, tm.destination_territory_id
from troop_movements tm
where tm.player_id = ':attacker_id' and tm.kind = 'transfer'
order by tm.started_at desc limit 1;

-- 9b. Only defender ready: defender wins outright.
-- Setup: attacker_ready_at = null, defender_ready_at = <some past time>.
-- Expect: same cleanup as 9a, but winner_side = 'defender'.
select resolve_due_battles();
select b.status, b.winner_side from battles b where b.id = ':defender_only_ready_battle_id';

-- 9c. Only attacker ready, target is a plain non-home/non-capped
-- territory: attacker captures outright.
-- Setup: attacker_ready_at = <past time>, defender_ready_at = null,
-- battles.is_home_target = false, attacker owns/claims < 32 territories.
select resolve_due_battles();
-- Expect: winner_side = 'attacker', status = 'resolved'.
select b.status, b.winner_side from battles b where b.id = ':attacker_capture_battle_id';
-- Expect: territories.owner_id = attacker_id, claim_locked_by/battle_locked_by cleared.
select t.owner_id, t.claim_locked_by, t.battle_locked_by
from territories t where t.id = :attacker_capture_territory_id;
-- Expect: the attacker's roster cards remain 'stationed' at the territory
-- (no movement needed — spec §2's uniform rule).
select ci.instance_id, ci.status, ci.stationed_territory_id
from card_instances ci
where ci.instance_id = any(array[':roster_card_1', ':roster_card_2']::uuid[]);
-- Expect: if the defender had any of its own cards still stationed there
-- (untouched, since no combat ran), they are now 'in_transit' home to the
-- defender's own home territory.
select ci.instance_id, ci.status
from card_instances ci
where ci.instance_id = ':defender_untouched_card_id';

-- 9d. Only attacker ready, but the target is the defender's home
-- territory (is_home_target = true): capture is blocked outright.
-- Setup: same as 9c but battles.is_home_target = true.
select resolve_due_battles();
-- Expect: winner_side = 'attacker' still, status = 'resolved', but
-- territories.owner_id is UNCHANGED (still the defender), only
-- battle_locked_by clears; the attacker's roster is sent home instead.
select b.status, b.winner_side from battles b where b.id = ':blocked_home_target_battle_id';
select t.owner_id, t.battle_locked_by from territories t where t.id = :home_target_territory_id;
select ci.instance_id, ci.status
from card_instances ci
where ci.instance_id = any(array[':roster_card_1', ':roster_card_2']::uuid[]);

-- ---------------------------------------------------------------------
-- 10. Full 3-round PvP battle fixture (Task 11 + 12).
-- Setup: a 'active' battles row, current_round = 0, a
-- battle_attacker_roster with several card_instance_ids, and a defender
-- with several unit card_instances stationed at territory_id. Call
-- select _start_next_round(':pvp_battle_id'); once to insert round 1's
-- pending battle_rounds row (attacker_card_instance_id set, defender
-- null, round_deadline = now() + 120s).
-- ---------------------------------------------------------------------

-- 10a. Backdate round_deadline to simulate a timeout, then let
-- resolve_due_battles() auto-pick the defender's card for round 1.
update battles set round_deadline = now() - interval '1 second'
where id = ':pvp_battle_id';
select resolve_due_battles();
-- Expect: battle_rounds round_number=1 now has defender_card_instance_id
-- set, auto_picked = true, winner_card_instance_id set, resolved_at updated.
select round_number, attacker_card_instance_id, defender_card_instance_id,
       winner_card_instance_id, auto_picked, skipped
from battle_rounds where battle_id = ':pvp_battle_id' order by round_number;
-- Expect: battles.current_round = 1.
select current_round from battles where id = ':pvp_battle_id';
-- **Critical assertion**: both cards used in round 1 now rest until round
-- 3 (1 + 2), NOT round 2 — this is the round-arithmetic ordering bug this
-- plan spent 9 review rounds catching.
select card_instance_id, resting_until_round
from battle_unit_rest where battle_id = ':pvp_battle_id';
-- Expect: the round's loser card's owner_id now equals the winner card's
-- owner_id (capture happened immediately).
select instance_id, owner_id from card_instances
where instance_id in (':round1_attacker_card', ':round1_defender_card');

-- 10b/10c. Repeat 10a's backdate-then-resolve_due_battles() cycle twice
-- more for rounds 2 and 3, hand-checking the same assertions each time,
-- until one side's card_instances/battle_attacker_roster count reaches
-- zero and the battle finalizes.
-- Expect (final): battles.status = 'resolved', winner_side matches
-- whichever side ran out of cards, territories.owner_id updated only if
-- winner_side = 'attacker' and the territory isn't home/capped.
select status, winner_side, current_round from battles where id = ':pvp_battle_id';

-- ---------------------------------------------------------------------
-- 11. NPC battle fixture (Task 9 + 11 synchronous resolution).
-- Setup: declare_attack() against an NPC-garrisoned tile (owner_id and
-- claim_locked_by both null, at least one ownerless unit card stationed
-- there), then backdate the resulting troop_movements row's
-- transfer_arrives_at to the past.
-- ---------------------------------------------------------------------
select resolve_due_movements();
-- Expect: the single call above already resolved the ENTIRE battle
-- synchronously via resolve_due_movements() -> _start_next_round()'s NPC
-- loop — status is already 'resolved', with a full battle_rounds trail.
select status, winner_side, current_round from battles where id = ':npc_battle_id';
select round_number, attacker_card_instance_id, defender_card_instance_id, skipped
from battle_rounds where battle_id = ':npc_battle_id' order by round_number;
-- Expect: calling resolve_due_battles() afterward is a harmless no-op —
-- guards against a future regression reintroducing a dependency on it.
select resolve_due_battles();
select status, current_round from battles where id = ':npc_battle_id'; -- unchanged

-- ---------------------------------------------------------------------
-- 12. Skip-round fixture: attacker's entire roster resting for one round
-- (Task 11's skip-round path, PvP side).
-- Setup: an 'active' PvP battle where every battle_attacker_roster card
-- instance has a battle_unit_rest row with resting_until_round >= the
-- round about to start; the defender has at least one available card.
-- ---------------------------------------------------------------------
select _start_next_round(':pvp_skip_battle_id');
-- Expect: a battle_rounds row with skipped = true for that round number,
-- attacker_card_instance_id/defender_card_instance_id/winner_card_instance_id
-- all null, and battles.current_round incremented despite no duel — then
-- the function recurses into the following round automatically.
select round_number, skipped, attacker_card_instance_id
from battle_rounds where battle_id = ':pvp_skip_battle_id' order by round_number;

-- ---------------------------------------------------------------------
-- 13. Second skip-round fixture: a small, 2-card NPC garrison where both
-- cards end up resting simultaneously (Task 11's fix for the previously-
-- unhandled all-resting-NPC-defender case).
-- Setup: an 'active' NPC battle (defender_id is null) where both of the
-- 2 remaining NPC unit card_instances at territory_id have a
-- battle_unit_rest row with resting_until_round >= the round about to
-- start; the attacker has at least one available roster card.
-- ---------------------------------------------------------------------
select _start_next_round(':npc_skip_battle_id');
-- Expect: the round is logged skipped = true (NOT an unhandled-exception
-- crash from _pick_npc_defender_card being called with zero candidates),
-- current_round increments, and the function recurses to the next round
-- — once the NPC cards' rest clears (a later round number), combat
-- resumes normally.
select round_number, skipped from battle_rounds
where battle_id = ':npc_skip_battle_id' order by round_number;

-- =====================================================================
-- CHUNK 6: mark_ready + pick_defender_card verification batches
-- (Tasks 13-14)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 14. mark_ready(): idempotent, re-callable, joint-online check.
-- Setup: an 'awaiting_ready' battle with attacker_id/defender_id set to
-- two real players. Backdate/forward-date players.last_seen_at as noted.
-- ---------------------------------------------------------------------

-- 14a. Attacker calls first: sets attacker_ready_at, stays awaiting_ready.
select mark_ready(':mr_battle_id'); -- as attacker
select status, attacker_ready_at, defender_ready_at
from battles where id = ':mr_battle_id';
-- Expect: status still 'awaiting_ready', attacker_ready_at set, defender_ready_at null.

-- 14b. Defender calls next, both currently online (last_seen_at fresh):
-- flips to active and creates round 1's pending battle_rounds row.
select mark_ready(':mr_battle_id'); -- as defender
select status, current_round from battles where id = ':mr_battle_id';
-- Expect: status = 'active'.
select round_number, attacker_card_instance_id, defender_card_instance_id
from battle_rounds where battle_id = ':mr_battle_id' order by round_number;
-- Expect: one row, round_number = 1, attacker_card_instance_id set, defender null.
select round_deadline from battles where id = ':mr_battle_id';
-- Expect: round_deadline ~120s in the future (set by _start_next_round).

-- 14c. Not-simultaneously-online case: fresh awaiting_ready battle,
-- attacker readies, then defender's last_seen_at is backdated to
-- > 2 minutes ago before defender calls mark_ready.
select mark_ready(':mr_offline_battle_id'); -- attacker
update players set last_seen_at = now() - interval '5 minutes'
where id = ':mr_offline_defender_id';
select mark_ready(':mr_offline_battle_id'); -- defender
select status, attacker_ready_at, defender_ready_at
from battles where id = ':mr_offline_battle_id';
-- Expect: status still 'awaiting_ready' (both *_ready_at now set, but the
-- online-overlap check failed) — no round created.
select count(*) from battle_rounds where battle_id = ':mr_offline_battle_id';
-- Expect: 0.

-- 14d. Third, later call re-evaluates and can still flip to active once
-- both are simultaneously online again (confirms re-callability).
update players set last_seen_at = now() where id = ':mr_offline_defender_id';
select mark_ready(':mr_offline_battle_id'); -- either side, re-call
select status from battles where id = ':mr_offline_battle_id';
-- Expect: 'active' now.

-- 14e. Non-participant caller raises.
-- (call mark_ready(':mr_battle_id') as a third, unrelated player)
-- Expect: exception 'caller is not a participant in this battle'.

-- ---------------------------------------------------------------------
-- 15. pick_defender_card(): explicit human defender pick.
-- Setup: an 'active' PvP battle with a pending round (attacker_card_
-- instance_id set, defender null, round_deadline in the future).
-- ---------------------------------------------------------------------

-- 15a. Valid pick resolves the round.
select pick_defender_card(':pdc_battle_id', ':pdc_defender_card_id');
select round_number, defender_card_instance_id, winner_card_instance_id, auto_picked
from battle_rounds where battle_id = ':pdc_battle_id' order by round_number desc limit 1;
-- Expect: defender_card_instance_id = ':pdc_defender_card_id', auto_picked = false,
-- winner_card_instance_id set, and (if not a win-condition round) a new
-- pending round row for round_number+1, round_deadline reset ~120s out.
select status, current_round, round_deadline from battles where id = ':pdc_battle_id';

-- 15b. Picking a resting card raises.
-- (call pick_defender_card with a card_instance_id known to have a
-- battle_unit_rest row with resting_until_round >= current_round + 1)
-- Expect: exception 'card is currently resting'.

-- 15c. Picking a foreign (not caller-owned) or non-unit (castle/village
-- template) card raises.
-- Expect: exception 'card is not an eligible defender for this battle'.

-- 15d. Picking after the round already has a pick raises (simulate two
-- near-simultaneous pick_defender_card calls for the same round).
-- Expect: exception 'this round already has a defender pick'.

-- 15e. Non-defender caller (attacker, or an unrelated player) raises.
-- Expect: exception 'caller is not the defender of this battle'.

-- 15f. Win-condition round: defender's pick is the round that eliminates
-- the attacker's last available card — finalizes identically to Task
-- 12's fixtures (battles.status = 'resolved', winner_side = 'defender',
-- territory ownership/card-movement cleanup all applied).
select pick_defender_card(':pdc_final_battle_id', ':pdc_final_defender_card_id');
select status, winner_side from battles where id = ':pdc_final_battle_id';

-- =====================================================================
-- CHUNK 7: get_battle read RPC + viewport/minimap battle_id exposure
-- (Tasks 15-16, 20's SQL portion)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 16. get_battle(): one-round-trip battle screen payload.
-- ---------------------------------------------------------------------

-- 16a. Normal active PvP battle: confirm all 4 sections populated and
-- shaped as the client (lib/battles/api.ts's GetBattleResult) expects.
select * from get_battle(':gb_active_battle_id');
-- Expect: `battle` jsonb has status/current_round/round_deadline/
-- winner_side/attacker_id/defender_id/is_home_target; `attacker_roster`
-- is a jsonb array with instance_id/owner_id/status/template/is_resting
-- per entry; `defender_pool` likewise, restricted to unit-category cards
-- currently owned by defender_id (or ownerless, for an NPC target)
-- stationed at territory_id; `rounds` is the full battle_rounds history
-- ordered by round_number.

-- 16b. Lazy-resolution-on-read: an awaiting_ready battle whose
-- ready_deadline has already passed, with no ready confirmations.
select * from get_battle(':gb_expired_battle_id');
-- Expect: the `battle` jsonb's status is already 'expired' (get_battle's
-- resolve_due_battles() call resolved it inline during this same read),
-- not still 'awaiting_ready' — confirms the lazy trigger works for the
-- read path too, matching every mutating RPC's convention.

-- ---------------------------------------------------------------------
-- 17. get_viewport()/get_minimap_overview(): battle_locked_by + battle_id
-- exposure for the map's "under attack" indicator (Task 20).
-- ---------------------------------------------------------------------
select id, x, y, battle_locked_by, battle_id
from get_viewport(:territory_x - 2, :territory_y - 2, :territory_x + 2, :territory_y + 2);
-- Expect: the territory with an in-progress battle shows
-- battle_locked_by = attacker's id and battle_id = that battle's real id;
-- every other territory in the window shows both null.

select x, y, battle_locked_by, battle_id from get_minimap_overview();
-- Expect: same — the battle-locked tile appears in the overview (even if
-- otherwise unowned/unclaimed, since a plain empty tile under
-- counter-attack must still surface via battle_locked_by is not null)
-- with the correct battle_id; a resolved/expired battle's territory
-- shows both columns null again (battle_locked_by is cleared by
-- _finalize_battle, and the `status not in ('resolved','expired')`
-- subquery filter excludes it even before that column clears, as a
-- defensive double-check).

-- ---------------------------------------------------------------------
-- 18. 0007_combat_probability.sql: stored win probability + upset flavor.
-- ---------------------------------------------------------------------

-- 18a. Any newly resolved non-skipped round now stores the attacker's win
-- probability, always bounded to the closed interval [0.03, 0.97].
select round_number, attacker_win_probability, flavor_text
from battle_rounds
where battle_id = ':gb_active_battle_id' and skipped = false
order by round_number desc
limit 5;
-- Expect: attacker_win_probability is never null for rounds resolved after
-- 0007 was applied, and always falls between 0.03 and 0.97 inclusive.
-- flavor_text is null for normal favorite wins, or a seeded Czech upset line
-- when the random winner differed from the old lower-TTK favorite.

-- 18b. get_battle() now surfaces those same per-round fields through the
-- existing rounds json payload.
select rounds
from get_battle(':gb_active_battle_id');
-- Expect: each resolved round JSON object includes
-- attacker_win_probability and flavor_text alongside attacker_atk /
-- attacker_dmg_dealt / attacker_ttk / defender_*.
