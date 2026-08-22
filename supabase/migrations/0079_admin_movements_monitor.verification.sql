-- Verification for 0079_admin_movements_monitor.sql (rollback-wrapped)
-- Run inside a transaction and roll back at the end.

begin;

do $$
declare
  v_admin_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_origin_id integer;
  v_dest_id integer;
  v_movement_id uuid;
  v_rows integer;
  v_unit_count bigint;
begin
  -- -----------------------------------------------------------------------
  -- 1. Both new functions exist
  -- -----------------------------------------------------------------------
  if to_regprocedure('admin_list_movements(boolean)') is null then
    raise exception 'admin_list_movements(boolean) does not exist';
  end if;

  if to_regprocedure('admin_speed_up_movement(uuid)') is null then
    raise exception 'admin_speed_up_movement(uuid) does not exist';
  end if;

  -- -----------------------------------------------------------------------
  -- 2. debug_speed_up_movement is gone
  -- -----------------------------------------------------------------------
  if to_regprocedure('debug_speed_up_movement(uuid)') is not null then
    raise exception 'debug_speed_up_movement(uuid) still exists — should have been dropped';
  end if;

  -- -----------------------------------------------------------------------
  -- 3. Seed test auth users and players
  -- -----------------------------------------------------------------------
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_admin_id, 'authenticated', 'authenticated', 'verify-admin-079@example.com',
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"display_name":"VerifyAdmin079","nation":"england"}'::jsonb, now(), now()),
    (v_player_id, 'authenticated', 'authenticated', 'verify-player-079@example.com',
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"display_name":"VerifyPlayer079","nation":"england"}'::jsonb, now(), now());

  perform _complete_kingdom_onboarding_core(v_admin_id, 'Verify Admin Realm 079', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_player_id, 'Verify Player Realm 079', 'lion-gold');

  update players set is_admin = true where id = v_admin_id;

  -- Pick two distinct territories not owned by our test players for movement
  select id into v_origin_id from territories where owner_id = v_admin_id and is_home limit 1;
  select id into v_dest_id from territories where owner_id is null and not is_home limit 1;

  if v_origin_id is null or v_dest_id is null then
    raise exception 'Could not find suitable territories for movement test';
  end if;

  -- -----------------------------------------------------------------------
  -- 4. Insert a test movement owned by the regular player
  -- -----------------------------------------------------------------------
  insert into troop_movements (id, player_id, kind, origin_territory_id, destination_territory_id,
    transfer_arrives_at, status)
  values (
    gen_random_uuid(), v_player_id, 'transfer', v_origin_id, v_dest_id,
    now() + interval '1 hour', 'in_transit'
  )
  returning id into v_movement_id;

  -- -----------------------------------------------------------------------
  -- 5. Non-admin call is rejected
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_player_id::text)::text, true);

  begin
    perform admin_list_movements(false);
    raise exception 'admin_list_movements should have rejected non-admin caller';
  exception
    when others then
      if sqlerrm not ilike '%admin%' then
        raise;
      end if;
  end;

  -- -----------------------------------------------------------------------
  -- 6. Admin call succeeds — p_include_history = false returns in-transit row
  -- -----------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_id::text)::text, true);

  select count(*) into v_rows
  from admin_list_movements(false)
  where id = v_movement_id;

  if v_rows <> 1 then
    raise exception 'Expected 1 in-transit row, got %', v_rows;
  end if;

  -- unit_count = 0 (no units added)
  select unit_count into v_unit_count
  from admin_list_movements(false)
  where id = v_movement_id;

  if v_unit_count <> 0 then
    raise exception 'Expected unit_count = 0, got %', v_unit_count;
  end if;

  -- -----------------------------------------------------------------------
  -- 7. admin_speed_up_movement works without ownership check (admin != movement owner)
  -- -----------------------------------------------------------------------
  perform admin_speed_up_movement(v_movement_id);

  -- Movement should now have ETA <= 10s from now
  select count(*) into v_rows
  from troop_movements
  where id = v_movement_id and transfer_arrives_at <= now() + interval '11 seconds';

  if v_rows <> 1 then
    raise exception 'admin_speed_up_movement did not shrink the ETA';
  end if;

  -- -----------------------------------------------------------------------
  -- 8. p_include_history = false excludes cancelled rows
  -- -----------------------------------------------------------------------
  update troop_movements set status = 'cancelled', cancelled_at = now()
  where id = v_movement_id;

  select count(*) into v_rows
  from admin_list_movements(false)
  where id = v_movement_id;

  if v_rows <> 0 then
    raise exception 'p_include_history=false should exclude cancelled rows, got %', v_rows;
  end if;

  select count(*) into v_rows
  from admin_list_movements(true)
  where id = v_movement_id;

  if v_rows <> 1 then
    raise exception 'p_include_history=true should include cancelled rows, got %', v_rows;
  end if;

  raise notice 'All 0079 verification checks passed.';
end;
$$;

rollback;

