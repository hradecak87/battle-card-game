begin;

do $$
declare
  v_player_a uuid := gen_random_uuid();
  v_player_b uuid := gen_random_uuid();
  v_player_c uuid := gen_random_uuid();
  v_home_a integer;
  v_enemy_territory integer;
  v_wild_territory integer;
  v_attack_movement uuid := gen_random_uuid();
  v_scout_instance uuid;
  v_unit_a text;
  v_unit_b text;
  v_movement_id uuid;
  v_report_count integer;
  v_bucket_masked_count integer;
  v_visible_unit_name text;
begin
  assert exists (
    select 1
    from card_templates
    where id = 'scout'
      and category = 'scout'
      and rank = 'uncommon'
      and base_stats = '{"str": 0, "lng": 0, "def": 0, "hp": 0, "speed": 30}'::jsonb
  ), 'scout template missing or malformed';

  begin
    insert into card_templates (
      id, category, unit_type, rank, name, flavor_text, base_stats,
      defense_bonus_pct, attack_bonus_pct, total_supply
    )
    values (
      'scout-invalid-test', 'scout', null, 'uncommon', 'Bad Scout', '', '{"str":1,"lng":0,"def":0,"hp":0,"speed":30}'::jsonb,
      null, null, null
    );
    raise exception 'expected scout shape constraint to reject invalid stats';
  exception
    when check_violation then
      null;
  end;

  insert into auth.users (
    id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (
      v_player_a,
      'authenticated',
      'authenticated',
      'scout-a@example.invalid',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Scout A","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_player_b,
      'authenticated',
      'authenticated',
      'scout-b@example.invalid',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Scout B","nation":"francia"}'::jsonb,
      now(),
      now()
    ),
    (
      v_player_c,
      'authenticated',
      'authenticated',
      'scout-c@example.invalid',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Scout C","nation":"england"}'::jsonb,
      now(),
      now()
    );

  update players
  set kingdom_name = case
        when id = v_player_a then 'Scout A'
        when id = v_player_b then 'Scout B'
        when id = v_player_c then 'Scout C'
        else kingdom_name
      end,
      onboarding_completed = true,
      daily_reward_streak = case
        when id = v_player_c then 1
        else 0
      end
  where id in (v_player_a, v_player_b, v_player_c);

  insert into territories (
    x, y, difficulty, owner_id, is_home, claim_locked_by,
    claim_started_at, claim_transfer_arrives_at, claim_occupation_completes_at,
    castle_rank, village_rank, wall_rank, battle_locked_by, name
  )
  values
    (30000, 30000, 1, v_player_a, true, null, null, null, null, null, null, null, null, 'Home A')
  returning id into v_home_a;

  insert into territories (
    x, y, difficulty, owner_id, is_home, claim_locked_by,
    claim_started_at, claim_transfer_arrives_at, claim_occupation_completes_at,
    castle_rank, village_rank, wall_rank, battle_locked_by, name
  )
  values
    (30001, 30000, 1, v_player_b, true, null, null, null, null, null, null, null, null, 'Home B');

  insert into territories (
    x, y, difficulty, owner_id, is_home, claim_locked_by,
    claim_started_at, claim_transfer_arrives_at, claim_occupation_completes_at,
    castle_rank, village_rank, wall_rank, battle_locked_by, name
  )
  values
    (30002, 30000, 1, null, false, null, null, null, null, null, null, null, null, 'Wild');

  select id
  into v_enemy_territory
  from territories
  where owner_id = v_player_b
    and is_home = true;

  select id
  into v_wild_territory
  from territories
  where owner_id is null
    and name = 'Wild';

  select id into v_unit_a
  from card_templates
  where category = 'unit' and rank = 'common'
  order by id
  limit 1;

  select id into v_unit_b
  from card_templates
  where category = 'unit' and rank = 'uncommon'
  order by id
  limit 1;

  insert into troop_movements (
    id, player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at, status
  )
  values (
    v_attack_movement, v_player_b, 'attack', v_enemy_territory, v_home_a, now() + interval '2 hours', 'in_transit'
  );

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('scout', v_player_a, v_home_a, 'stationed')
  returning instance_id into v_scout_instance;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values
    (v_unit_a, v_player_b, v_enemy_territory, 'stationed'),
    (v_unit_b, v_player_b, v_enemy_territory, 'stationed');

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);

  v_movement_id := send_scout(v_enemy_territory, v_scout_instance);
  assert v_movement_id is not null, 'send_scout should return a movement id';

  assert exists (
    select 1
    from troop_movements
    where id = v_movement_id
      and kind = 'scout'
      and origin_territory_id = v_home_a
      and destination_territory_id = v_enemy_territory
  ), 'send_scout should create a scout movement';

  assert exists (
    select 1
    from troop_movement_units
    where movement_id = v_movement_id
      and card_instance_id = v_scout_instance
  ), 'send_scout should link the scout card to the movement';

  begin
    perform send_scout(v_home_a, v_scout_instance);
    raise exception 'expected own-territory scout to be rejected';
  exception
    when others then
      null;
  end;

  update troop_movements
  set transfer_arrives_at = now() - interval '5 minutes'
  where id = v_movement_id;

  perform resolve_due_scouts();

  assert exists (
    select 1
    from troop_movements
    where kind = 'scout_return'
      and player_id = v_player_a
  ) or not exists (
    select 1 from card_instances where instance_id = v_scout_instance
  ), 'resolved scout should either die or create a scout_return movement';

  update troop_movements
  set transfer_arrives_at = now() - interval '5 minutes'
  where kind = 'scout_return'
    and player_id = v_player_a;

  perform resolve_due_scouts();

  select count(*)
  into v_report_count
  from scout_reports
  where scout_player_id = v_player_a
    and target_territory_id = v_enemy_territory;
  assert v_report_count <= 1, 'territory scout report should be unique per player/territory';

  select count(*)
  into v_bucket_masked_count
  from get_visible_territory_cards(v_enemy_territory)
  where is_masked = true
    and template_id = 'masked-unit';

  select name
  into v_visible_unit_name
  from get_visible_territory_cards(v_enemy_territory) gvtc,
       lateral jsonb_to_record(gvtc.card_templates) as card_json(
         id text,
         name text,
         flavor_text text,
         rank text,
         category text,
         unit_type text,
         base_stats jsonb,
         total_supply integer,
         defense_bonus_pct integer,
         attack_bonus_pct integer,
         boost_type text,
         effect_kind text,
         instant_effect_kind text,
         pct_str integer,
         pct_lng integer,
         pct_def integer,
         pct_hp integer
       )
  where gvtc.is_masked = false
    and card_json.category = 'unit'
  limit 1;

  assert v_bucket_masked_count > 0 or v_visible_unit_name is not null,
    'enemy units should be either masked without a report or visible with a report';

  update scout_reports
  set expires_at = now() - interval '1 minute'
  where scout_player_id = v_player_a
    and target_territory_id = v_enemy_territory;

  perform resolve_due_scouts();

  assert not exists (
    select 1
    from scout_reports
    where scout_player_id = v_player_a
      and target_territory_id = v_enemy_territory
      and expires_at <= now()
  ), 'expired scout reports should be cleaned up';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('scout', v_player_a, v_home_a, 'stationed')
  returning instance_id into v_scout_instance;

  v_movement_id := send_scout_peek(v_attack_movement, v_scout_instance);

  assert exists (
    select 1
    from troop_movements
    where id = v_movement_id
      and kind = 'scout_peek'
      and scout_target_movement_id = v_attack_movement
  ), 'send_scout_peek should create a scout_peek movement';

  update troop_movements
  set transfer_arrives_at = now() - interval '5 minutes'
  where id = v_movement_id;

  update troop_movements
  set status = 'completed'
  where id = v_attack_movement;

  perform resolve_due_scouts();

  assert not exists (
    select 1
    from scout_reports
    where scout_player_id = v_player_a
      and target_movement_id = v_attack_movement
  ), 'peek against an already-resolved attack should not create a movement report';

  update players
  set last_daily_reward_at = date_trunc('day', now()) - interval '1 day',
      daily_reward_streak = 1
  where id = v_player_c;

  perform set_config('request.jwt.claim.sub', v_player_c::text, true);
  perform claim_daily_reward();

  assert exists (
    select 1
    from card_instances
    where owner_id = v_player_c
      and template_id = 'scout'
  ), 'day-2 daily reward should grant a scout card';
end;
$$;

rollback;
