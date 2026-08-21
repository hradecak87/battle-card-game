begin;

do $$
declare
  v_attacker_id uuid := gen_random_uuid();
  v_defender_id uuid := gen_random_uuid();
  v_attacker_home_id integer;
  v_defender_home_id integer;
  v_attacker_card_instance_id uuid;
  v_movement_id uuid := gen_random_uuid();
  v_attack_row record;
  v_visible_card_count integer;
  v_hidden_card_count integer;
  v_policy_qual text;
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_attacker_id,
      'authenticated',
      'authenticated',
      'map-movement-arrows-attacker@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Movement Arrow Attacker","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_defender_id,
      'authenticated',
      'authenticated',
      'map-movement-arrows-defender@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Movement Arrow Defender","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_attacker_id, 'Movement Arrow Attackers', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_defender_id, 'Movement Arrow Defenders', 'cross-white');

  select id into v_attacker_home_id
  from territories
  where owner_id = v_attacker_id
    and is_home = true;

  select id into v_defender_home_id
  from territories
  where owner_id = v_defender_id
    and is_home = true;

  select ci.instance_id into v_attacker_card_instance_id
  from card_instances ci
  where ci.owner_id = v_attacker_id
  order by ci.instance_id
  limit 1;

  assert v_attacker_card_instance_id is not null, 'expected onboarding to create at least one attacker card';

  update card_instances
  set status = 'in_transit',
      stationed_territory_id = null
  where instance_id = v_attacker_card_instance_id;

  insert into troop_movements (
    id,
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    started_at,
    transfer_arrives_at,
    status
  )
  values (
    v_movement_id,
    v_attacker_id,
    'attack',
    v_attacker_home_id,
    v_defender_home_id,
    now() - interval '30 minutes',
    now() + interval '90 minutes',
    'in_transit'
  );

  insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
  values (v_movement_id, v_attacker_card_instance_id, v_attacker_home_id);

  perform set_config('request.jwt.claim.sub', v_defender_id::text, true);

  select * into v_attack_row
  from get_incoming_attacks_on_my_territories()
  where movement_id = v_movement_id;

  assert v_attack_row.attacker_kingdom_name = 'Movement Arrow Attackers',
    'expected attacker_kingdom_name in incoming-attack rows';
  assert v_attack_row.started_at is not null,
    'expected started_at in incoming-attack rows';

  perform set_config('request.jwt.claim.sub', v_attacker_id::text, true);

  select count(*) into v_visible_card_count
  from get_movement_cards(v_movement_id);

  assert v_visible_card_count = 1,
    'attacker should see exactly one movement card';

  perform set_config('request.jwt.claim.sub', v_defender_id::text, true);

  select count(*) into v_hidden_card_count
  from get_movement_cards(v_movement_id);

  assert v_hidden_card_count = 0,
    'defender must not see attacker movement cards';

  select qual into v_policy_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'troop_movement_units'
    and policyname = 'troop_movement_units_select_all';

  assert v_policy_qual = 'false',
    'troop_movement_units select policy should deny direct reads';
end;
$$;

rollback;

select 'VERIFICATION OK' as result;
