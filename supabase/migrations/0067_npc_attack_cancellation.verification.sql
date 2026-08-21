begin;

do $$
declare
  v_defender_id uuid := gen_random_uuid();
  v_npc_id uuid := gen_random_uuid();
  v_regression_attacker_id uuid := gen_random_uuid();
  v_free_territories integer[];
  v_unit_template_id text;
  v_unit_power numeric;
  v_s1_attack_origin integer;
  v_s1_target integer;
  v_s1_reinforce_origin integer;
  v_s2_attack_origin integer;
  v_s2_target integer;
  v_s2_reinforce_origin integer;
  v_regression_origin integer;
  v_regression_target integer;
  v_s1_attack_cards uuid[] := '{}'::uuid[];
  v_s1_garrison_cards uuid[] := '{}'::uuid[];
  v_s1_reinforce_cards uuid[] := '{}'::uuid[];
  v_s2_attack_cards uuid[] := '{}'::uuid[];
  v_s2_garrison_cards uuid[] := '{}'::uuid[];
  v_s2_reinforce_cards uuid[] := '{}'::uuid[];
  v_regression_attack_cards uuid[] := '{}'::uuid[];
  v_attack_movement_1 uuid;
  v_attack_movement_2 uuid;
  v_regression_movement_id uuid;
  v_reinforcement_movement_1 uuid := gen_random_uuid();
  v_reinforcement_movement_2 uuid := gen_random_uuid();
  v_card_instance_id uuid;
  v_count integer;
  v_npc_display_name text;
  v_s2_next_reeval timestamptz;
  v_s1_target_name text;
begin
  assert to_regprocedure('_movement_unit_power(uuid,boolean,integer)') is not null,
    'missing _movement_unit_power(uuid,boolean,integer)';
  assert to_regprocedure('_recall_attack_core(uuid,uuid)') is not null,
    'missing _recall_attack_core(uuid,uuid)';
  assert to_regprocedure('resolve_due_npc_attack_reevaluations()') is not null,
    'missing resolve_due_npc_attack_reevaluations()';
  assert to_regprocedure('recall_attack(uuid)') is not null,
    'missing recall_attack(uuid)';

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_defender_id,
      'authenticated',
      'authenticated',
      'npc-attack-cancel-defender@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Attack Cancel Defender","nation":"scandinavia"}'::jsonb,
      now(),
      now()
    ),
    (
      v_npc_id,
      'authenticated',
      'authenticated',
      'npc-attack-cancel-npc@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Attack Cancel NPC","nation":"scandinavia"}'::jsonb,
      now(),
      now()
    ),
    (
      v_regression_attacker_id,
      'authenticated',
      'authenticated',
      'npc-attack-cancel-regression@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Attack Cancel Regression","nation":"scandinavia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_defender_id, 'Attack Cancel Defender Kingdom', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_npc_id, 'Attack Cancel NPC Kingdom', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_regression_attacker_id, 'Attack Cancel Regressors', 'lion-gold');

  update players
  set is_npc = true,
      npc_next_action_at = null
  where id = v_npc_id;

  select display_name into v_npc_display_name
  from players
  where id = v_npc_id;

  select array_agg(id order by id)
  into v_free_territories
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
    limit 8
  ) free_tiles;

  assert coalesce(array_length(v_free_territories, 1), 0) = 8,
    'need eight free territories for 0067 verification';

  v_s1_attack_origin := v_free_territories[1];
  v_s1_target := v_free_territories[2];
  v_s1_reinforce_origin := v_free_territories[3];
  v_s2_attack_origin := v_free_territories[4];
  v_s2_target := v_free_territories[5];
  v_s2_reinforce_origin := v_free_territories[6];
  v_regression_origin := v_free_territories[7];
  v_regression_target := v_free_territories[8];

  update territories
  set owner_id = v_npc_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id in (v_s1_attack_origin, v_s2_attack_origin);

  update territories
  set owner_id = v_defender_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id in (v_s1_target, v_s1_reinforce_origin, v_s2_target, v_s2_reinforce_origin, v_regression_target);

  update territories
  set owner_id = v_regression_attacker_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_regression_origin;

  select name into v_s1_target_name from territories where id = v_s1_target;

  select id into v_unit_template_id
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  assert v_unit_template_id is not null, 'need a unit template for 0067 verification';

  select e.hp + e.str + e.lng + e.def
  into v_unit_power
  from card_templates ct
  cross join lateral _compute_effective_stats(
    ct.base_stats,
    ct.rank,
    'scandinavia',
    false,
    null,
    null,
    null
  ) e
  where ct.id = v_unit_template_id;

  assert v_unit_power > 0, 'verification unit template must have positive power';

  for v_count in 1..4 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_unit_template_id, v_npc_id, v_s1_attack_origin, 'stationed')
    returning instance_id into v_card_instance_id;
    v_s1_attack_cards := array_append(v_s1_attack_cards, v_card_instance_id);
  end loop;

  for v_count in 1..2 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_unit_template_id, v_defender_id, v_s1_target, 'stationed')
    returning instance_id into v_card_instance_id;
    v_s1_garrison_cards := array_append(v_s1_garrison_cards, v_card_instance_id);
  end loop;

  for v_count in 1..3 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_unit_template_id, v_defender_id, v_s1_reinforce_origin, 'stationed')
    returning instance_id into v_card_instance_id;
    v_s1_reinforce_cards := array_append(v_s1_reinforce_cards, v_card_instance_id);
  end loop;

  for v_count in 1..4 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_unit_template_id, v_npc_id, v_s2_attack_origin, 'stationed')
    returning instance_id into v_card_instance_id;
    v_s2_attack_cards := array_append(v_s2_attack_cards, v_card_instance_id);
  end loop;

  for v_count in 1..2 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_unit_template_id, v_defender_id, v_s2_target, 'stationed')
    returning instance_id into v_card_instance_id;
    v_s2_garrison_cards := array_append(v_s2_garrison_cards, v_card_instance_id);
  end loop;

  for v_count in 1..3 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_unit_template_id, v_defender_id, v_s2_reinforce_origin, 'stationed')
    returning instance_id into v_card_instance_id;
    v_s2_reinforce_cards := array_append(v_s2_reinforce_cards, v_card_instance_id);
  end loop;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_unit_template_id, v_regression_attacker_id, v_regression_origin, 'stationed')
  returning instance_id into v_card_instance_id;
  v_regression_attack_cards := array_append(v_regression_attack_cards, v_card_instance_id);

  select _declare_attack_core(
    v_npc_id,
    v_s1_target,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', v_s1_attack_origin,
        'card_instance_ids', to_jsonb(v_s1_attack_cards)
      )
    ),
    null
  ) into v_attack_movement_1;

  update troop_movements
  set started_at = now() - interval '1 hour',
      transfer_arrives_at = now() + interval '2 hours',
      npc_reeval_at = now() - interval '1 minute'
  where id = v_attack_movement_1;

  insert into troop_movements (
    id,
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    started_at,
    transfer_arrives_at,
    status
  ) values (
    v_reinforcement_movement_1,
    v_defender_id,
    'transfer',
    v_s1_reinforce_origin,
    v_s1_target,
    now() - interval '30 minutes',
    now() + interval '1 hour',
    'in_transit'
  );

  insert into troop_movement_units (movement_id, card_instance_id)
  select v_reinforcement_movement_1, unnest(v_s1_reinforce_cards);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(v_s1_reinforce_cards);

  perform resolve_due_npc_attack_reevaluations();

  select count(*) into v_count
  from troop_movements
  where id = v_attack_movement_1
    and status = 'cancelled';
  assert v_count = 1, 'scenario 1: NPC attack should be cancelled when timely reinforcements push defenders above the threshold';

  select count(*) into v_count
  from troop_movements
  where player_id = v_npc_id
    and kind = 'transfer'
    and status = 'in_transit'
    and origin_territory_id = v_s1_target
    and destination_territory_id = v_s1_attack_origin;
  assert v_count = 1, 'scenario 1: cancelling the NPC attack should create a return transfer back to the original origin';

  select count(*) into v_count
  from territories
  where id = v_s1_target
    and battle_locked_by is null;
  assert v_count = 1, 'scenario 1: battle_locked_by should be cleared when the NPC attack is cancelled';

  select count(*) into v_count
  from notifications
  where player_id = v_defender_id
    and type = 'attack_cancelled'
    and payload->>'territory_id' = v_s1_target::text
    and payload->>'territory_x' is not null
    and payload->>'territory_y' is not null
    and payload ? 'territory_name'
    and payload->>'territory_name' is not distinct from v_s1_target_name
    and payload->>'attacker_display_name' = v_npc_display_name;
  assert v_count = 1, 'scenario 1: defender should receive an attack_cancelled notification with the expected payload';

  select count(*) into v_count
  from world_events
  where event_type = 'attack_recalled'
    and payload->>'attacker_id' = v_npc_id::text
    and payload->>'territory_id' = v_s1_target::text;
  assert v_count = 1, 'scenario 1: cancelling the NPC attack should emit the existing attack_recalled world event';

  select _declare_attack_core(
    v_npc_id,
    v_s2_target,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', v_s2_attack_origin,
        'card_instance_ids', to_jsonb(v_s2_attack_cards)
      )
    ),
    null
  ) into v_attack_movement_2;

  update troop_movements
  set started_at = now() - interval '1 hour',
      transfer_arrives_at = now() + interval '2 hours',
      npc_reeval_at = now() - interval '1 minute'
  where id = v_attack_movement_2;

  insert into troop_movements (
    id,
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    started_at,
    transfer_arrives_at,
    status
  ) values (
    v_reinforcement_movement_2,
    v_defender_id,
    'transfer',
    v_s2_reinforce_origin,
    v_s2_target,
    now() - interval '30 minutes',
    now() + interval '3 hours',
    'in_transit'
  );

  insert into troop_movement_units (movement_id, card_instance_id)
  select v_reinforcement_movement_2, unnest(v_s2_reinforce_cards);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(v_s2_reinforce_cards);

  perform resolve_due_npc_attack_reevaluations();

  select count(*) into v_count
  from troop_movements
  where id = v_attack_movement_2
    and status = 'in_transit';
  assert v_count = 1, 'scenario 2: NPC attack should remain in transit when reinforcements arrive too late';

  select npc_reeval_at into v_s2_next_reeval
  from troop_movements
  where id = v_attack_movement_2;

  assert v_s2_next_reeval > now() + interval '29 minutes'
    and v_s2_next_reeval < now() + interval '31 minutes',
    'scenario 2: npc_reeval_at should advance by roughly 30 minutes when no cancellation happens';

  select _declare_attack_core(
    v_regression_attacker_id,
    v_regression_target,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', v_regression_origin,
        'card_instance_ids', to_jsonb(v_regression_attack_cards)
      )
    ),
    null
  ) into v_regression_movement_id;

  update troop_movements
  set started_at = now() - interval '45 minutes',
      transfer_arrives_at = now() + interval '90 minutes'
  where id = v_regression_movement_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_regression_attacker_id::text, true);
  perform recall_attack(v_regression_movement_id);
  execute 'reset role';

  select count(*) into v_count
  from troop_movements
  where id = v_regression_movement_id
    and status = 'cancelled';
  assert v_count = 1, 'scenario 3: public recall_attack wrapper should still cancel an in-transit player attack';

  select count(*) into v_count
  from troop_movements
  where player_id = v_regression_attacker_id
    and kind = 'transfer'
    and status = 'in_transit'
    and origin_territory_id = v_regression_target
    and destination_territory_id = v_regression_origin;
  assert v_count = 1, 'scenario 3: public recall_attack wrapper should still create the return transfer movement';

  select count(*) into v_count
  from territories
  where id = v_regression_target
    and battle_locked_by is null;
  assert v_count = 1, 'scenario 3: public recall_attack wrapper should still clear battle_locked_by';

  raise notice 'VERIFICATION OK: 0067 NPC attack cancellation scenarios passed';
end
$$;

rollback;

