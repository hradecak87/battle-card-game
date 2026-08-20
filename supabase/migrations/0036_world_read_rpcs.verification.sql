begin;

do $$
declare
  v_attacker_id uuid := gen_random_uuid();
  v_defender_id uuid := gen_random_uuid();
  v_attacker_home_id integer;
  v_defender_home_id integer;
  v_attack_target_id integer;
  v_claim_target_id integer;
  v_battle_target_id integer;
  v_attack_movement_id uuid;
  v_battle_movement_id uuid;
  v_battle_id uuid := gen_random_uuid();
  v_event_count integer;
  v_row record;
begin
  assert to_regprocedure('world_list_attacks_in_transit()') is not null, 'missing world_list_attacks_in_transit()';
  assert to_regprocedure('world_list_claims_in_progress()') is not null, 'missing world_list_claims_in_progress()';
  assert to_regprocedure('world_list_active_battles()') is not null, 'missing world_list_active_battles()';
  assert to_regprocedure('world_list_events(integer, integer)') is not null, 'missing world_list_events(integer, integer)';

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_attacker_id,
      'authenticated',
      'authenticated',
      'world-read-attacker@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"World Read Attacker","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_defender_id,
      'authenticated',
      'authenticated',
      'world-read-defender@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"World Read Defender","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_attacker_id, 'World Read Attackers', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_defender_id, 'World Read Defenders', 'cross-white');

  select id into v_attacker_home_id
  from territories
  where owner_id = v_attacker_id
    and is_home = true;

  select id into v_defender_home_id
  from territories
  where owner_id = v_defender_id
    and is_home = true;

  select t.id into v_attack_target_id
  from territories t
  where t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
  order by t.id
  limit 1;

  select t.id into v_claim_target_id
  from territories t
  where t.id <> v_attack_target_id
    and t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
  order by t.id
  limit 1;

  select t.id into v_battle_target_id
  from territories t
  where t.id not in (v_attack_target_id, v_claim_target_id)
    and t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
  order by t.id
  limit 1;

  assert v_attack_target_id is not null, 'need attack target';
  assert v_claim_target_id is not null, 'need claim target';
  assert v_battle_target_id is not null, 'need battle target';

  insert into troop_movements (
    id,
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    transfer_arrives_at,
    status
  )
  values (
    gen_random_uuid(),
    v_attacker_id,
    'attack',
    v_attacker_home_id,
    v_attack_target_id,
    now() + interval '2 hours',
    'in_transit'
  )
  returning id into v_attack_movement_id;

  update territories
  set claim_locked_by = v_attacker_id,
      claim_started_at = now() - interval '30 minutes',
      claim_transfer_arrives_at = now() - interval '30 minutes',
      claim_occupation_completes_at = now() + interval '3 hours'
  where id = v_claim_target_id;

  update territories
  set owner_id = v_defender_id
  where id = v_battle_target_id;

  insert into troop_movements (
    id,
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    transfer_arrives_at,
    status
  )
  values (
    gen_random_uuid(),
    v_attacker_id,
    'attack',
    v_attacker_home_id,
    v_battle_target_id,
    now() - interval '1 hour',
    'completed'
  )
  returning id into v_battle_movement_id;

  insert into battles (
    id,
    territory_id,
    attacker_id,
    defender_id,
    movement_id,
    is_home_target,
    status,
    ready_deadline,
    current_round
  )
  values (
    v_battle_id,
    v_battle_target_id,
    v_attacker_id,
    v_defender_id,
    v_battle_movement_id,
    false,
    'active',
    now() + interval '1 hour',
    2
  );

  insert into world_events (event_type, created_at, payload)
  select
    case when gs = 1 then 'battle_won' else 'attack_declared' end,
    now() - make_interval(mins => gs),
    jsonb_build_object('ordinal', gs)
  from generate_series(1, 55) gs;

  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);

  select * into v_row
  from world_list_attacks_in_transit()
  where movement_id = v_attack_movement_id;
  assert v_row.movement_id = v_attack_movement_id, 'attack RPC should return the scratch movement';
  assert v_row.attacker_id = v_attacker_id, 'attack RPC attacker mismatch';
  assert v_row.target_territory_id = v_attack_target_id, 'attack RPC target mismatch';

  select * into v_row
  from world_list_claims_in_progress()
  where territory_id = v_claim_target_id;
  assert v_row.territory_id = v_claim_target_id, 'claim RPC should return the scratch territory';
  assert v_row.claimant_id = v_attacker_id, 'claim RPC claimant mismatch';

  select * into v_row
  from world_list_active_battles()
  where battle_id = v_battle_id;
  assert v_row.battle_id = v_battle_id, 'battle RPC should return the scratch battle';
  assert v_row.current_round = 2, 'battle RPC current_round mismatch';
  assert v_row.status = 'active', 'battle RPC status mismatch';

  select count(*) into v_event_count
  from world_list_events(0, 10);
  assert v_event_count = 10, 'page 0 should return 10 rows';

  select * into v_row
  from world_list_events(0, 10)
  order by created_at desc
  limit 1;
  assert v_row.total_count = 50, 'world_list_events should clamp total_count to 50';

  select count(*) into v_event_count
  from world_list_events(4, 10);
  assert v_event_count = 10, 'page 4 should still return the newest row in the 50-row window';

  select count(*) into v_event_count
  from world_list_events(5, 10);
  assert v_event_count = 0, 'page 5 should not read past the newest 50 rows';

  select count(*) into v_event_count
  from world_list_events(-5, 999);
  assert v_event_count = 10, 'page/size inputs should clamp to page 0, size 10';
end;
$$;

rollback;
