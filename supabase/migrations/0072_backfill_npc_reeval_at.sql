-- Backfill npc_reeval_at for NPC attack movements that were declared
-- before 0067_npc_attack_cancellation.sql was deployed.
--
-- resolve_due_npc_attack_reevaluations() only processes rows where
-- npc_reeval_at is not null (that column is only set right after
-- _declare_attack_core is called from resolve_due_npc_actions()). Any
-- attack already in transit at the time 0067 was deployed never got that
-- column populated, so it's permanently invisible to the reevaluation
-- job -- the NPC will never reconsider or cancel it, no matter how much
-- the defender reinforces.
--
-- This is a one-off data backfill, not a behavior change: it sets
-- npc_reeval_at = now() on the affected rows so they're picked up by the
-- very next resolve_due_npc_attack_reevaluations() run (invoked from
-- resolve_due_movements()), exactly as if they had just been scheduled
-- for their regular 30-minute reevaluation.
update troop_movements tm
set npc_reeval_at = now()
from players npc
where npc.id = tm.player_id
  and npc.is_npc = true
  and tm.kind = 'attack'
  and tm.status = 'in_transit'
  and tm.npc_reeval_at is null;
