-- Verification for 0078_map_viewport_garrison_pips.sql (rollback-wrapped:
-- run inside a transaction and roll back at the end).
--
-- Covers:
-- (a) a territory with stationed unit cards of multiple ranks reports the
--     correct per-rank counts in garrison_ranks;
-- (b) a territory with zero stationed unit cards returns an empty object for
--     garrison_ranks and still includes the rest of the row shape;
-- (c) stationed structure cards do not contribute to garrison_ranks;
-- (d) cards whose status is not 'stationed' do not contribute, even if
--     they point at the territory and belong to another player.

begin;

do $$
declare
  v_player_id uuid := gen_random_uuid();
  v_other_player_id uuid := gen_random_uuid();
  v_target_territory_id integer;
  v_target_x smallint;
  v_target_y smallint;
  v_empty_territory_id integer;
  v_empty_x smallint;
  v_empty_y smallint;
  v_common_template_id text;
  v_rare_template_id text;
  v_castle_template_id text;
  v_village_template_id text;
  v_wall_template_id text;
  v_viewport jsonb;
  v_target_row jsonb;
  v_empty_row jsonb;
  v_function_def text;
begin
  assert to_regprocedure('get_viewport(smallint,smallint,smallint,smallint)') is not null,
    'missing get_viewport(smallint,smallint,smallint,smallint)';

  v_function_def := pg_get_functiondef('get_viewport(smallint,smallint,smallint,smallint)'::regprocedure);
  assert position('garrison_ranks' in v_function_def) > 0,
    'get_viewport() is missing garrison_ranks';
  assert position('jsonb_object_agg' in v_function_def) > 0,
    'get_viewport() is missing the per-rank jsonb aggregation';

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_player_id,
      'authenticated',
      'authenticated',
      'viewport-garrison-owner@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Viewport Garrison Owner","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_other_player_id,
      'authenticated',
      'authenticated',
      'viewport-garrison-other@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Viewport Garrison Other","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_player_id, 'Viewport Garrison Owner Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_other_player_id, 'Viewport Garrison Other Realm', 'lion-gold');

  select t.id, t.x, t.y
  into v_target_territory_id, v_target_x, v_target_y
  from territories t
  where t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and not t.is_home
    and not exists (
      select 1
      from card_instances ci
      where ci.stationed_territory_id = t.id
    )
  order by t.id
  limit 1;

  assert v_target_territory_id is not null,
    'need a free territory for 0078 target verification';

  select t.id, t.x, t.y
  into v_empty_territory_id, v_empty_x, v_empty_y
  from territories t
  where t.id <> v_target_territory_id
    and t.owner_id is null
    and t.claim_locked_by is null
    and t.battle_locked_by is null
    and not t.is_home
    and not exists (
      select 1
      from card_instances ci
      where ci.stationed_territory_id = t.id
    )
  order by abs(t.x - v_target_x), abs(t.y - v_target_y), t.id
  limit 1;

  assert v_empty_territory_id is not null,
    'need a second free territory for 0078 empty-row verification';

  update territories
  set owner_id = v_player_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null
  where id in (v_target_territory_id, v_empty_territory_id);

  select id
  into v_common_template_id
  from card_templates
  where category = 'unit'
    and rank = 'common'
  order by id
  limit 1;

  select id
  into v_rare_template_id
  from card_templates
  where category = 'unit'
    and rank = 'rare'
  order by id
  limit 1;

  select id
  into v_castle_template_id
  from card_templates
  where category = 'castle'
    and rank = 'common'
  order by id
  limit 1;

  select id
  into v_village_template_id
  from card_templates
  where category = 'village'
    and rank = 'common'
  order by id
  limit 1;

  select id
  into v_wall_template_id
  from card_templates
  where category = 'wall'
    and rank = 'common'
  order by id
  limit 1;

  assert v_common_template_id is not null,
    'need a common unit template';
  assert v_rare_template_id is not null,
    'need a rare unit template';
  assert v_castle_template_id is not null,
    'need a castle structure template';
  assert v_village_template_id is not null,
    'need a village structure template';
  assert v_wall_template_id is not null,
    'need a wall structure template';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values
    (v_common_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_common_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_common_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_rare_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_castle_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_village_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_wall_template_id, v_player_id, v_target_territory_id, 'stationed'),
    (v_common_template_id, v_other_player_id, v_target_territory_id, 'in_transit'),
    (v_rare_template_id, v_other_player_id, v_target_territory_id, 'in_transit');

  v_viewport := get_viewport(
    least(v_target_x, v_empty_x),
    least(v_target_y, v_empty_y),
    greatest(v_target_x, v_empty_x),
    greatest(v_target_y, v_empty_y)
  );

  select elem
  into v_target_row
  from jsonb_array_elements(v_viewport) elem
  where (elem->>'id')::integer = v_target_territory_id;

  select elem
  into v_empty_row
  from jsonb_array_elements(v_viewport) elem
  where (elem->>'id')::integer = v_empty_territory_id;

  assert v_target_row is not null,
    'target territory missing from get_viewport() result';
  assert v_empty_row is not null,
    'empty territory missing from get_viewport() result';

  assert v_target_row->'garrison_ranks' = jsonb_build_object('common', 3, 'rare', 12),
    format('expected {"common":3,"rare":12}, got %s', coalesce(v_target_row->'garrison_ranks', 'null'::jsonb));

  assert v_empty_row->'garrison_ranks' = '{}'::jsonb,
    format('expected empty garrison_ranks object, got %s', coalesce(v_empty_row->'garrison_ranks', 'null'::jsonb));
  assert (v_empty_row->>'id')::integer = v_empty_territory_id,
    'empty-row id changed unexpectedly';
  assert (v_empty_row->>'x')::smallint = v_empty_x and (v_empty_row->>'y')::smallint = v_empty_y,
    'empty-row coordinates changed unexpectedly';
  assert (v_empty_row ? 'difficulty'),
    'empty-row lost the difficulty field';
end
$$;

rollback;
