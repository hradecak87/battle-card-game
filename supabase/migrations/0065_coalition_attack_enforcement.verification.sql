begin;

do $$
declare
  v_player_ids uuid[] := '{}'::uuid[];
  v_index integer;
  v_template_id text;
  v_coalition_id uuid := gen_random_uuid();
  v_origin_a integer;
  v_coalition_attack_target integer;
  v_coalition_claim_target integer;
  v_origin_b integer;
  v_pact_attack_target integer;
  v_pact_claim_target integer;
  v_normal_attack_target integer;
  v_free_claim_target integer;
  v_card_attack_blocked uuid;
  v_card_claim_blocked uuid;
  v_card_attack_pact uuid;
  v_card_claim_pact uuid;
  v_card_attack_ok uuid;
  v_card_claim_ok uuid;
  v_failed boolean;
  v_movement_id uuid;
begin
  assert to_regprocedure('_declare_attack_core(uuid, integer, jsonb, uuid)') is not null,
    'missing _declare_attack_core(uuid, integer, jsonb, uuid)';
  assert to_regprocedure('_start_claim_core(uuid, integer, integer, uuid[])') is not null,
    'missing _start_claim_core(uuid, integer, integer, uuid[])';

  for v_index in 1..4 loop
    v_player_ids := array_append(v_player_ids, gen_random_uuid());

    insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      v_player_ids[v_index],
      'authenticated',
      'authenticated',
      format('coalition-attack-verify-%s@example.com', v_index),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'display_name', format('Coalition Attack Verify %s', v_index),
        'nation', 'england'
      ),
      now(),
      now()
    );

    perform _complete_kingdom_onboarding_core(
      v_player_ids[v_index],
      format('Coalition Verify %s', v_index),
      'lion-gold'
    );
  end loop;

  select id into v_template_id
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  assert v_template_id is not null, 'need a unit template for coalition attack enforcement verification';

  select id into v_origin_a
  from territories
  where owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_coalition_attack_target
  from territories
  where id > v_origin_a
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_coalition_claim_target
  from territories
  where id > v_coalition_attack_target
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_origin_b
  from territories
  where id > v_coalition_claim_target
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_pact_attack_target
  from territories
  where id > v_origin_b
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_pact_claim_target
  from territories
  where id > v_pact_attack_target
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_normal_attack_target
  from territories
  where id > v_pact_claim_target
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_free_claim_target
  from territories
  where id > v_normal_attack_target
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  assert v_origin_a is not null
    and v_coalition_attack_target is not null
    and v_coalition_claim_target is not null
    and v_origin_b is not null
    and v_pact_attack_target is not null
    and v_pact_claim_target is not null
    and v_normal_attack_target is not null
    and v_free_claim_target is not null,
    'need eight unlocked empty territories for coalition attack enforcement verification';

  update territories
  set owner_id = v_player_ids[1],
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_origin_a;

  update territories
  set owner_id = v_player_ids[2],
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id in (v_coalition_attack_target, v_coalition_claim_target);

  update territories
  set owner_id = v_player_ids[3],
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id in (v_origin_b, v_normal_attack_target);

  update territories
  set owner_id = v_player_ids[4],
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id in (v_pact_attack_target, v_pact_claim_target);

  insert into coalitions (id, name, leader_id)
  values (v_coalition_id, 'verification-coalition-0065', v_player_ids[1]);

  insert into coalition_members (coalition_id, player_id)
  values (v_coalition_id, v_player_ids[1]), (v_coalition_id, v_player_ids[2]);

  insert into diplomacy_relations (player_a_id, player_b_id, state)
  values (least(v_player_ids[3], v_player_ids[4]), greatest(v_player_ids[3], v_player_ids[4]), 'non_aggression');

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_player_ids[1], v_origin_a, 'stationed')
  returning instance_id into v_card_attack_blocked;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_player_ids[1], v_origin_a, 'stationed')
  returning instance_id into v_card_claim_blocked;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_player_ids[1], v_origin_a, 'stationed')
  returning instance_id into v_card_attack_ok;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_player_ids[1], v_origin_a, 'stationed')
  returning instance_id into v_card_claim_ok;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_player_ids[3], v_origin_b, 'stationed')
  returning instance_id into v_card_attack_pact;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_player_ids[3], v_origin_b, 'stationed')
  returning instance_id into v_card_claim_pact;

  v_failed := false;
  begin
    perform _declare_attack_core(
      v_player_ids[1],
      v_coalition_attack_target,
      jsonb_build_array(
        jsonb_build_object(
          'origin_territory_id', v_origin_a,
          'card_instance_ids', jsonb_build_array(v_card_attack_blocked)
        )
      ),
      null
    );
  exception
    when others then
      v_failed := position('cannot attack/claim: target is a coalition member or under a non-aggression pact' in sqlerrm) > 0;
  end;
  assert v_failed, 'coalition members should not be able to attack each other';

  v_failed := false;
  begin
    perform _start_claim_core(v_player_ids[1], v_origin_a, v_coalition_claim_target, array[v_card_claim_blocked]::uuid[]);
  exception
    when others then
      v_failed := position('cannot attack/claim: target is a coalition member or under a non-aggression pact' in sqlerrm) > 0;
  end;
  assert v_failed, 'coalition members should not be able to start a hostile claim against each other';

  v_failed := false;
  begin
    perform _declare_attack_core(
      v_player_ids[3],
      v_pact_attack_target,
      jsonb_build_array(
        jsonb_build_object(
          'origin_territory_id', v_origin_b,
          'card_instance_ids', jsonb_build_array(v_card_attack_pact)
        )
      ),
      null
    );
  exception
    when others then
      v_failed := position('cannot attack/claim: target is a coalition member or under a non-aggression pact' in sqlerrm) > 0;
  end;
  assert v_failed, 'non-aggression pact holders should not be able to attack each other';

  v_failed := false;
  begin
    perform _start_claim_core(v_player_ids[3], v_origin_b, v_pact_claim_target, array[v_card_claim_pact]::uuid[]);
  exception
    when others then
      v_failed := position('cannot attack/claim: target is a coalition member or under a non-aggression pact' in sqlerrm) > 0;
  end;
  assert v_failed, 'non-aggression pact holders should not be able to start a hostile claim against each other';

  select _declare_attack_core(
    v_player_ids[1],
    v_normal_attack_target,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', v_origin_a,
        'card_instance_ids', jsonb_build_array(v_card_attack_ok)
      )
    ),
    null
  ) into v_movement_id;
  assert v_movement_id is not null, 'ordinary hostile attack should still succeed when no coalition/pact applies';

  perform _start_claim_core(v_player_ids[1], v_origin_a, v_free_claim_target, array[v_card_claim_ok]::uuid[]);
  assert exists (
    select 1
    from territories
    where id = v_free_claim_target
      and claim_locked_by = v_player_ids[1]
  ), 'ordinary claim should still succeed when no coalition/pact applies';
end;
$$;

rollback;
