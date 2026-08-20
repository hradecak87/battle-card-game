begin;

do $$
declare
  v_player_id uuid := gen_random_uuid();
  v_home_id integer;
  v_extra_id integer;
  v_extra_x smallint;
  v_extra_y smallint;
  v_castle_card uuid;
  v_wall_card uuid;
  v_second_castle_card uuid;
  v_row record;
  v_eff record;
  v_fn text;
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    v_player_id,
    'authenticated',
    'authenticated',
    'wall-verification@example.com',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Wall Verification","nation":"england"}'::jsonb,
    now(),
    now()
  );

  perform _complete_kingdom_onboarding_core(v_player_id, 'Wall Verifiers', 'lion-gold');

  select id into v_home_id
  from territories
  where owner_id = v_player_id
    and is_home = true;
  assert v_home_id is not null, 'expected onboarding to create a home territory';

  select id, x, y into v_extra_id, v_extra_x, v_extra_y
  from territories
  where owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and is_home = false
    and castle_rank is null
    and village_rank is null
    and wall_rank is null
  order by id
  limit 1;
  assert v_extra_id is not null, 'expected a clean extra territory';

  update territories
  set owner_id = v_player_id
  where id = v_extra_id;

  assert exists (
    select 1 from card_templates where id = 'wall-common' and category = 'wall' and defense_bonus_pct = 5 and attack_bonus_pct = 5
  ), 'wall-common template mismatch';
  assert exists (
    select 1 from card_templates where id = 'wall-uncommon' and category = 'wall' and defense_bonus_pct = 10 and attack_bonus_pct = 10
  ), 'wall-uncommon template mismatch';
  assert exists (
    select 1 from card_templates where id = 'wall-rare' and category = 'wall' and defense_bonus_pct = 17 and attack_bonus_pct = 17
  ), 'wall-rare template mismatch';
  assert exists (
    select 1 from card_templates where id = 'wall-epic' and category = 'wall' and defense_bonus_pct = 27 and attack_bonus_pct = 27
  ), 'wall-epic template mismatch';
  assert exists (
    select 1 from card_templates where id = 'wall-legend' and category = 'wall' and defense_bonus_pct = 40 and attack_bonus_pct = 40
  ), 'wall-legend template mismatch';

  select * into v_row
  from get_viewport(0::smallint, 0::smallint, 255::smallint, 255::smallint)
  where id = v_extra_id;
  assert v_row.wall_rank is null, 'get_viewport should expose wall_rank and default it to null';

  begin
    update territories
    set castle_rank = 'common', wall_rank = 'rare'
    where id = v_extra_id;
    raise exception 'expected territories_wall_exclusive_check to reject castle + wall';
  exception
    when check_violation then
      null;
  end;

  update territories
  set castle_rank = null,
      village_rank = null,
      wall_rank = 'rare'
  where id = v_extra_id;
  assert exists (
    select 1 from territories where id = v_extra_id and wall_rank = 'rare' and castle_rank is null and village_rank is null
  ), 'wall-only territory update should succeed';

  update territories
  set wall_rank = null
  where id = v_extra_id;

  perform set_config('request.jwt.claim.sub', v_player_id::text, true);

  select instance_id into v_castle_card
  from card_instances
  where owner_id = v_player_id
    and template_id = 'castle-common'
  limit 1;
  assert v_castle_card is not null, 'expected starter castle card';

  perform build_structure(v_home_id, v_castle_card);
  assert exists (
    select 1 from territories where id = v_home_id and castle_rank = 'common'
  ), 'building castle on home territory should succeed';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('wall-common', v_player_id, null, 'stationed')
  returning instance_id into v_wall_card;

  begin
    perform build_structure(v_home_id, v_wall_card);
    raise exception 'expected build_structure to reject walls on castle territory';
  exception
    when others then
      assert position('Castle or Village' in SQLERRM) > 0, 'expected castle/village exclusivity error for walls';
  end;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('wall-common', v_player_id, null, 'stationed')
  returning instance_id into v_wall_card;

  perform build_structure(v_extra_id, v_wall_card);
  assert exists (
    select 1 from territories where id = v_extra_id and wall_rank = 'common'
  ), 'building walls on a clean territory should set wall_rank';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('castle-common', v_player_id, null, 'stationed')
  returning instance_id into v_second_castle_card;

  begin
    perform build_structure(v_extra_id, v_second_castle_card);
    raise exception 'expected build_structure to reject castle on wall territory';
  exception
    when others then
      assert position('Walls' in SQLERRM) > 0, 'expected walls exclusivity error for castle/village';
  end;

  select * into v_eff
  from _compute_effective_stats(
    '{"hp":100,"str":50,"lng":40,"def":30}'::jsonb,
    'common',
    null,
    true,
    null,
    null,
    'rare'
  );
  assert v_eff.hp = 100 and v_eff.str = 59 and v_eff.lng = 47 and v_eff.def = 35,
    'wall defender effective-stats parity mismatch';

  select pg_get_functiondef('public._award_xp(uuid, integer)'::regprocedure) into v_fn;
  assert position('else ''wall''' in v_fn) > 0, '_award_xp should include wall rewards';

  select pg_get_functiondef('public._finalize_battle_base_0025(uuid, text, boolean)'::regprocedure) into v_fn;
  assert position('else ''wall''' in v_fn) > 0, '_finalize_battle_base_0025 should include wall rewards';

  select * into v_row
  from get_viewport(0::smallint, 0::smallint, 255::smallint, 255::smallint)
  where id = v_extra_id;
  assert v_row.wall_rank = 'common', 'get_viewport should return wall_rank for wall territory';

  select * into v_row
  from get_minimap_overview()
  where x = v_extra_x and y = v_extra_y;
  assert v_row.wall_rank = 'common', 'get_minimap_overview should expose wall_rank for wall territory';
end;
$$;

rollback;
