-- Verification for 0073_recall_loan_returns_to_origin.sql (rollback-
-- wrapped: run inside a transaction and roll back at the end).
--
-- Confirms `recall_loan` now sends troops back to the territory they were
-- actually lent from (not the lender's home), and falls back to the
-- lender's current home territory when that origin territory is no
-- longer owned by the lender.

begin;

do $$
declare
  v_lender_id uuid := gen_random_uuid();
  v_borrower_id uuid := gen_random_uuid();
  v_coalition_id uuid := gen_random_uuid();
  v_free_territories integer[];
  v_origin_territory_id integer;
  v_destination_territory_id integer;
  v_lost_origin_territory_id integer;
  v_unit_template_id text;
  v_card_1 uuid := gen_random_uuid();
  v_card_2 uuid := gen_random_uuid();
  v_loan_movement_id uuid;
  v_return_destination integer;
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_lender_id,
      'authenticated',
      'authenticated',
      'recall-loan-origin-lender@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Lender","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_borrower_id,
      'authenticated',
      'authenticated',
      'recall-loan-origin-borrower@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Borrower","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_lender_id, 'Recall Origin Lender Kingdom', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_borrower_id, 'Recall Origin Borrower Kingdom', 'lion-gold');

  insert into coalitions (id, name, leader_id)
  values (v_coalition_id, 'Recall Origin Test Coalition', v_lender_id);

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
        select 1 from card_instances ci where ci.stationed_territory_id = territories.id
      )
    order by id
    limit 3
  ) free_tiles;

  assert coalesce(array_length(v_free_territories, 1), 0) = 3,
    'need three free territories for 0073 verification';

  v_origin_territory_id := v_free_territories[1];
  v_destination_territory_id := v_free_territories[2];
  v_lost_origin_territory_id := v_free_territories[3];

  update territories
  set owner_id = v_lender_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id in (v_origin_territory_id, v_lost_origin_territory_id);

  update territories
  set owner_id = v_borrower_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_destination_territory_id;

  select id into v_unit_template_id
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  assert v_unit_template_id is not null, 'need a unit template for 0073 verification';

  insert into card_instances (instance_id, template_id, owner_id, stationed_territory_id, status)
  values
    (v_card_1, v_unit_template_id, v_lender_id, v_origin_territory_id, 'stationed'),
    (v_card_2, v_unit_template_id, v_lender_id, v_lost_origin_territory_id, 'stationed');

  -- Case 1: origin territory is still owned by the lender when recalled
  -- -> return there, not home.
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

  assert v_loan_movement_id is not null, 'lend_troops should create a loan movement';

  update troop_movements
  set transfer_arrives_at = now() - interval '1 minute'
  where id = v_loan_movement_id;

  perform resolve_due_movements();

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform recall_loan(v_card_1);
  execute 'reset role';

  select destination_territory_id
  into v_return_destination
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_1
    and tm.kind = 'loan_return'
  order by tm.started_at desc
  limit 1;

  assert v_return_destination = v_origin_territory_id,
    'recall_loan should return troops to the territory they were originally lent from';

  -- Case 2: origin territory (v_lost_origin_territory_id) is lost to
  -- another owner before recall -> fall back to the lender's current
  -- home territory.
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

  update troop_movements
  set transfer_arrives_at = now() - interval '1 minute'
  where id = v_loan_movement_id;

  perform resolve_due_movements();

  -- Lender loses the original origin territory to the borrower.
  update territories
  set owner_id = v_borrower_id
  where id = v_lost_origin_territory_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_lender_id::text, true);
  perform recall_loan(v_card_2);
  execute 'reset role';

  select destination_territory_id
  into v_return_destination
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tmu.card_instance_id = v_card_2
    and tm.kind = 'loan_return'
  order by tm.started_at desc
  limit 1;

  assert v_return_destination = (
    select id from territories where owner_id = v_lender_id and is_home = true
  ), 'recall_loan should fall back to the lender''s home territory when the original origin is lost';
end $$;

rollback;
