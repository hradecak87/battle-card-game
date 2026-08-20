begin;

do $$
declare
  v_attacker_id uuid := gen_random_uuid();
  v_defender_id uuid := gen_random_uuid();
  v_attacker_home_id integer;
  v_defender_home_id integer;
  v_empty_target_id integer;
  v_owned_target_id integer;
  v_attack_movement_id uuid;
  v_row record;
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_attacker_id,
      'authenticated',
      'authenticated',
      'target-owner-attacker@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Target Owner Attacker","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_defender_id,
      'authenticated',
      'authenticated',
      'target-owner-defender@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Target Owner Defender","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_attacker_id, 'Target Owner Attackers', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_defender_id, 'Target Owner Defenders', 'cross-white');

  select id into v_attacker_home_id
  from territories
  where owner_id = v_attacker_id
    and is_home = true;

  select id into v_defender_home_id
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

  -- get_viewport(): tooltip owner name for both an owned tile and the
  -- caller's own tile (no name expected for the caller's own).
  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);

  select * into v_row
  from get_viewport(0::smallint, 0::smallint, 255::smallint, 255::smallint)
  where id = v_defender_home_id;
  assert v_row.owner_display_name = 'Target Owner Defender', 'get_viewport should join owner display_name';

  select * into v_row
  from get_viewport(0::smallint, 0::smallint, 255::smallint, 255::smallint)
  where id = v_attacker_home_id;
  assert v_row.owner_display_name = 'Target Owner Attacker', 'get_viewport should join the caller''s own display_name too';

  -- world_list_attacks_in_transit(): target owner columns, both populated
  -- (attack on an owned territory) and null (attack/peaceful claim on an
  -- empty territory).
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
  assert v_row.target_owner_id = v_defender_id, 'attack RPC target_owner_id mismatch';
  assert v_row.target_owner_display_name = 'Target Owner Defender', 'attack RPC target_owner_display_name mismatch';
  assert v_row.target_owner_is_npc = false, 'attack RPC target_owner_is_npc mismatch';

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
  assert v_row.target_owner_id is null, 'empty-target attack should have null target_owner_id';
  assert v_row.target_owner_display_name is null, 'empty-target attack should have null target_owner_display_name';
  assert v_row.target_owner_is_npc = false, 'empty-target attack target_owner_is_npc should default false';
end;
$$;

rollback;
