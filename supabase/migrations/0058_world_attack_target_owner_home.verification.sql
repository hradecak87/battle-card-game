begin;

do $$
declare
  v_attacker_id uuid := gen_random_uuid();
  v_defender_id uuid := gen_random_uuid();
  v_attacker_home_id integer;
  v_defender_home_id integer;
  v_defender_home_x smallint;
  v_defender_home_y smallint;
  v_empty_target_id integer;
  v_attack_movement_id uuid;
  v_row record;
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_attacker_id,
      'authenticated',
      'authenticated',
      'target-owner-home-attacker@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Target Owner Home Attacker","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_defender_id,
      'authenticated',
      'authenticated',
      'target-owner-home-defender@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Target Owner Home Defender","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_attacker_id, 'Target Owner Home Attackers', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_defender_id, 'Target Owner Home Defenders', 'cross-white');

  select id into v_attacker_home_id
  from territories
  where owner_id = v_attacker_id
    and is_home = true;

  select id, x, y into v_defender_home_id, v_defender_home_x, v_defender_home_y
  from territories
  where owner_id = v_defender_id
    and is_home = true;

  select t.id into v_empty_target_id
  from territories t
  where t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and t.is_home = false
  order by t.id
  limit 1;

  assert v_empty_target_id is not null, 'need an empty target territory';

  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);

  -- Attack on an owned territory: target_owner_home_x/y should match the
  -- defender's actual home coordinates.
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
    v_defender_home_id,
    now() + interval '2 hours',
    'in_transit'
  )
  returning id into v_attack_movement_id;

  select * into v_row
  from world_list_attacks_in_transit()
  where movement_id = v_attack_movement_id;
  assert v_row.target_owner_home_x = v_defender_home_x, 'target_owner_home_x mismatch';
  assert v_row.target_owner_home_y = v_defender_home_y, 'target_owner_home_y mismatch';

  -- Attack on an empty (unowned) territory: target_owner_home_x/y should
  -- be null, same as target_owner_id/display_name.
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
    v_empty_target_id,
    now() + interval '2 hours',
    'in_transit'
  )
  returning id into v_attack_movement_id;

  select * into v_row
  from world_list_attacks_in_transit()
  where movement_id = v_attack_movement_id;
  assert v_row.target_owner_home_x is null, 'empty-target attack should have null target_owner_home_x';
  assert v_row.target_owner_home_y is null, 'empty-target attack should have null target_owner_home_y';
end;
$$;

rollback;
