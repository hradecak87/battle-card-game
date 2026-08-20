begin;

do $$
declare
  v_attacker_id uuid := gen_random_uuid();
  v_defender_id uuid := gen_random_uuid();
  v_joined_id uuid := gen_random_uuid();
  v_attacker_home_id integer;
  v_defender_home_id integer;
  v_recall_target_id integer;
  v_claim_target_id integer;
  v_battle_target_id integer;
  v_surrender_target_id integer;
  v_abandon_target_id integer;
  v_relocate_target_id integer;
  v_attacker_card_1 uuid;
  v_attacker_card_2 uuid;
  v_attacker_card_3 uuid;
  v_attacker_card_4 uuid;
  v_defender_card_1 uuid;
  v_defender_card_2 uuid;
  v_movement_id uuid;
  v_battle_id uuid;
  v_before integer;
  v_after integer;
  v_payload jsonb;
begin
  assert to_regclass('world_events') is not null, 'missing world_events table';

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_attacker_id,
      'authenticated',
      'authenticated',
      'world-feed-attacker@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"WF Attacker","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_defender_id,
      'authenticated',
      'authenticated',
      'world-feed-defender@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"WF Defender","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_attacker_id, 'World Feed Attackers', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_defender_id, 'World Feed Defenders', 'cross-white');

  select id into v_attacker_home_id
  from territories
  where owner_id = v_attacker_id
    and is_home = true;

  select id into v_defender_home_id
  from territories
  where owner_id = v_defender_id
    and is_home = true;

  assert v_attacker_home_id is not null, 'attacker home should exist';
  assert v_defender_home_id is not null, 'defender home should exist';

  select t.id into v_recall_target_id
  from territories t
  where t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = t.id
        and ci.owner_id is null
        and ct.category = 'unit'
    )
  order by t.id
  limit 1;

  select t.id into v_claim_target_id
  from territories t
  where t.id <> v_recall_target_id
    and t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = t.id
        and ci.owner_id is null
        and ct.category = 'unit'
    )
  order by t.id
  limit 1;

  select t.id into v_battle_target_id
  from territories t
  where t.id not in (v_recall_target_id, v_claim_target_id)
    and t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
  order by t.id
  limit 1;

  select t.id into v_surrender_target_id
  from territories t
  where t.id not in (v_recall_target_id, v_claim_target_id, v_battle_target_id)
    and t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
  order by t.id
  limit 1;

  select t.id into v_abandon_target_id
  from territories t
  where t.id not in (v_recall_target_id, v_claim_target_id, v_battle_target_id, v_surrender_target_id)
    and t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
  order by t.id
  limit 1;

  select t.id into v_relocate_target_id
  from territories t
  where t.id not in (
      v_recall_target_id,
      v_claim_target_id,
      v_battle_target_id,
      v_surrender_target_id,
      v_abandon_target_id
    )
    and t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
  order by t.id
  limit 1;

  assert v_recall_target_id is not null, 'need recall target';
  assert v_claim_target_id is not null, 'need claim target';
  assert v_battle_target_id is not null, 'need battle target';
  assert v_surrender_target_id is not null, 'need surrender target';
  assert v_abandon_target_id is not null, 'need abandon target';
  assert v_relocate_target_id is not null, 'need relocate target';

  select ci.instance_id
  into v_attacker_card_1
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_attacker_id
    and ci.stationed_territory_id = v_attacker_home_id
    and ci.status = 'stationed'
    and ct.category = 'unit'
  order by ci.instance_id
  limit 1;

  select ci.instance_id
  into v_attacker_card_2
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_attacker_id
    and ci.stationed_territory_id = v_attacker_home_id
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ci.instance_id <> v_attacker_card_1
  order by ci.instance_id
  limit 1;

  select ci.instance_id
  into v_attacker_card_3
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_attacker_id
    and ci.stationed_territory_id = v_attacker_home_id
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ci.instance_id not in (v_attacker_card_1, v_attacker_card_2)
  order by ci.instance_id
  limit 1;

  select ci.instance_id
  into v_attacker_card_4
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_attacker_id
    and ci.stationed_territory_id = v_attacker_home_id
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ci.instance_id not in (v_attacker_card_1, v_attacker_card_2, v_attacker_card_3)
  order by ci.instance_id
  limit 1;

  select ci.instance_id
  into v_defender_card_1
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_defender_id
    and ci.stationed_territory_id = v_defender_home_id
    and ci.status = 'stationed'
    and ct.category = 'unit'
  order by ci.instance_id
  limit 1;

  select ci.instance_id
  into v_defender_card_2
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_defender_id
    and ci.stationed_territory_id = v_defender_home_id
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ci.instance_id <> v_defender_card_1
  order by ci.instance_id
  limit 1;

  assert v_attacker_card_1 is not null, 'attacker starter cards missing';
  assert v_attacker_card_2 is not null, 'attacker second card missing';
  assert v_attacker_card_3 is not null, 'attacker third card missing';
  assert v_attacker_card_4 is not null, 'attacker fourth card missing';
  assert v_defender_card_1 is not null, 'defender starter card missing';
  assert v_defender_card_2 is not null, 'defender second card missing';

  select count(*) into v_before from world_events where event_type = 'attack_declared';
  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);
  v_movement_id := declare_attack(
    v_recall_target_id,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', v_attacker_home_id,
        'card_instance_ids', to_jsonb(array[v_attacker_card_1]::uuid[])
      )
    ),
    null
  );
  select count(*) into v_after from world_events where event_type = 'attack_declared';
  assert v_after = v_before + 1, 'attack_declared should log exactly one event';
  select payload into v_payload
  from world_events
  where event_type = 'attack_declared'
  order by id desc
  limit 1;
  assert (v_payload->>'attacker_id')::uuid = v_attacker_id, 'attack_declared attacker mismatch';
  assert (v_payload->>'territory_id')::integer = v_recall_target_id, 'attack_declared target mismatch';

  select count(*) into v_before from world_events where event_type = 'attack_recalled';
  perform recall_attack(v_movement_id);
  select count(*) into v_after from world_events where event_type = 'attack_recalled';
  assert v_after = v_before + 1, 'attack_recalled should log exactly one event';
  select payload into v_payload
  from world_events
  where event_type = 'attack_recalled'
  order by id desc
  limit 1;
  assert (v_payload->>'territory_id')::integer = v_recall_target_id, 'attack_recalled target mismatch';

  select count(*) into v_before from world_events where event_type = 'territory_claimed';
  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);
  v_movement_id := declare_attack(
    v_claim_target_id,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', v_attacker_home_id,
        'card_instance_ids', to_jsonb(array[v_attacker_card_2]::uuid[])
      )
    ),
    null
  );
  update troop_movements
  set transfer_arrives_at = now() - interval '5 minutes'
  where id = v_movement_id;
  perform resolve_due_movements();
  update territories
  set claim_occupation_completes_at = now() - interval '5 minutes'
  where id = v_claim_target_id;
  perform resolve_due_movements();
  select count(*) into v_after from world_events where event_type = 'territory_claimed';
  assert v_after = v_before + 1, 'territory_claimed should log exactly one event';
  select payload into v_payload
  from world_events
  where event_type = 'territory_claimed'
  order by id desc
  limit 1;
  assert (v_payload->>'player_id')::uuid = v_attacker_id, 'territory_claimed player mismatch';
  assert (v_payload->>'territory_id')::integer = v_claim_target_id, 'territory_claimed target mismatch';
  assert exists (
    select 1 from territories
    where id = v_claim_target_id
      and owner_id = v_attacker_id
  ), 'claim target should end up owned by attacker';

  update territories
  set owner_id = v_defender_id
  where id = v_battle_target_id;
  update card_instances
  set stationed_territory_id = v_battle_target_id
  where instance_id = v_defender_card_1;

  select count(*) into v_before from world_events where event_type = 'battle_won';
  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);
  v_movement_id := declare_attack(
    v_battle_target_id,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', v_attacker_home_id,
        'card_instance_ids', to_jsonb(array[v_attacker_card_3]::uuid[])
      )
    ),
    null
  );
  update troop_movements
  set transfer_arrives_at = now() - interval '5 minutes'
  where id = v_movement_id;
  perform resolve_due_movements();
  select id into v_battle_id
  from battles
  where movement_id = v_movement_id;
  assert v_battle_id is not null, 'battle should exist for battle_won verification';
  perform _finalize_battle(v_battle_id, 'attacker');
  select count(*) into v_after from world_events where event_type = 'battle_won';
  assert v_after = v_before + 1, 'battle_won should log exactly one event';
  select payload into v_payload
  from world_events
  where event_type = 'battle_won'
  order by id desc
  limit 1;
  assert (v_payload->>'winner_id')::uuid = v_attacker_id, 'battle_won winner mismatch';
  assert (v_payload->>'territory_id')::integer = v_battle_target_id, 'battle_won territory mismatch';

  update territories
  set owner_id = v_defender_id
  where id = v_surrender_target_id;
  update card_instances
  set stationed_territory_id = v_surrender_target_id
  where instance_id = v_defender_card_2;

  select count(*) into v_before from world_events where event_type = 'battle_surrendered';
  select count(*) into v_after from world_events where event_type = 'battle_won';
  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);
  v_movement_id := declare_attack(
    v_surrender_target_id,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', v_attacker_home_id,
        'card_instance_ids', to_jsonb(array[v_attacker_card_4]::uuid[])
      )
    ),
    null
  );
  update troop_movements
  set transfer_arrives_at = now() - interval '5 minutes'
  where id = v_movement_id;
  perform resolve_due_movements();
  select id into v_battle_id
  from battles
  where movement_id = v_movement_id;
  assert v_battle_id is not null, 'battle should exist for surrender verification';
  update battles
  set status = 'active',
      round_deadline = now()
  where id = v_battle_id;
  perform set_config('request.jwt.claim.sub', v_defender_id::text, true);
  perform surrender_battle(v_battle_id);
  assert (select count(*) from world_events where event_type = 'battle_surrendered') = v_before + 1,
    'battle_surrendered should log exactly one event';
  assert (select count(*) from world_events where event_type = 'battle_won') = v_after,
    'battle_surrendered should not also create battle_won';
  select payload into v_payload
  from world_events
  where event_type = 'battle_surrendered'
  order by id desc
  limit 1;
  assert (v_payload->>'winner_id')::uuid = v_attacker_id, 'battle_surrendered winner mismatch';
  assert v_payload->>'surrendered_side' = 'defender', 'battle_surrendered should note surrendered side';

  update territories
  set owner_id = v_attacker_id
  where id = v_abandon_target_id;

  select count(*) into v_before from world_events where event_type = 'territory_abandoned';
  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);
  perform abandon_territory(v_abandon_target_id);
  select count(*) into v_after from world_events where event_type = 'territory_abandoned';
  assert v_after = v_before + 1, 'territory_abandoned should log exactly one event';
  select payload into v_payload
  from world_events
  where event_type = 'territory_abandoned'
  order by id desc
  limit 1;
  assert (v_payload->>'territory_id')::integer = v_abandon_target_id, 'territory_abandoned territory mismatch';

  update territories
  set owner_id = v_attacker_id
  where id = v_relocate_target_id;
  update players
  set xp = 20000,
      king_relocation_used_at = null
  where id = v_attacker_id;

  select count(*) into v_before from world_events where event_type = 'king_relocated';
  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);
  perform relocate_home(v_relocate_target_id);
  select count(*) into v_after from world_events where event_type = 'king_relocated';
  assert v_after = v_before + 1, 'king_relocated should log exactly one event';
  select payload into v_payload
  from world_events
  where event_type = 'king_relocated'
  order by id desc
  limit 1;
  assert (v_payload->>'new_home_territory_id')::integer = v_relocate_target_id, 'king_relocated target mismatch';

  update players
  set xp = 99
  where id = v_attacker_id;
  select count(*) into v_before from world_events where event_type = 'player_leveled_up';
  perform _award_xp(v_attacker_id, 1);
  select count(*) into v_after from world_events where event_type = 'player_leveled_up';
  assert v_after = v_before + 1, 'player_leveled_up should log exactly one event';
  select payload into v_payload
  from world_events
  where event_type = 'player_leveled_up'
  order by id desc
  limit 1;
  assert (v_payload->>'player_id')::uuid = v_attacker_id, 'player_leveled_up player mismatch';
  assert (v_payload->>'new_level')::integer = 2, 'player_leveled_up level mismatch';

  select count(*) into v_before from world_events where event_type = 'player_joined';
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    v_joined_id,
    'authenticated',
    'authenticated',
    'world-feed-joined@example.com',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"WF Joined","nation":"hre"}'::jsonb,
    now(),
    now()
  );
  select count(*) into v_after from world_events where event_type = 'player_joined';
  assert v_after = v_before + 1, 'player_joined should log exactly one event';
  select payload into v_payload
  from world_events
  where event_type = 'player_joined'
  order by id desc
  limit 1;
  assert (v_payload->>'player_id')::uuid = v_joined_id, 'player_joined player mismatch';
  assert v_payload->>'player_display_name' = 'WF Joined', 'player_joined display name mismatch';
end;
$$;

rollback;
