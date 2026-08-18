-- Backlog #23 + #14: reinforcement lock + attack recall — manual SQL
-- verification checklist.
--
-- Paste into a scratch Supabase SQL editor only after
-- 0018_reinforcement_lock_and_recall.sql is applied. This file is not
-- executed automatically.
--
-- Setup: two scratch player accounts A (defender, owns a territory with a
-- garrison) and B (attacker, owns an adjacent/nearby territory with cards
-- to send).

-- ---------------------------------------------------------------------
-- 1. start_transfer rejected once a battle exists for the destination.
-- ---------------------------------------------------------------------
-- Have B declare_attack against A's territory and let the attack arrive
-- (or use debug_speed_up_movement) so a battle row is created.
-- Substitute :a_origin_id, :a_dest_id (A's own territories),
-- :a_card_instance_id (one of A's stationed unit cards at :a_origin_id).

select id, status from battles where territory_id = :a_dest_id order by created_at desc limit 1;
-- Expect: one row, status = 'awaiting_ready' (or 'active').

-- As A, attempt to reinforce the besieged territory:
select start_transfer(:a_origin_id, :a_dest_id, array[:a_card_instance_id]::uuid[]);
-- Expect: raises 'cannot reinforce a territory with an unresolved battle'.

-- ---------------------------------------------------------------------
-- 2. In-transit reinforcement is auto-recalled the instant the attacker
--    arrives and a battle is created.
-- ---------------------------------------------------------------------
-- Before B's attack arrives, have A start_transfer some cards toward the
-- soon-to-be-besieged territory (:a_dest_id), then let B's attack land.
-- Substitute :reinforcement_movement_id for the id returned by that
-- start_transfer call.

select id, kind, origin_territory_id, destination_territory_id, started_at,
       transfer_arrives_at, status
from troop_movements
where id = :reinforcement_movement_id;
-- Expect (once B's attack has arrived): kind = 'transfer', status =
-- 'in_transit' still, but origin_territory_id/destination_territory_id are
-- now SWAPPED from what start_transfer originally inserted (heading back
-- to A's original origin), and transfer_arrives_at is now roughly
-- (started_at_of_this_row + elapsed-time-already-traveled), i.e. much
-- sooner than the original arrival time would have been.

-- ---------------------------------------------------------------------
-- 3. recall_attack succeeds while the attack is still in transit, and
--    returns the troops home in exactly the time they'd already traveled.
-- ---------------------------------------------------------------------
-- Have B declare_attack again (a fresh one, on an undefended/empty target
-- so no battle races it), then shortly after call:
-- Substitute :attack_movement_id (the id declare_attack returned).

select recall_attack(:attack_movement_id);

select kind, origin_territory_id, destination_territory_id, started_at,
       transfer_arrives_at, status
from troop_movements
where id = :attack_movement_id;
-- Expect: kind = 'transfer', origin/destination swapped back toward B's
-- original origin, status = 'in_transit', transfer_arrives_at close to
-- now() + (however long ago declare_attack was called).

select battle_locked_by from territories where id = :a_dest_id_or_whatever_b_targeted;
-- Expect: null (the target territory is attackable again).

-- ---------------------------------------------------------------------
-- 4. recall_attack is rejected once the attack has already arrived.
-- ---------------------------------------------------------------------
-- Let a different attack fully arrive (a battle now exists for it), then:
select recall_attack(:already_arrived_movement_id);
-- Expect: raises 'this attack has already arrived and cannot be recalled'.
