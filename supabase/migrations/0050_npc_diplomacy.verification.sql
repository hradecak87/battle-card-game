-- 0050_npc_diplomacy.verification.sql
--
-- Safe verification for NPC diplomacy + war-focus behavior.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_human_a uuid;
  v_human_b uuid;
  v_npc uuid;
  v_home_human_a integer;
  v_home_human_b integer;
  v_home_npc integer;
  v_test_territories integer[];
  v_offer_territory integer;
  v_power_territory_human integer;
  v_power_territory_npc integer;
  v_ratio_territory_human integer;
  v_ratio_territory_npc integer;
  v_unit_template_id text;
  v_alt_unit_template_id text;
  v_power_card_1 uuid;
  v_power_card_2 uuid;
  v_power_card_excluded uuid;
  v_regression_card uuid;
  v_offer_id uuid;
  v_ratio_offer_id uuid;
  v_expected_power numeric;
  v_actual_power numeric;
  v_pending_count integer;
  v_card_count integer;
  v_relation_count integer;
  v_offer_status text;
begin
  assert to_regprocedure('_npc_diplomacy_power(uuid)') is not null, 'missing _npc_diplomacy_power(uuid)';
  assert to_regprocedure('_diplomacy_propose_peace_core(uuid,uuid,text,uuid[],integer)') is not null,
    'missing _diplomacy_propose_peace_core(uuid,uuid,text,uuid[],integer)';
  assert to_regprocedure('_diplomacy_accept_peace_core(uuid,uuid)') is not null,
    'missing _diplomacy_accept_peace_core(uuid,uuid)';
  assert to_regprocedure('_diplomacy_reject_peace_core(uuid,uuid)') is not null,
    'missing _diplomacy_reject_peace_core(uuid,uuid)';
  assert to_regprocedure('resolve_due_npc_diplomacy()') is not null, 'missing resolve_due_npc_diplomacy()';

  select p.id
  into v_human_a
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
  into v_human_b
  from players p
  where coalesce(p.is_npc, false) = false
    and p.id <> v_human_a
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

  select p.id
  into v_npc
  from players p
  where coalesce(p.is_npc, false) = true
    and exists (
      select 1
      from territories t
      where t.owner_id = p.id
        and t.is_home = true
    )
  order by p.created_at, p.id
  limit 1;

  assert v_human_a is not null and v_human_b is not null and v_npc is not null,
    'need two human players and one NPC player with home territories for 0050 verification';

  select id
  into v_home_human_a
  from territories
  where owner_id = v_human_a
    and is_home = true
  limit 1;

  select id
  into v_home_human_b
  from territories
  where owner_id = v_human_b
    and is_home = true
  limit 1;

  select id
  into v_home_npc
  from territories
  where owner_id = v_npc
    and is_home = true
  limit 1;

  select array_agg(id order by id)
  into v_test_territories
  from (
    select id
    from territories
    where owner_id is null
      and claim_locked_by is null
      and battle_locked_by is null
      and not is_home
      and not exists (
        select 1
        from card_instances ci
        where ci.stationed_territory_id = territories.id
      )
    order by id
    limit 5
  ) free_territories;

  assert coalesce(array_length(v_test_territories, 1), 0) = 5,
    'need five free territories for 0050 verification';

  v_offer_territory := v_test_territories[1];
  v_power_territory_human := v_test_territories[2];
  v_power_territory_npc := v_test_territories[3];
  v_ratio_territory_human := v_test_territories[4];
  v_ratio_territory_npc := v_test_territories[5];

  update territories
  set owner_id = null,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = any(v_test_territories);

  update territories
  set owner_id = v_human_a
  where id in (v_offer_territory, v_power_territory_human, v_ratio_territory_human);

  update territories
  set owner_id = v_npc
  where id in (v_power_territory_npc, v_ratio_territory_npc);

  update card_instances
  set stationed_territory_id = null
  where owner_id in (v_human_a, v_human_b, v_npc)
    and status = 'stationed';

  delete from diplomacy_offers
  where (initiator_id = v_human_a and target_id in (v_human_b, v_npc))
     or (initiator_id = v_human_b and target_id = v_human_a)
     or (initiator_id = v_npc and target_id = v_human_a)
     or (initiator_id = v_human_a and target_id = v_npc);

  delete from diplomacy_relations
  where (player_a_id = least(v_human_a, v_human_b) and player_b_id = greatest(v_human_a, v_human_b))
     or (player_a_id = least(v_human_a, v_npc) and player_b_id = greatest(v_human_a, v_npc));

  delete from world_events
  where event_type in ('battle_won', 'battle_surrendered')
    and (
      (payload->>'winner_id' = v_human_a::text and payload->>'loser_id' = v_npc::text)
      or (payload->>'winner_id' = v_npc::text and payload->>'loser_id' = v_human_a::text)
    );

  select id
  into v_unit_template_id
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  select id
  into v_alt_unit_template_id
  from card_templates
  where category = 'unit'
    and id <> v_unit_template_id
  order by id
  limit 1;

  assert v_unit_template_id is not null and v_alt_unit_template_id is not null,
    'need two unit templates for 0050 verification';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values
    (v_unit_template_id, v_human_a, v_power_territory_human, 'stationed')
  returning instance_id into v_power_card_1;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values
    (v_alt_unit_template_id, v_human_a, v_power_territory_human, 'stationed')
  returning instance_id into v_power_card_2;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values
    (v_unit_template_id, v_human_a, null, 'stationed')
  returning instance_id into v_power_card_excluded;

  select coalesce(sum(e.hp + e.str + e.lng + e.def), 0)
  into v_expected_power
  from card_instances ci
  join card_templates ct
    on ct.id = ci.template_id
  cross join lateral _compute_effective_stats(
    ct.base_stats,
    ct.rank,
    null,
    false,
    null,
    null,
    null
  ) e
  where ci.instance_id in (v_power_card_1, v_power_card_2);

  select _npc_diplomacy_power(v_human_a) into v_actual_power;
  assert v_actual_power = v_expected_power,
    '_npc_diplomacy_power should sum stationed unit power exactly';

  select _npc_diplomacy_power(v_human_b) into v_actual_power;
  assert v_actual_power = 0, '_npc_diplomacy_power should return 0 with no stationed units';

  select _npc_diplomacy_power(v_human_a) into v_actual_power;
  assert v_actual_power = v_expected_power,
    '_npc_diplomacy_power should exclude stationed cards whose territory is null';

  delete from card_instances
  where instance_id in (v_power_card_1, v_power_card_2, v_power_card_excluded);

  insert into diplomacy_relations (player_a_id, player_b_id)
  values (least(v_human_a, v_human_b), greatest(v_human_a, v_human_b));

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_unit_template_id, v_human_a, v_home_human_a, 'stationed')
  returning instance_id into v_regression_card;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_human_a::text, true);
  select diplomacy_propose_peace(
    v_human_b,
    'tribute_peace',
    array[v_regression_card]::uuid[],
    v_offer_territory
  ) into v_offer_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_human_b::text, true);
  perform diplomacy_accept_peace(v_offer_id);
  execute 'reset role';

  select count(*)
  into v_card_count
  from card_instances
  where instance_id = v_regression_card
    and owner_id = v_human_b
    and stationed_territory_id = v_home_human_b
    and status = 'stationed';
  assert v_card_count = 1, 'human accept flow should still transfer tribute cards to the target home territory';

  select count(*)
  into v_card_count
  from territories
  where id = v_offer_territory
    and owner_id = v_human_b;
  assert v_card_count = 1, 'human accept flow should still transfer tribute territory ownership';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where player_a_id = least(v_human_a, v_human_b)
    and player_b_id = greatest(v_human_a, v_human_b);
  assert v_relation_count = 0, 'human accept flow should still remove the war relation';

  select status
  into v_offer_status
  from diplomacy_offers
  where id = v_offer_id;
  assert v_offer_status = 'accepted', 'accepted human tribute offer should still be marked accepted';

  insert into diplomacy_relations (player_a_id, player_b_id)
  values (least(v_human_a, v_human_b), greatest(v_human_a, v_human_b));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_human_a::text, true);
  select diplomacy_propose_peace(v_human_b, 'white_peace', '{}'::uuid[], null)
  into v_offer_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_human_b::text, true);
  perform diplomacy_reject_peace(v_offer_id);
  execute 'reset role';

  select status
  into v_offer_status
  from diplomacy_offers
  where id = v_offer_id;
  assert v_offer_status = 'rejected', 'human reject flow should still mark the offer rejected';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where player_a_id = least(v_human_a, v_human_b)
    and player_b_id = greatest(v_human_a, v_human_b);
  assert v_relation_count = 1, 'rejecting peace should leave the war relation intact';

  delete from diplomacy_offers
  where (initiator_id = v_human_a and target_id = v_npc)
     or (initiator_id = v_npc and target_id = v_human_a);

  delete from diplomacy_relations
  where player_a_id = least(v_human_a, v_npc)
    and player_b_id = greatest(v_human_a, v_npc);

  delete from card_instances
  where owner_id in (v_human_a, v_npc)
    and stationed_territory_id in (v_ratio_territory_human, v_ratio_territory_npc);

  insert into diplomacy_relations (player_a_id, player_b_id)
  values (least(v_human_a, v_npc), greatest(v_human_a, v_npc));

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_human_a, v_ratio_territory_human, 'stationed'
  from generate_series(1, 20);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_npc, v_ratio_territory_npc, 'stationed'
  from generate_series(1, 13);

  update npc_diplomacy_state
  set last_run_at = null
  where id = true;

  perform resolve_due_npc_diplomacy();

  select count(*)
  into v_pending_count
  from diplomacy_offers
  where initiator_id = v_npc
    and target_id = v_human_a
    and status = 'pending';
  assert v_pending_count = 0, 'ratio 0.65 should not create an outgoing NPC peace offer';

  delete from diplomacy_offers
  where (initiator_id = v_human_a and target_id = v_npc)
     or (initiator_id = v_npc and target_id = v_human_a);

  delete from card_instances
  where owner_id in (v_human_a, v_npc)
    and stationed_territory_id in (v_ratio_territory_human, v_ratio_territory_npc);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_human_a, v_ratio_territory_human, 'stationed'
  from generate_series(1, 20);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_npc, v_ratio_territory_npc, 'stationed'
  from generate_series(1, 11);

  update npc_diplomacy_state
  set last_run_at = null
  where id = true;

  perform resolve_due_npc_diplomacy();

  select id, status
  into v_ratio_offer_id, v_offer_status
  from diplomacy_offers
  where initiator_id = v_npc
    and target_id = v_human_a
    and status = 'pending'
  order by created_at desc, id desc
  limit 1;

  assert v_ratio_offer_id is not null and v_offer_status = 'pending',
    'ratio 0.55 should create one pending outgoing NPC offer';

  select kind, coalesce(array_length(offered_card_ids, 1), 0)
  into v_offer_status, v_card_count
  from diplomacy_offers
  where id = v_ratio_offer_id;
  assert v_offer_status = 'white_peace' and v_card_count = 0,
    'ratio 0.55 should create a white-peace NPC offer';

  perform resolve_due_npc_diplomacy();

  select count(*)
  into v_pending_count
  from diplomacy_offers
  where initiator_id = v_npc
    and target_id = v_human_a
    and status = 'pending';
  assert v_pending_count = 1, 'second diplomacy tick within an hour should not duplicate a pending NPC offer';

  delete from diplomacy_offers
  where (initiator_id = v_human_a and target_id = v_npc)
     or (initiator_id = v_npc and target_id = v_human_a);

  delete from card_instances
  where owner_id in (v_human_a, v_npc)
    and stationed_territory_id in (v_ratio_territory_human, v_ratio_territory_npc);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_human_a, v_ratio_territory_human, 'stationed'
  from generate_series(1, 20);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_npc, v_ratio_territory_npc, 'stationed'
  from generate_series(1, 7);

  update npc_diplomacy_state
  set last_run_at = null
  where id = true;

  perform resolve_due_npc_diplomacy();

  select kind, coalesce(array_length(offered_card_ids, 1), 0)
  into v_offer_status, v_card_count
  from diplomacy_offers
  where initiator_id = v_npc
    and target_id = v_human_a
    and status = 'pending'
  order by created_at desc, id desc
  limit 1;
  assert v_offer_status = 'tribute_peace' and v_card_count = 1,
    'ratio 0.35 should create a tribute offer with one card';

  delete from diplomacy_offers
  where (initiator_id = v_human_a and target_id = v_npc)
     or (initiator_id = v_npc and target_id = v_human_a);

  delete from card_instances
  where owner_id in (v_human_a, v_npc)
    and stationed_territory_id in (v_ratio_territory_human, v_ratio_territory_npc);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_human_a, v_ratio_territory_human, 'stationed'
  from generate_series(1, 20);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_npc, v_ratio_territory_npc, 'stationed'
  from generate_series(1, 3);

  update npc_diplomacy_state
  set last_run_at = null
  where id = true;

  perform resolve_due_npc_diplomacy();

  select kind, coalesce(array_length(offered_card_ids, 1), 0)
  into v_offer_status, v_card_count
  from diplomacy_offers
  where initiator_id = v_npc
    and target_id = v_human_a
    and status = 'pending'
  order by created_at desc, id desc
  limit 1;
  assert v_offer_status = 'tribute_peace' and v_card_count = 3,
    'ratio 0.15 should create a tribute offer with three cards';

  delete from diplomacy_offers
  where (initiator_id = v_human_a and target_id = v_npc)
     or (initiator_id = v_npc and target_id = v_human_a);

  delete from card_instances
  where owner_id in (v_human_a, v_npc)
    and stationed_territory_id in (v_ratio_territory_human, v_ratio_territory_npc);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_human_a, v_ratio_territory_human, 'stationed'
  from generate_series(1, 5);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_npc, v_ratio_territory_npc, 'stationed'
  from generate_series(1, 20);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_unit_template_id, v_human_a, v_ratio_territory_human, 'stationed')
  returning instance_id into v_regression_card;

  update npc_diplomacy_state
  set last_run_at = null
  where id = true;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_human_a::text, true);
  select diplomacy_propose_peace(
    v_npc,
    'tribute_peace',
    array[v_regression_card]::uuid[],
    null
  ) into v_offer_id;
  execute 'reset role';

  perform resolve_due_npc_diplomacy();

  select status
  into v_offer_status
  from diplomacy_offers
  where id = v_offer_id;
  assert v_offer_status = 'accepted', 'NPC target should accept tribute peace regardless of ratio';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where player_a_id = least(v_human_a, v_npc)
    and player_b_id = greatest(v_human_a, v_npc);
  assert v_relation_count = 0, 'accepting NPC tribute peace should resolve the war';

  insert into diplomacy_relations (player_a_id, player_b_id)
  values (least(v_human_a, v_npc), greatest(v_human_a, v_npc));

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_human_a::text, true);
  select diplomacy_propose_peace(v_npc, 'white_peace', '{}'::uuid[], null)
  into v_offer_id;
  execute 'reset role';

  update npc_diplomacy_state
  set last_run_at = null
  where id = true;

  perform resolve_due_npc_diplomacy();

  select status
  into v_offer_status
  from diplomacy_offers
  where id = v_offer_id;
  assert v_offer_status = 'rejected', 'NPC target should reject white peace when its power ratio is at least 1.2';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where player_a_id = least(v_human_a, v_npc)
    and player_b_id = greatest(v_human_a, v_npc);
  assert v_relation_count = 1, 'rejecting white peace should leave the NPC war active';

  delete from diplomacy_offers
  where (initiator_id = v_human_a and target_id = v_human_b)
     or (initiator_id = v_human_b and target_id = v_human_a)
     or (initiator_id = v_human_a and target_id = v_npc)
     or (initiator_id = v_npc and target_id = v_human_a);

  delete from diplomacy_relations
  where player_a_id = least(v_human_a, v_npc)
    and player_b_id = greatest(v_human_a, v_npc);

  update npc_diplomacy_state
  set last_run_at = null
  where id = true;

  perform resolve_due_npc_diplomacy();

  select count(*)
  into v_pending_count
  from diplomacy_offers
  where (initiator_id = v_human_a and target_id = v_human_b)
     or (initiator_id = v_human_b and target_id = v_human_a);
  assert v_pending_count = 0, 'human-vs-human wars should be ignored by the NPC diplomacy tick';
end;
$$;

do $$
declare
  v_npc uuid;
  v_human uuid;
  v_home_npc integer;
  v_origin_territory integer;
  v_adjacent_expansion integer;
  v_focus_target integer;
  v_origin_card_ids uuid[];
  v_origin_card_ids_small uuid[];
  v_origin_card_ids_rest uuid[];
  v_focus_card_ids uuid[];
  v_unit_template_id text;
  v_focus_attack_count integer := 0;
  v_expansion_count integer := 0;
  v_iteration integer;
  v_recent_movement_id uuid;
  v_recent_destination integer;
  v_recent_destination_owner uuid;
  v_rescheduled_at timestamptz;
begin
  assert to_regprocedure('resolve_due_npc_actions()') is not null, 'missing resolve_due_npc_actions()';

  select p.id
  into v_npc
  from players p
  where coalesce(p.is_npc, false) = true
    and exists (
      select 1
      from territories t
      where t.owner_id = p.id
        and t.is_home = true
    )
  order by p.created_at, p.id
  limit 1;

  select p.id
  into v_human
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

  assert v_npc is not null and v_human is not null,
    'need one NPC and one human player with home territories for war-focus verification';

  select id
  into v_home_npc
  from territories
  where owner_id = v_npc
    and is_home = true
  limit 1;

  select base.id, adj.id
  into v_origin_territory, v_adjacent_expansion
  from territories base
  join territories adj
    on (
      (adj.x = base.x - 1 and adj.y = base.y)
      or (adj.x = base.x + 1 and adj.y = base.y)
      or (adj.x = base.x and adj.y = base.y - 1)
      or (adj.x = base.x and adj.y = base.y + 1)
    )
  where base.owner_id is null
    and base.claim_locked_by is null
    and base.battle_locked_by is null
    and not base.is_home
    and not exists (
      select 1
      from card_instances ci
      where ci.stationed_territory_id = base.id
    )
    and adj.owner_id is null
    and adj.claim_locked_by is null
    and adj.battle_locked_by is null
    and not adj.is_home
    and not exists (
      select 1
      from card_instances ci
      where ci.stationed_territory_id = adj.id
    )
  order by base.id, adj.id
  limit 1;

  select id
  into v_focus_target
  from territories
  where owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not is_home
    and not exists (
      select 1
      from card_instances ci
      where ci.stationed_territory_id = territories.id
    )
    and id not in (v_origin_territory, v_adjacent_expansion)
  order by id
  limit 1;

  assert v_origin_territory is not null and v_adjacent_expansion is not null and v_focus_target is not null,
    'need one free adjacent pair and one additional free territory for war-focus verification';

  select id
  into v_unit_template_id
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  assert v_unit_template_id is not null, 'need one unit template for war-focus verification';

  update players
  set npc_next_action_at = now() + interval '1 day'
  where is_npc = true
    and id <> v_npc;

  update card_instances
  set stationed_territory_id = null
  where owner_id in (v_npc, v_human)
    and status = 'stationed';

  delete from diplomacy_offers
  where initiator_id = v_npc
     or target_id = v_npc;

  delete from diplomacy_relations
  where v_npc in (player_a_id, player_b_id);

  insert into diplomacy_relations (player_a_id, player_b_id)
  values (least(v_npc, v_human), greatest(v_npc, v_human));

  update territories
  set owner_id = v_npc,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_origin_territory;

  update territories
  set owner_id = null,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_adjacent_expansion;

  update territories
  set owner_id = v_human,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_focus_target;

  with inserted as (
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    select v_unit_template_id, v_npc, v_origin_territory, 'stationed'
    from generate_series(1, 20)
    returning instance_id
  )
  select array_agg(instance_id order by instance_id)
  into v_origin_card_ids
  from inserted;

  with inserted as (
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    select v_unit_template_id, v_human, v_focus_target, 'stationed'
    from generate_series(1, 2)
    returning instance_id
  )
  select array_agg(instance_id order by instance_id)
  into v_focus_card_ids
  from inserted;

  v_origin_card_ids_small := v_origin_card_ids[1:5];
  v_origin_card_ids_rest := v_origin_card_ids[6:20];

  for v_iteration in 1..40 loop
    delete from troop_movement_units
    where movement_id in (
      select id
      from troop_movements tm
      where player_id = v_npc
        and origin_territory_id = v_origin_territory
        and destination_territory_id in (v_adjacent_expansion, v_focus_target)
    );

    delete from troop_movements
    where player_id = v_npc
      and origin_territory_id = v_origin_territory
      and destination_territory_id in (v_adjacent_expansion, v_focus_target);

    update territories
    set owner_id = v_npc,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null,
        battle_locked_by = null,
        is_home = false
    where id = v_origin_territory;

    update territories
    set owner_id = null,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null,
        battle_locked_by = null,
        is_home = false
    where id = v_adjacent_expansion;

    update territories
    set owner_id = v_human,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null,
        battle_locked_by = null,
        is_home = false
    where id = v_focus_target;

    update card_instances
    set owner_id = v_npc,
        stationed_territory_id = v_origin_territory,
        status = 'stationed',
        deposit_expires_at = null
    where instance_id = any(v_origin_card_ids);

    update card_instances
    set owner_id = v_human,
        stationed_territory_id = v_focus_target,
        status = 'stationed',
        deposit_expires_at = null
    where instance_id = any(v_focus_card_ids);

    update players
    set npc_next_action_at = now() - interval '1 minute'
    where id = v_npc;

    perform resolve_due_npc_actions();

    select tm.id, tm.destination_territory_id, t.owner_id
    into v_recent_movement_id, v_recent_destination, v_recent_destination_owner
    from troop_movements tm
    join territories t
      on t.id = tm.destination_territory_id
    where tm.player_id = v_npc
    order by tm.started_at desc, tm.id desc
    limit 1;

    assert v_recent_movement_id is not null,
      'war-focus loop should create one NPC movement each iteration';

    if v_recent_destination_owner = v_human then
      v_focus_attack_count := v_focus_attack_count + 1;
    elsif v_recent_destination_owner is null then
      v_expansion_count := v_expansion_count + 1;
    end if;
  end loop;

  assert v_focus_attack_count >= 28,
    'war-focus branch should attack the war opponent far more often than normal behavior';
  assert v_expansion_count >= 1,
    'war-focus verification should still observe occasional fallback to normal behavior';

  delete from troop_movement_units
  where movement_id in (
    select id
    from troop_movements tm
    where player_id = v_npc
      and origin_territory_id = v_origin_territory
      and destination_territory_id in (v_adjacent_expansion, v_focus_target)
  );

  delete from troop_movements
  where player_id = v_npc
    and origin_territory_id = v_origin_territory
    and destination_territory_id in (v_adjacent_expansion, v_focus_target);

  update territories
  set owner_id = v_npc,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_origin_territory;

  update territories
  set owner_id = null,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_adjacent_expansion;

  update territories
  set owner_id = v_human,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_focus_target;

  update card_instances
  set owner_id = v_npc,
      stationed_territory_id = v_origin_territory,
      status = 'stationed',
      deposit_expires_at = null
  where instance_id = any(v_origin_card_ids_small);

  update card_instances
  set owner_id = v_npc,
      stationed_territory_id = null,
      status = 'stationed',
      deposit_expires_at = null
  where instance_id = any(v_origin_card_ids_rest);

  update card_instances
  set owner_id = v_human,
      stationed_territory_id = v_focus_target,
      status = 'stationed',
      deposit_expires_at = null
  where instance_id = any(v_focus_card_ids);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  select v_unit_template_id, v_human, v_focus_target, 'stationed'
  from generate_series(1, 25);

  update players
  set npc_next_action_at = now() - interval '1 minute'
  where id = v_npc;

  perform resolve_due_npc_actions();

  select tm.destination_territory_id, t.owner_id
  into v_recent_destination, v_recent_destination_owner
  from troop_movements tm
  join territories t
    on t.id = tm.destination_territory_id
  where tm.player_id = v_npc
  order by tm.started_at desc, tm.id desc
  limit 1;

  assert v_recent_destination_owner is null,
    'when the focus enemy cannot be beaten anywhere, the NPC should fall through to a normal non-war action';

  delete from troop_movement_units
  where movement_id in (
    select id
    from troop_movements tm
    where player_id = v_npc
      and origin_territory_id = v_origin_territory
      and destination_territory_id in (v_adjacent_expansion, v_focus_target)
  );

  delete from troop_movements
  where player_id = v_npc
    and origin_territory_id = v_origin_territory
    and destination_territory_id in (v_adjacent_expansion, v_focus_target);

  delete from diplomacy_relations
  where v_npc in (player_a_id, player_b_id);

  update territories
  set owner_id = null,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_focus_target;

  update card_instances
  set owner_id = v_npc,
      stationed_territory_id = v_origin_territory,
      status = 'stationed',
      deposit_expires_at = null
  where instance_id = any(v_origin_card_ids_small);

  update players
  set npc_next_action_at = now() - interval '1 minute'
  where id = v_npc;

  perform resolve_due_npc_actions();

  select tm.id, tm.destination_territory_id
  into v_recent_movement_id, v_recent_destination
  from troop_movements tm
  where tm.player_id = v_npc
  order by tm.started_at desc, tm.id desc
  limit 1;

  select npc_next_action_at
  into v_rescheduled_at
  from players
  where id = v_npc;

  assert v_recent_movement_id is not null and v_rescheduled_at > now() + interval '3 hours',
    'NPCs without active wars should still take a normal action and get rescheduled';
end;
$$;

rollback;
