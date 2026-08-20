-- 0046_diplomacy_rpcs.verification.sql
--
-- Safe verification for diplomacy RPCs.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_attacker uuid;
  v_defender uuid;
  v_third_player uuid;
  v_home_attacker integer;
  v_home_defender integer;
  v_home_defender_before_count integer;
  v_relation_state text;
  v_list_wars_count integer;
  v_offer_id uuid;
  v_counter_offer_id uuid;
  v_overflow_offer_id uuid;
  v_overflow_card uuid;
  v_battle_movement_id uuid;
  v_valid_card uuid;
  v_valid_boost uuid;
  v_not_owned_card uuid;
  v_locked_card uuid;
  v_occupied_card uuid;
  v_filler_card uuid;
  v_offer_territory integer;
  v_occupied_territory integer;
  v_claim_locked_territory integer;
  v_incoming_territory integer;
  v_other_owner_territory integer;
  v_locked_card_territory integer;
  v_battle_territory integer;
  v_free_territories integer[];
  v_unit_template_id text;
  v_boost_template_id text;
  v_failed boolean;
  v_count integer;
  v_deck_limit integer;
begin
  assert to_regprocedure('diplomacy_get_relation(uuid)') is not null, 'missing diplomacy_get_relation(uuid)';
  assert to_regprocedure('diplomacy_list_wars()') is not null, 'missing diplomacy_list_wars()';
  assert to_regprocedure('diplomacy_list_offers()') is not null, 'missing diplomacy_list_offers()';
  assert to_regprocedure('diplomacy_propose_peace(uuid,text,uuid[],integer)') is not null,
    'missing diplomacy_propose_peace(uuid,text,uuid[],integer)';
  assert to_regprocedure('diplomacy_accept_peace(uuid)') is not null, 'missing diplomacy_accept_peace(uuid)';
  assert to_regprocedure('diplomacy_reject_peace(uuid)') is not null, 'missing diplomacy_reject_peace(uuid)';
  assert to_regprocedure('diplomacy_cancel_peace(uuid)') is not null, 'missing diplomacy_cancel_peace(uuid)';

  select p.id
  into v_attacker
  from players p
  where coalesce(p.is_npc, false) = false
    and exists (
      select 1
      from territories t
      where t.owner_id = p.id
        and t.is_home = true
    )
  order by p.created_at, p.id
  limit 1;

  select p.id
  into v_defender
  from players p
  where coalesce(p.is_npc, false) = false
    and p.id <> v_attacker
    and exists (
      select 1
      from territories t
      where t.owner_id = p.id
        and t.is_home = true
    )
    and (
      select count(*)
      from card_instances ci
      where ci.owner_id = p.id
        and ci.status in ('stationed', 'in_transit')
    ) < _deck_limit(_level_for_xp(p.xp))
  order by p.created_at, p.id
  limit 1;

  select id
  into v_third_player
  from players
  where id not in (v_attacker, v_defender)
  order by created_at, id
  limit 1;

  assert v_attacker is not null and v_defender is not null and v_third_player is not null,
    'need two human players with home territories and one additional player for diplomacy RPC verification';

  select id
  into v_home_attacker
  from territories
  where owner_id = v_attacker
    and is_home = true
  limit 1;

  select id
  into v_home_defender
  from territories
  where owner_id = v_defender
    and is_home = true
  limit 1;

  select array_agg(id order by id)
  into v_free_territories
  from (
    select id
    from territories
    where owner_id is null
      and claim_locked_by is null
      and battle_locked_by is null
      and not is_home
    order by id
    limit 6
  ) free_territories;

  assert coalesce(array_length(v_free_territories, 1), 0) = 6,
    'need six unlocked empty territories for diplomacy RPC verification';

  v_offer_territory := v_free_territories[1];
  v_occupied_territory := v_free_territories[2];
  v_claim_locked_territory := v_free_territories[3];
  v_incoming_territory := v_free_territories[4];
  v_other_owner_territory := v_free_territories[5];
  v_locked_card_territory := v_free_territories[6];
  v_battle_territory := v_offer_territory;

  update territories
  set owner_id = v_attacker,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id in (v_offer_territory, v_occupied_territory, v_incoming_territory, v_locked_card_territory);

  update territories
  set owner_id = v_attacker,
      claim_locked_by = v_third_player,
      claim_started_at = now(),
      claim_transfer_arrives_at = now(),
      claim_occupation_completes_at = now() + interval '1 hour',
      battle_locked_by = null,
      is_home = false
  where id = v_claim_locked_territory;

  update territories
  set owner_id = v_defender,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_other_owner_territory;

  update territories
  set battle_locked_by = v_defender
  where id = v_locked_card_territory;

  insert into troop_movements (
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    transfer_arrives_at,
    status
  )
  values (
    v_defender,
    'transfer',
    v_home_defender,
    v_incoming_territory,
    now() + interval '1 hour',
    'in_transit'
  );

  select id into v_unit_template_id
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  select id into v_boost_template_id
  from card_templates
  where category = 'boost'
  order by id
  limit 1;

  assert v_unit_template_id is not null and v_boost_template_id is not null,
    'need one unit template and one boost template for diplomacy RPC verification';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_unit_template_id, v_attacker, v_home_attacker, 'stationed')
  returning instance_id into v_valid_card;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_boost_template_id, v_attacker, null, 'stationed')
  returning instance_id into v_valid_boost;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_unit_template_id, v_third_player, null, 'stationed')
  returning instance_id into v_not_owned_card;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_unit_template_id, v_attacker, v_locked_card_territory, 'stationed')
  returning instance_id into v_locked_card;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_unit_template_id, v_attacker, v_occupied_territory, 'stationed')
  returning instance_id into v_occupied_card;

  delete from diplomacy_offers
  where (initiator_id = v_attacker and target_id = v_defender)
     or (initiator_id = v_defender and target_id = v_attacker);

  delete from diplomacy_relations
  where player_a_id = least(v_attacker, v_defender)
    and player_b_id = greatest(v_attacker, v_defender);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_peace(v_defender, 'white_peace', '{}'::uuid[], null);
  exception
    when others then
      v_failed := position('not currently at war' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'proposing peace without an active war should fail';

  insert into diplomacy_relations (player_a_id, player_b_id)
  values (least(v_attacker, v_defender), greatest(v_attacker, v_defender));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  select diplomacy_get_relation(v_defender) into v_relation_state;
  select count(*) into v_list_wars_count
  from diplomacy_list_wars()
  where other_player_id = v_defender;
  execute 'reset role';

  assert v_relation_state = 'war', 'diplomacy_get_relation should report war for active wars';
  assert v_list_wars_count = 1, 'diplomacy_list_wars should include the active war';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_peace(v_defender, 'tribute_peace', array[v_not_owned_card]::uuid[], null);
  exception
    when others then
      v_failed := position('not owned by the caller' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'tribute proposal should reject a card the caller does not own';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_peace(v_defender, 'tribute_peace', array[v_locked_card]::uuid[], null);
  exception
    when others then
      v_failed := position('unresolved battle' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'tribute proposal should reject a card stationed on a battle-locked territory';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_peace(v_defender, 'tribute_peace', '{}'::uuid[], v_home_attacker);
  exception
    when others then
      v_failed := position('home territory' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'tribute proposal should reject the home territory';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_peace(v_defender, 'tribute_peace', '{}'::uuid[], v_occupied_territory);
  exception
    when others then
      v_failed := position('no stationed cards' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'tribute proposal should reject an occupied territory';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_peace(v_defender, 'tribute_peace', '{}'::uuid[], v_claim_locked_territory);
  exception
    when others then
      v_failed := position('active claim' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'tribute proposal should reject a territory under claim lock';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_peace(v_defender, 'tribute_peace', '{}'::uuid[], v_incoming_territory);
  exception
    when others then
      v_failed := position('incoming movement' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'tribute proposal should reject a territory with an incoming movement';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  v_failed := false;
  begin
    perform diplomacy_propose_peace(v_defender, 'tribute_peace', '{}'::uuid[], v_other_owner_territory);
  exception
    when others then
      v_failed := position('not owned by the caller' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'tribute proposal should reject a territory the caller does not own';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  select diplomacy_propose_peace(v_defender, 'white_peace', '{}'::uuid[], null) into v_offer_id;
  v_failed := false;
  begin
    perform diplomacy_propose_peace(v_defender, 'white_peace', '{}'::uuid[], null);
  exception
    when others then
      v_failed := position('already have a pending peace offer' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'second pending offer to the same target should be rejected';

  update diplomacy_offers
  set expires_at = now() - interval '1 hour'
  where id = v_offer_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  select count(*)
  into v_count
  from diplomacy_list_offers()
  where id = v_offer_id;
  execute 'reset role';

  select count(*)
  into v_count
  from diplomacy_offers
  where id = v_offer_id
    and status = 'expired';
  assert v_count = 1, 'diplomacy_list_offers should lazily expire stale pending offers';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  select diplomacy_propose_peace(
    v_defender,
    'tribute_peace',
    array[v_valid_card, v_valid_boost]::uuid[],
    v_offer_territory
  ) into v_offer_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_defender::text, true);
  select diplomacy_propose_peace(v_attacker, 'white_peace', '{}'::uuid[], null) into v_counter_offer_id;
  execute 'reset role';

  select count(*)
  into v_home_defender_before_count
  from card_instances
  where owner_id = v_defender
    and stationed_territory_id = v_home_defender
    and status = 'stationed';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_defender::text, true);
  perform diplomacy_accept_peace(v_offer_id);
  execute 'reset role';

  select count(*)
  into v_count
  from card_instances
  where owner_id = v_defender
    and stationed_territory_id = v_home_defender
    and status = 'stationed'
    and instance_id in (v_valid_card, v_valid_boost);
  assert v_count = 2, 'accepted tribute cards should be stationed at the target home territory when there is room';

  select count(*)
  into v_count
  from territories
  where id = v_offer_territory
    and owner_id = v_defender;
  assert v_count = 1, 'accepted tribute territory should transfer ownership to the target';

  select count(*)
  into v_count
  from diplomacy_relations
  where player_a_id = least(v_attacker, v_defender)
    and player_b_id = greatest(v_attacker, v_defender);
  assert v_count = 0, 'accepting peace should delete the active war row';

  select count(*)
  into v_count
  from diplomacy_offers
  where id = v_counter_offer_id
    and status = 'cancelled';
  assert v_count = 1, 'accepting one peace offer should cancel other pending offers between the pair';

  select count(*)
  into v_count
  from world_events
  where event_type = 'peace_signed'
    and payload->>'player_a_id' = v_attacker::text
    and payload->>'player_b_id' = v_defender::text
    and payload->>'had_tribute' = 'true';
  assert v_count = 1, 'accepting tribute peace should log a peace_signed world event with had_tribute=true';

  insert into diplomacy_relations (player_a_id, player_b_id)
  values (least(v_attacker, v_defender), greatest(v_attacker, v_defender));

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_unit_template_id, v_attacker, v_home_attacker, 'stationed')
  returning instance_id into v_overflow_card;

  select _deck_limit(_level_for_xp(xp))
  into v_deck_limit
  from players
  where id = v_defender;

  while (
    select count(*)
    from card_instances
    where owner_id = v_defender
      and status in ('stationed', 'in_transit')
  ) < v_deck_limit
  loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_unit_template_id, v_defender, v_home_defender, 'stationed')
    returning instance_id into v_filler_card;
  end loop;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  select diplomacy_propose_peace(
    v_defender,
    'tribute_peace',
    array[v_overflow_card]::uuid[],
    null
  ) into v_overflow_offer_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_defender::text, true);
  perform diplomacy_accept_peace(v_overflow_offer_id);
  execute 'reset role';

  select count(*)
  into v_count
  from card_instances
  where instance_id = v_overflow_card
    and owner_id = v_defender
    and status = 'deposit'
    and stationed_territory_id is null
    and deposit_expires_at is not null;
  assert v_count = 1, 'accepted tribute cards should route to deposit when the target deck is already full';

  insert into diplomacy_relations (player_a_id, player_b_id)
  values (least(v_attacker, v_defender), greatest(v_attacker, v_defender));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);
  select diplomacy_propose_peace(v_defender, 'white_peace', '{}'::uuid[], null) into v_offer_id;
  execute 'reset role';

  insert into troop_movements (
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    transfer_arrives_at,
    status
  )
  values (
    v_attacker,
    'attack',
    v_home_attacker,
    v_battle_territory,
    now() + interval '1 hour',
    'in_transit'
  )
  returning id into v_battle_movement_id;

  insert into battles (
    territory_id,
    attacker_id,
    defender_id,
    is_home_target,
    movement_id,
    status,
    ready_deadline
  )
  values (
    v_battle_territory,
    v_attacker,
    v_defender,
    false,
    v_battle_movement_id,
    'awaiting_ready',
    now() + interval '1 hour'
  );

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_defender::text, true);
  v_failed := false;
  begin
    perform diplomacy_accept_peace(v_offer_id);
  exception
    when others then
      v_failed := position('still unresolved' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'accepting peace should be rejected while an unresolved battle exists between the pair';

  delete from battles
  where territory_id = v_battle_territory
    and attacker_id = v_attacker
    and defender_id = v_defender
    and status = 'awaiting_ready';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_third_player::text, true);
  v_failed := false;
  begin
    perform diplomacy_accept_peace(v_offer_id);
  exception
    when others then
      v_failed := position('target player may accept' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'a third player must not be able to accept someone else''s peace offer';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_third_player::text, true);
  v_failed := false;
  begin
    perform diplomacy_reject_peace(v_offer_id);
  exception
    when others then
      v_failed := position('target player may reject' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'a third player must not be able to reject someone else''s peace offer';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_third_player::text, true);
  v_failed := false;
  begin
    perform diplomacy_cancel_peace(v_offer_id);
  exception
    when others then
      v_failed := position('initiator may cancel' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'a third player must not be able to cancel someone else''s peace offer';
end;
$$;

rollback;
