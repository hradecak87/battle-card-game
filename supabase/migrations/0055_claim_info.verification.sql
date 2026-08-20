-- 0055_claim_info.verification.sql
--
-- Safe verification for get_claim_info(). Runs in a transaction and
-- finishes with ROLLBACK.

begin;

do $$
declare
  v_claimant uuid;
  v_home_id integer;
  v_target_id integer;
  v_result record;
begin
  assert to_regprocedure('get_claim_info(integer)') is not null,
    'missing get_claim_info(integer)';

  select id into v_claimant from players where is_npc = false limit 1;
  assert v_claimant is not null, 'need at least one non-NPC player to test with';

  select id into v_home_id from territories where owner_id = v_claimant and is_home = true limit 1;

  select id into v_target_id from territories
    where owner_id is null and claim_locked_by is null
    order by id limit 1;
  assert v_target_id is not null, 'need at least one unclaimed empty territory to test with';

  update territories set claim_locked_by = v_claimant where id = v_target_id;

  select * into v_result from get_claim_info(v_target_id);
  assert v_result.claimant_id = v_claimant, 'claimant_id should match the player who locked the claim';
  assert v_result.claimant_home_x is not distinct from (select x from territories where id = v_home_id),
    'claimant_home_x should match the claimant''s home territory x';

  -- No claim in progress -> no rows.
  update territories set claim_locked_by = null where id = v_target_id;
  perform 1 from get_claim_info(v_target_id);
  assert not found, 'get_claim_info should return no rows once claim_locked_by is cleared';

  raise notice 'get_claim_info verification passed';
end $$;

rollback;
