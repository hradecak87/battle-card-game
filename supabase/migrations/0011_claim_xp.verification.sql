-- Claim-completion XP — manual SQL verification checklist
--
-- NOT part of the applied migration. Paste these into the Supabase SQL
-- editor *after* 0011_claim_xp.sql has been applied, to sanity-check the
-- empty-territory claim XP reward without needing the app running.
-- Run in a scratch/dev project only.

-- ---------------------------------------------------------------------
-- 1. Successful empty-territory claim completion awards exactly 15 XP.
-- ---------------------------------------------------------------------
-- Setup: authenticate as a real test player with:
-- - one owned origin territory (:origin_id)
-- - one empty/unowned target territory with no active claim/battle lock
--   and no NPC garrison (:destination_id)
-- - one stationed unit card on the origin territory (:card_instance_id)
--
-- Start the claim normally so the existing RPC sets up all related rows,
-- and verify that claim start itself does not grant XP early.
do $$
declare
  v_before integer;
  v_after integer;
begin
  select xp into v_before from players where id = auth.uid();
  perform start_claim(:origin_id, :destination_id, array[:card_instance_id]::uuid[]);
  select xp into v_after from players where id = auth.uid();

  assert v_after = v_before,
    format('Expected no XP on claim start, before=%s after=%s', v_before, v_after);
end;
$$;

-- Speed both stages up manually in the scratch DB so resolve_due_movements()
-- can finalize the claim immediately.
update troop_movements
set transfer_arrives_at = now() - interval '1 second'
where id = (
  select tm.id
  from troop_movements tm
  where tm.player_id = auth.uid()
    and tm.kind = 'claim'
    and tm.origin_territory_id = :origin_id
    and tm.destination_territory_id = :destination_id
  order by tm.started_at desc
  limit 1
);

update territories
set claim_transfer_arrives_at = now() - interval '1 second',
    claim_occupation_completes_at = now() - interval '1 second'
where id = :destination_id
  and claim_locked_by = auth.uid();

do $$
declare
  v_before integer;
  v_after integer;
  v_owner uuid;
begin
  select xp into v_before from players where id = auth.uid();

  perform resolve_due_movements();

  select xp into v_after from players where id = auth.uid();
  select owner_id into v_owner from territories where id = :destination_id;

  assert v_after = v_before + 15,
    format('Expected xp %s + 15 = %s, got %s', v_before, v_before + 15, v_after);
  assert v_owner = auth.uid(),
    format('Expected territory %s owner_id = auth.uid(), got %s', :destination_id, v_owner);

  v_before := v_after;
  perform resolve_due_movements();
  select xp into v_after from players where id = auth.uid();

  assert v_after = v_before,
    format('Expected no duplicate claim XP on a second resolve_due_movements(), before=%s after=%s', v_before, v_after);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Battle-win regression check (existing 0009 behavior still preserved).
-- ---------------------------------------------------------------------
-- Re-run the relevant steps from 0009_structure_card_rewards.verification.sql
-- to confirm a real battle win still grants exactly 50 XP plus the existing
-- level-milestone/1%-bonus behavior.
