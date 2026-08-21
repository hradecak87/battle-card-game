-- Verification for 0071_fix_resolve_due_movements_card_xp.sql (rollback-
-- wrapped: run inside a transaction and roll back at the end).
--
-- Reproduces the exact crash: a claim whose occupation timer has already
-- elapsed must complete cleanly via resolve_due_movements() (no
-- "relation card_xp does not exist" error), and the territory must end up
-- owned by the claimant with the claim movement marked 'completed'.

begin;

do $$
declare
  v_player_id uuid := gen_random_uuid();
  v_territory_id integer;
  v_card_instance_id uuid;
  v_movement_id uuid;
  v_owner_id uuid;
  v_movement_status text;
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    v_player_id,
    'authenticated',
    'authenticated',
    'fix-card-xp-claimant@example.com',
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', 'Fix Card Xp Claimant', 'nation', 'england'),
    now(),
    now()
  );

  perform _complete_kingdom_onboarding_core(v_player_id, 'Fix Card Xp Kingdom', 'lion-gold');

  select id into v_territory_id
  from territories
  where owner_id is null and claim_locked_by is null and is_home = false
  limit 1;
  assert v_territory_id is not null, 'expected a free territory to claim';

  select instance_id into v_card_instance_id
  from card_instances
  where owner_id = v_player_id and status = 'stationed'
  limit 1;
  assert v_card_instance_id is not null, 'expected onboarded player to own a stationed card';

  update territories
  set claim_locked_by = v_player_id,
      claim_started_at = now() - interval '1 hour',
      claim_transfer_arrives_at = now() - interval '1 hour',
      claim_occupation_completes_at = now() - interval '1 minute'
  where id = v_territory_id;

  insert into troop_movements (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at, status)
  values (v_player_id, 'claim', v_territory_id, v_territory_id, now() - interval '1 hour', 'occupying')
  returning id into v_movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  values (v_movement_id, v_card_instance_id);

  -- Prior to the fix, this raised: relation "card_xp" does not exist.
  perform resolve_due_movements();

  select owner_id into v_owner_id from territories where id = v_territory_id;
  assert v_owner_id = v_player_id, 'expected claim to complete and transfer ownership';

  select status into v_movement_status from troop_movements where id = v_movement_id;
  assert v_movement_status = 'completed', 'expected claim movement to be marked completed';
end $$;

rollback;
