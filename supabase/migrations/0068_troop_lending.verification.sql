begin;

do $$
declare
  v_lender_id uuid := gen_random_uuid();
  v_borrower_id uuid := gen_random_uuid();
  v_outsider_id uuid := gen_random_uuid();
  v_coalition_id uuid := gen_random_uuid();
  v_free_territories integer[];
  v_unit_template_id text;
  v_origin_territory_id integer;
  v_destination_territory_id integer;
  v_lender_alt_home_id integer;
  v_outsider_territory_id integer;
  v_wild_territory_id integer;
  v_card_1 uuid := gen_random_uuid();
  v_card_2 uuid := gen_random_uuid();
  v_card_3 uuid := gen_random_uuid();
  v_card_4 uuid := gen_random_uuid();
  v_card_5 uuid := gen_random_uuid();
  v_card_6 uuid := gen_random_uuid();
  v_card_7 uuid := gen_random_uuid();
  v_card_8 uuid := gen_random_uuid();
  v_borrowed_card uuid := gen_random_uuid();
  v_wild_defender_card uuid := gen_random_uuid();
  v_dummy_attack_id uuid := gen_random_uuid();
  v_dummy_battle_movement_id uuid := gen_random_uuid();
  v_wild_battle_id uuid := gen_random_uuid();
  v_wild_battle_movement_id uuid := gen_random_uuid();
  v_loan_movement_id uuid;
  v_return_movement_id uuid;
  v_count integer;
  v_before_count integer;
  v_current_lender_home integer;
  v_now text;
  v_strong_unit_template_id text;
begin
  assert to_regprocedure('lend_troops(integer,uuid[],numeric)') is not null,
    'missing lend_troops(integer,uuid[],numeric)';
  assert to_regprocedure('_recall_loan_core(uuid,uuid)') is not null,
    'missing _recall_loan_core(uuid,uuid)';
  assert to_regprocedure('recall_loan(uuid)') is not null,
    'missing recall_loan(uuid)';
  assert to_regprocedure('get_my_loans()') is not null,
    'missing get_my_loans()';

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_lender_id,
      'authenticated',
      'authenticated',
      'troop-lending-lender@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Lender","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_borrower_id,
      'authenticated',
      'authenticated',
      'troop-lending-borrower@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Borrower","nation":"francia"}'::jsonb,
      now(),
      now()
    ),
    (
      v_outsider_id,
      'authenticated',
      'authenticated',
      'troop-lending-outsider@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Outsider","nation":"scandinavia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_lender_id, 'Lender Kingdom', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_borrower_id, 'Borrower Kingdom', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_outsider_id, 'Outsider Kingdom', 'lion-gold');

  insert into coalitions (id, name, leader_id)
  values (v_coalition_id, 'Loan Test Coalition', v_lender_id);

  insert into coalition_members (coalition_id, player_id)
  values
    (v_coalition_id, v_lender_id),
    (v_coalition_id, v_borrower_id);

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
    limit 5
  ) free_tiles;

  assert coalesce(array_length(v_free_territories, 1), 0) = 5,
    'need five free territories for 0068 verification';

  v_origin_territory_id := v_free_territories[1];
  v_destination_territory_id := v_free_territories[2];
  v_lender_alt_home_id := v_free_territories[3];
  v_outsider_territory_id := v_free_territories[4];
  v_wild_territory_id := v_free_territories[5];

  update territories
  set owner_id = v_lender_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id in (v_origin_territory_id, v_lender_alt_home_id);

  update territories
  set owner_id = v_borrower_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_destination_territory_id;

  update territories
  set owner_id = v_outsider_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_outsider_territory_id;

  select id into v_unit_template_id
  from card_templates
  where category = 'unit'
  order by
    (
      coalesce((base_stats ->> 'str')::numeric, 0)
      + coalesce((base_stats ->> 'lng')::numeric, 0)
      + coalesce((base_stats ->> 'def')::numeric, 0)
      + coalesce((base_stats ->> 'hp')::numeric, 0)
    ) asc,
    id
  limit 1;

  assert v_unit_template_id is not null, 'need a unit template for 0068 verification';

  select id into v_strong_unit_template_id
  from card_templates
  where category = 'unit'
  order by
    (
      coalesce((base_stats ->> 'str')::numeric, 0)
      + coalesce((base_stats ->> 'lng')::numeric, 0)
      + coalesce((base_stats ->> 'def')::numeric, 0)
      + coalesce((base_stats ->> 'hp')::numeric, 0)
    ) desc,
    id
  limit 1;

  assert v_strong_unit_template_id is not null, 'need a strong unit template for 0068 verification';

  insert into card_instances (instance_id, template_id, owner_id, stationed_territory_id, status)
  values
    (v_card_1, v_unit_template_id, v_lender_id, v_origin_territory_id, 'stationed'),
    (v_card_2, v_unit_template_id, v_lender_id, v_origin_territory_id, 'stationed'),
    (v_card_3, v_unit_template_id, v_lender_id, v_origin_territory_id, 'stationed'),
    (v_card_4, v_unit_template_id, v_lender_id, v_origin_territory_id, 'stationed'),
    (v_card_5, v_unit_template_id, v_lender_id, v_origin_territory_id, 'stationed'),
    (v_card_6, v_unit_template_id, v_lender_id, v_origin_territory_id, 'stationed'),
    (v_card_7, v_unit_template_id, v_lender_id, v_origin_territory_id, 'stationed'),
    (v_card_8, v_unit_template_id, v_lender_id, v_origin_territory_id, 'stationed'),
    (v_borrowed_card, v_unit_template_id, v_borrower_id, v_destination_territory_id, 'stationed');

  update card_instances
  set loaned_from_id = v_lender_id,
      loan_return_at = now() + interval '1 day'
  where instance_id = v_borrowed_card;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);

  begin
    perform lend_troops(v_outsider_territory_id, array[v_card_1], 24);
    raise exception 'expected non-coalition destination to fail';
  exception
    when others then
      assert position('coalition ally' in SQLERRM) > 0,
        'non-coalition destination should be rejected';
  end;

  begin
    perform lend_troops(v_destination_territory_id, array[v_card_1], 400);
    raise exception 'expected out-of-range duration to fail';
  exception
    when others then
      assert position('between 0 and 336' in SQLERRM) > 0,
        'out-of-range duration should be rejected';
  end;

  perform set_config('request.jwt.claim.sub', v_borrower_id::text, true);

  begin
    perform lend_troops(v_origin_territory_id, array[v_borrowed_card], 12);
    raise exception 'expected re-lending a borrowed card to fail';
  exception
    when others then
      assert position('eligible to lend' in SQLERRM) > 0,
        'already-borrowed cards should not be lendable';
  end;

  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);

  execute 'reset role';

  insert into troop_movements (id, player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at, status)
  values (v_dummy_battle_movement_id, v_outsider_id, 'attack', v_outsider_territory_id, v_destination_territory_id, now() + interval '1 hour', 'in_transit');

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
    v_destination_territory_id,
    v_outsider_id,
    v_borrower_id,
    false,
    v_dummy_battle_movement_id,
    'active',
    now() + interval '1 hour'
  );

  begin
    perform lend_troops(v_destination_territory_id, array[v_card_1], 24);
    raise exception 'expected active battle block to fail';
  exception
    when others then
      assert position('unresolved battle' in SQLERRM) > 0,
        'active battle should block lending';
  end;

  delete from battles where movement_id = v_dummy_battle_movement_id;
  delete from troop_movements where id = v_dummy_battle_movement_id;

  execute 'reset role';

  insert into troop_movements (id, player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at, status)
  values (v_dummy_attack_id, v_outsider_id, 'attack', v_outsider_territory_id, v_destination_territory_id, now() + interval '1 hour', 'in_transit');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);

  perform lend_troops(v_destination_territory_id, array[v_card_1], 24);
  execute 'reset role';

  select tm.id
  into v_loan_movement_id
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_1
    and tm.kind = 'loan'
    and tm.status = 'in_transit'
  order by tm.started_at desc
  limit 1;

  assert v_loan_movement_id is not null, 'successful lend_troops should create a loan movement';

  update troop_movements
  set transfer_arrives_at = now() - interval '1 minute'
  where id = v_loan_movement_id;

  perform resolve_due_movements();

  assert exists (
    select 1
    from card_instances
    where instance_id = v_card_1
      and owner_id = v_borrower_id
      and loaned_from_id = v_lender_id
      and loan_return_at is not null
  ), 'loan arrival should transfer temporary ownership to the borrower';

  select count(*) into v_count
  from notifications
  where player_id = v_borrower_id
    and type = 'loan_arrived';

  assert v_count = 1, 'loan arrival should notify the borrower';

  select id into v_current_lender_home
  from territories
  where owner_id = v_lender_id
    and is_home = true;

  -- Relocate the lender's home after the loan was sent, to prove that
  -- recall_loan targets the original loan's ORIGIN territory (v_card_1
  -- was lent from v_origin_territory_id) rather than the lender's
  -- (possibly since-relocated) home territory — see 0073.
  update territories set is_home = false where id = v_current_lender_home;
  update territories set is_home = true where id = v_lender_alt_home_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform recall_loan(v_card_1);
  execute 'reset role';

  assert exists (
    select 1
    from card_instances
    where instance_id = v_card_1
      and owner_id = v_lender_id
      and status = 'in_transit'
      and loaned_from_id is null
      and loan_return_at is null
  ), 'recall_loan should revert ownership immediately and clear loan metadata';

  select tm.id
  into v_return_movement_id
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_1
    and tm.kind = 'loan_return'
  order by tm.started_at desc
  limit 1;

  assert exists (
    select 1
    from troop_movements
    where id = v_return_movement_id
      and destination_territory_id = v_origin_territory_id
  ), 'recall_loan should target the territory the loan was originally sent from, not the lender''s (relocated) home';

  select count(*) into v_count
  from notifications
  where player_id = v_lender_id
    and type = 'loan_returned';

  assert v_count = 1, 'manual recall should notify the lender';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform lend_troops(v_destination_territory_id, array[v_card_2], 24);
  execute 'reset role';
  select tm.id
  into v_loan_movement_id
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_2
    and tm.kind = 'loan'
    and tm.status = 'in_transit'
  order by tm.started_at desc
  limit 1;

  update troop_movements set transfer_arrives_at = now() - interval '1 minute' where id = v_loan_movement_id;
  perform resolve_due_movements();
  update card_instances set loan_return_at = now() - interval '1 minute' where instance_id = v_card_2;
  perform resolve_due_movements();

  assert exists (
    select 1
    from troop_movements tm
    join troop_movement_units tmu on tmu.movement_id = tm.id
    where tmu.card_instance_id = v_card_2
      and tm.kind = 'loan_return'
      and tm.status = 'in_transit'
  ), 'expired loans should automatically start a loan_return movement';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform lend_troops(v_destination_territory_id, array[v_card_3], 24);
  execute 'reset role';
  select tm.id
  into v_loan_movement_id
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_3
    and tm.kind = 'loan'
    and tm.status = 'in_transit'
  order by tm.started_at desc
  limit 1;

  update troop_movements set transfer_arrives_at = now() - interval '1 minute' where id = v_loan_movement_id;
  perform resolve_due_movements();
  perform _deposit_or_grant_card(v_outsider_id, v_card_3);
  perform resolve_due_movements();

  assert exists (
    select 1
    from card_instances
    where instance_id = v_card_3
      and owner_id = v_outsider_id
      and loaned_from_id is null
      and loan_return_at is null
  ), 'captured loaned cards must clear loan metadata when ownership changes';

  select count(*) into v_count
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_3
    and tm.kind = 'loan_return';

  assert v_count = 0, 'captured loaned cards must not be auto-recalled later';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform lend_troops(v_destination_territory_id, array[v_card_8], 24);
  execute 'reset role';
  select tm.id
  into v_loan_movement_id
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_8
    and tm.kind = 'loan'
    and tm.status = 'in_transit'
  order by tm.started_at desc
  limit 1;

  update troop_movements set transfer_arrives_at = now() - interval '1 minute' where id = v_loan_movement_id;
  perform resolve_due_movements();
  update card_instances
  set loan_return_at = now() - interval '1 minute'
  where instance_id = v_card_8;

  insert into card_instances (instance_id, template_id, owner_id, stationed_territory_id, status)
  values (v_wild_defender_card, v_strong_unit_template_id, null, v_wild_territory_id, 'stationed');

  insert into troop_movements (id, player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at, status)
  values (v_wild_battle_movement_id, v_borrower_id, 'attack', v_destination_territory_id, v_wild_territory_id, now() + interval '1 hour', 'in_transit');

  insert into battles (
    id,
    territory_id,
    attacker_id,
    defender_id,
    is_home_target,
    movement_id,
    status,
    ready_deadline,
    round_deadline
  )
  values (
    v_wild_battle_id,
    v_wild_territory_id,
    v_borrower_id,
    null,
    false,
    v_wild_battle_movement_id,
    'active',
    now() + interval '1 hour',
    now() + interval '1 hour'
  );

  insert into battle_attacker_roster (battle_id, card_instance_id)
  values (v_wild_battle_id, v_card_8);

  insert into battle_rounds (battle_id, round_number, attacker_card_instance_id)
  values (v_wild_battle_id, 1, v_card_8);

  perform setseed(0.99);
  perform _resolve_round(v_wild_battle_id, v_card_8, v_wild_defender_card, false);

  assert exists (
    select 1
    from card_instances
    where instance_id = v_card_8
      and owner_id is null
      and stationed_territory_id = v_wild_territory_id
      and loaned_from_id is null
      and loan_return_at is null
  ), 'wild-defeated loaned cards must clear loan metadata when ownership becomes null';

  perform resolve_due_movements();

  select count(*) into v_count
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_8
    and tm.kind = 'loan_return';

  assert v_count = 0, 'wild-defeated loaned cards must not be auto-recalled later';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform lend_troops(v_destination_territory_id, array[v_card_4], 24);
  execute 'reset role';
  select tm.id
  into v_loan_movement_id
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_4
    and tm.kind = 'loan'
    and tm.status = 'in_transit'
  order by tm.started_at desc
  limit 1;
  update troop_movements set transfer_arrives_at = now() - interval '1 minute' where id = v_loan_movement_id;
  perform resolve_due_movements();

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform lend_troops(v_destination_territory_id, array[v_card_5], 24);
  execute 'reset role';

  select count(*) into v_before_count
  from notifications
  where type = 'loan_auto_recalled'
    and player_id in (v_lender_id, v_borrower_id);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_borrower_id::text, true);
  perform coalition_leave();
  execute 'reset role';

  assert exists (
    select 1
    from card_instances
    where instance_id = v_card_4
      and owner_id = v_lender_id
      and status = 'in_transit'
      and loaned_from_id is null
  ), 'coalition_leave should recall stationed loans between the affected pair';

  assert exists (
    select 1
    from troop_movements tm
    join troop_movement_units tmu on tmu.movement_id = tm.id
    where tmu.card_instance_id = v_card_5
      and tm.kind = 'transfer'
      and tm.destination_territory_id = v_origin_territory_id
      and tm.status = 'in_transit'
  ), 'coalition_leave should turn around outbound loan movements';

  select count(*) into v_count
  from notifications
  where type = 'loan_auto_recalled'
    and player_id in (v_lender_id, v_borrower_id);

  assert v_count = v_before_count + 4,
    'coalition_leave should notify both parties for stationed and in-transit auto recalls';

  execute 'reset role';
  insert into coalition_members (coalition_id, player_id)
  values (v_coalition_id, v_borrower_id);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform lend_troops(v_destination_territory_id, array[v_card_6], 24);
  execute 'reset role';

  select count(*) into v_before_count
  from notifications
  where type = 'loan_auto_recalled'
    and player_id in (v_lender_id, v_borrower_id);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform coalition_kick(v_borrower_id);
  execute 'reset role';

  assert exists (
    select 1
    from troop_movements tm
    join troop_movement_units tmu on tmu.movement_id = tm.id
    where tmu.card_instance_id = v_card_6
      and tm.kind = 'transfer'
      and tm.destination_territory_id = v_origin_territory_id
      and tm.status = 'in_transit'
  ), 'coalition_kick should turn around outbound loan movements';

  select count(*) into v_count
  from notifications
  where type = 'loan_auto_recalled'
    and player_id in (v_lender_id, v_borrower_id);

  assert v_count = v_before_count + 2,
    'coalition_kick should notify both parties about the forced recall';

  execute 'reset role';
  insert into coalition_members (coalition_id, player_id)
  values (v_coalition_id, v_borrower_id);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform lend_troops(v_destination_territory_id, array[v_card_7], 24);
  execute 'reset role';
  select tm.id
  into v_loan_movement_id
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_7
    and tm.kind = 'loan'
    and tm.status = 'in_transit'
  order by tm.started_at desc
  limit 1;
  update troop_movements set transfer_arrives_at = now() - interval '1 minute' where id = v_loan_movement_id;
  perform resolve_due_movements();

  select count(*) into v_before_count
  from notifications
  where type = 'loan_auto_recalled'
    and player_id in (v_lender_id, v_borrower_id);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform coalition_disband();
  execute 'reset role';

  assert exists (
    select 1
    from card_instances
    where instance_id = v_card_7
      and owner_id = v_lender_id
      and status = 'in_transit'
      and loaned_from_id is null
  ), 'coalition_disband should recall stationed loans between all members';

  assert exists (
    select 1
    from coalitions
    where id = v_coalition_id
      and disbanded_at is not null
  ), 'coalition_disband should still disband the coalition';

  select count(*) into v_count
  from notifications
  where type = 'loan_auto_recalled'
    and player_id in (v_lender_id, v_borrower_id);

  assert v_count = v_before_count + 2,
    'coalition_disband should notify both parties about the forced recall';

  raise notice 'VERIFICATION OK';
end;
$$;

rollback;
