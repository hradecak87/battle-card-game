begin;

do $$
declare
  v_viewer_id uuid := gen_random_uuid();
  v_ally_id uuid := gen_random_uuid();
  v_outsider_id uuid := gen_random_uuid();
  v_coalition_id uuid := gen_random_uuid();
  v_viewer_home_id integer;
  v_ally_home_id integer;
  v_outsider_home_id integer;
  v_ally_card_instance_id uuid;
  v_outsider_card_instance_id uuid;
  v_ally_movement_id uuid := gen_random_uuid();
  v_incoming_attack_id uuid := gen_random_uuid();
  v_count integer;
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_viewer_id,
      'authenticated',
      'authenticated',
      'coalition-visibility-viewer@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Coalition Viewer","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_ally_id,
      'authenticated',
      'authenticated',
      'coalition-visibility-ally@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Coalition Ally","nation":"francia"}'::jsonb,
      now(),
      now()
    ),
    (
      v_outsider_id,
      'authenticated',
      'authenticated',
      'coalition-visibility-outsider@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Coalition Outsider","nation":"mongol_horde"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_viewer_id, 'Viewer Crown', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_ally_id, 'Ally Crown', 'cross-white');
  perform _complete_kingdom_onboarding_core(v_outsider_id, 'Outsider Horde', 'wolf-black');

  select id into v_viewer_home_id
  from territories
  where owner_id = v_viewer_id
    and is_home = true;

  select id into v_ally_home_id
  from territories
  where owner_id = v_ally_id
    and is_home = true;

  select id into v_outsider_home_id
  from territories
  where owner_id = v_outsider_id
    and is_home = true;

  select ci.instance_id into v_ally_card_instance_id
  from card_instances ci
  where ci.owner_id = v_ally_id
  order by ci.instance_id
  limit 1;

  select ci.instance_id into v_outsider_card_instance_id
  from card_instances ci
  where ci.owner_id = v_outsider_id
  order by ci.instance_id
  limit 1;

  assert v_ally_card_instance_id is not null, 'expected ally onboarding card';
  assert v_outsider_card_instance_id is not null, 'expected outsider onboarding card';

  insert into coalitions (id, name, leader_id)
  values (v_coalition_id, 'Visibility Test Coalition', v_viewer_id);

  insert into coalition_members (coalition_id, player_id)
  values
    (v_coalition_id, v_viewer_id),
    (v_coalition_id, v_ally_id);

  update card_instances
  set status = 'in_transit',
      stationed_territory_id = null
  where instance_id in (v_ally_card_instance_id, v_outsider_card_instance_id);

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
  values
    (
      v_ally_movement_id,
      v_ally_id,
      'attack',
      v_ally_home_id,
      v_outsider_home_id,
      now() - interval '20 minutes',
      now() + interval '40 minutes',
      'in_transit'
    ),
    (
      v_incoming_attack_id,
      v_outsider_id,
      'attack',
      v_outsider_home_id,
      v_ally_home_id,
      now() - interval '15 minutes',
      now() + interval '45 minutes',
      'in_transit'
    );

  insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
  values
    (v_ally_movement_id, v_ally_card_instance_id, v_ally_home_id),
    (v_incoming_attack_id, v_outsider_card_instance_id, v_outsider_home_id);

  perform set_config('request.jwt.claim.sub', v_viewer_id::text, true);

  select count(*) into v_count
  from get_coalition_movements()
  where id = v_ally_movement_id
    and player_id = v_ally_id
    and display_name = 'Coalition Ally'
    and kingdom_name = 'Ally Crown';

  assert v_count = 1, 'coalition viewer should see ally movement';

  select count(*) into v_count
  from get_incoming_attacks_on_coalition_territories()
  where movement_id = v_incoming_attack_id
    and territory_id = v_ally_home_id
    and defender_id = v_ally_id
    and defender_display_name = 'Coalition Ally'
    and attacker_id = v_outsider_id
    and attacker_kingdom_name = 'Outsider Horde';

  assert v_count = 1, 'coalition viewer should see incoming attack on ally territory';

  select count(*) into v_count
  from get_movement_cards(v_ally_movement_id);

  assert v_count = 1, 'coalition viewer should see ally movement cards';

  perform set_config('request.jwt.claim.sub', v_outsider_id::text, true);

  select count(*) into v_count
  from get_coalition_movements();

  assert v_count = 0, 'non-member should not see coalition movements';

  select count(*) into v_count
  from get_incoming_attacks_on_coalition_territories();

  assert v_count = 0, 'non-member should not see coalition incoming attacks';

  select count(*) into v_count
  from get_movement_cards(v_ally_movement_id);

  assert v_count = 0, 'non-member should not see ally movement cards';

  perform set_config('request.jwt.claim.sub', v_viewer_id::text, true);

  delete from coalition_members
  where coalition_id = v_coalition_id
    and player_id = v_ally_id;

  select count(*) into v_count
  from get_coalition_movements()
  where id = v_ally_movement_id;

  assert v_count = 0, 'ally movement visibility should stop immediately after leaving coalition';

  select count(*) into v_count
  from get_incoming_attacks_on_coalition_territories()
  where movement_id = v_incoming_attack_id;

  assert v_count = 0, 'incoming attack visibility should stop immediately after ally leaves coalition';

  select count(*) into v_count
  from get_movement_cards(v_ally_movement_id);

  assert v_count = 0, 'movement card visibility should stop immediately after ally leaves coalition';

  insert into coalition_members (coalition_id, player_id)
  values (v_coalition_id, v_ally_id);

  update coalitions
  set disbanded_at = now()
  where id = v_coalition_id;

  select count(*) into v_count
  from get_coalition_movements()
  where id = v_ally_movement_id;

  assert v_count = 0, 'ally movement visibility should stop when coalition is disbanded';

  select count(*) into v_count
  from get_incoming_attacks_on_coalition_territories()
  where movement_id = v_incoming_attack_id;

  assert v_count = 0, 'incoming attack visibility should stop when coalition is disbanded';

  select count(*) into v_count
  from get_movement_cards(v_ally_movement_id);

  assert v_count = 0, 'movement card visibility should stop when coalition is disbanded';
end;
$$;

rollback;

select 'VERIFICATION OK' as result;
