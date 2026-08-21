begin;

do $$
declare
  v_caller uuid;
  v_target uuid;
  v_third_player uuid;
  v_npc_owner uuid;
  v_offer_id uuid;
  v_offer_reject_id uuid;
  v_offer_cancel_id uuid;
  v_relation_state text;
  v_pact_count integer;
  v_event_count integer;
  v_failed boolean;
  v_coalition_id uuid := gen_random_uuid();
begin
  assert to_regprocedure('diplomacy_propose_non_aggression(uuid)') is not null,
    'missing diplomacy_propose_non_aggression(uuid)';
  assert to_regprocedure('diplomacy_accept_non_aggression(uuid)') is not null,
    'missing diplomacy_accept_non_aggression(uuid)';
  assert to_regprocedure('diplomacy_reject_non_aggression(uuid)') is not null,
    'missing diplomacy_reject_non_aggression(uuid)';
  assert to_regprocedure('diplomacy_cancel_non_aggression(uuid)') is not null,
    'missing diplomacy_cancel_non_aggression(uuid)';
  assert to_regprocedure('diplomacy_list_non_aggression_pacts()') is not null,
    'missing diplomacy_list_non_aggression_pacts()';

  select p1.id, p2.id, p3.id
  into v_caller, v_target, v_third_player
  from players p1
  join players p2 on p2.id <> p1.id
  join players p3 on p3.id <> p1.id and p3.id <> p2.id
  where coalesce(p1.is_npc, false) = false
    and coalesce(p2.is_npc, false) = false
    and coalesce(p3.is_npc, false) = false
    and not exists (select 1 from coalition_members cm where cm.player_id in (p1.id, p2.id, p3.id))
  order by p1.created_at, p2.created_at, p3.created_at
  limit 1;

  select id
  into v_npc_owner
  from players
  where coalesce(is_npc, false) = true
  order by created_at, id
  limit 1;

  assert v_caller is not null and v_target is not null and v_third_player is not null and v_npc_owner is not null,
    'need three human non-coalition players and one NPC for non-aggression verification';

  delete from diplomacy_offers
  where (initiator_id in (v_caller, v_target, v_third_player) and target_id in (v_caller, v_target, v_third_player))
     or (initiator_id = v_caller and target_id = v_npc_owner)
     or (initiator_id = v_npc_owner and target_id = v_caller);

  delete from diplomacy_relations
  where (player_a_id in (least(v_caller, v_target), least(v_caller, v_third_player), least(v_target, v_third_player))
     and player_b_id in (greatest(v_caller, v_target), greatest(v_caller, v_third_player), greatest(v_target, v_third_player)));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_non_aggression(v_caller);
  exception
    when others then
      v_failed := position('target player is invalid' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'self-target non-aggression proposal should fail';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_non_aggression(v_npc_owner);
  exception
    when others then
      v_failed := position('NPC kingdom' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'NPC-target non-aggression proposal should fail';

  insert into diplomacy_relations (player_a_id, player_b_id, state)
  values (least(v_caller, v_target), greatest(v_caller, v_target), 'war');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_non_aggression(v_target);
  exception
    when others then
      v_failed := position('resolve the war' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'war should block non-aggression proposal';

  delete from diplomacy_relations
  where player_a_id = least(v_caller, v_target)
    and player_b_id = greatest(v_caller, v_target);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  select diplomacy_propose_non_aggression(v_target) into v_offer_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_target::text, true);
  select diplomacy_get_relation(v_caller) into v_relation_state;
  execute 'reset role';
  assert v_relation_state = 'peace', 'pending pact should not change relation before acceptance';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_target::text, true);
  perform diplomacy_accept_non_aggression(v_offer_id);
  select diplomacy_get_relation(v_caller) into v_relation_state;
  select count(*) into v_pact_count
  from diplomacy_list_non_aggression_pacts()
  where other_player_id = v_caller;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  select diplomacy_get_relation(v_target) into v_relation_state;
  execute 'reset role';

  assert v_relation_state = 'non_aggression', 'accepted pact should report non_aggression relation';
  assert v_pact_count = 1, 'accepted pact should appear in diplomacy_list_non_aggression_pacts';

  select count(*) into v_event_count
  from world_events
  where event_type = 'non_aggression_signed'
    and payload->>'player_a_id' = v_caller::text
    and payload->>'player_b_id' = v_target::text;
  assert v_event_count = 1, 'accepting pact should log non_aggression_signed once';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_non_aggression(v_target);
  exception
    when others then
      v_failed := position('already have a non-aggression pact' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'existing pact should block a second proposal';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  perform diplomacy_declare_war(v_target);
  select diplomacy_get_relation(v_target) into v_relation_state;
  execute 'reset role';
  assert v_relation_state = 'war', 'declaring war should replace pact with war';

  select count(*) into v_pact_count
  from diplomacy_relations
  where player_a_id = least(v_caller, v_target)
    and player_b_id = greatest(v_caller, v_target)
    and state = 'non_aggression';
  assert v_pact_count = 0, 'declaring war should delete the old pact row';

  select count(*) into v_event_count
  from world_events
  where event_type = 'non_aggression_broken'
    and payload->>'player_a_id' = v_caller::text
    and payload->>'player_b_id' = v_target::text;
  assert v_event_count = 1, 'declaring war from a pact should log non_aggression_broken once';

  select count(*) into v_event_count
  from world_events
  where event_type = 'war_declared'
    and payload->>'attacker_id' = v_caller::text
    and payload->>'defender_id' = v_target::text;
  assert v_event_count >= 1, 'declaring war from a pact should still log war_declared';

  delete from diplomacy_offers
  where id = v_offer_id;
  delete from diplomacy_relations
  where player_a_id = least(v_caller, v_target)
    and player_b_id = greatest(v_caller, v_target);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  select diplomacy_propose_non_aggression(v_target) into v_offer_reject_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_third_player::text, true);
  v_failed := false;
  begin
    perform diplomacy_reject_non_aggression(v_offer_reject_id);
  exception
    when others then
      v_failed := position('target player may reject' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'wrong caller should not reject a pact offer';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_target::text, true);
  perform diplomacy_reject_non_aggression(v_offer_reject_id);
  execute 'reset role';

  select count(*) into v_event_count
  from diplomacy_offers
  where id = v_offer_reject_id
    and status = 'rejected';
  assert v_event_count = 1, 'rejecting pact should flip offer status to rejected';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  select diplomacy_propose_non_aggression(v_target) into v_offer_cancel_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_third_player::text, true);
  v_failed := false;
  begin
    perform diplomacy_cancel_non_aggression(v_offer_cancel_id);
  exception
    when others then
      v_failed := position('initiator may cancel' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'wrong caller should not cancel a pact offer';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  perform diplomacy_cancel_non_aggression(v_offer_cancel_id);
  execute 'reset role';

  select count(*) into v_event_count
  from diplomacy_offers
  where id = v_offer_cancel_id
    and status = 'cancelled';
  assert v_event_count = 1, 'cancelling pact should flip offer status to cancelled';

  insert into coalitions (id, name, leader_id)
  values (v_coalition_id, 'verification-coalition-0063', v_caller);

  insert into coalition_members (coalition_id, player_id)
  values (v_coalition_id, v_caller), (v_coalition_id, v_target);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_non_aggression(v_target);
  exception
    when others then
      v_failed := position('share a coalition' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'same-coalition pair should not be able to propose a pact';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  v_failed := false;
  begin
    perform diplomacy_declare_war(v_target);
  exception
    when others then
      v_failed := position('coalition member' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'same-coalition pair should not be able to declare war';
end;
$$;

rollback;
