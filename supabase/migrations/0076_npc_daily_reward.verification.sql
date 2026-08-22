-- Verification for 0076_npc_daily_reward.sql (rollback-wrapped: run inside a
-- transaction and roll back at the end).
--
-- Covers:
-- (a) an NPC with no prior last_daily_reward_at gets one common unit card and
--     streak = 1;
-- (b) an NPC who claimed yesterday gets streak incremented and one new common
--     unit card;
-- (c) an NPC who already claimed today does not get a duplicate grant when the
--     function runs again;
-- (d) a streak hitting a multiple of 7 grants an uncommon unit card in
--     addition to the common daily card.

begin;

do $$
declare
  v_fresh_npc_id uuid := gen_random_uuid();
  v_yesterday_npc_id uuid := gen_random_uuid();
  v_today_npc_id uuid := gen_random_uuid();
  v_weekly_npc_id uuid := gen_random_uuid();
  v_today_before timestamptz := now() - interval '3 hours';
  v_fresh_common_before integer;
  v_fresh_common_after integer;
  v_yesterday_common_before integer;
  v_yesterday_common_after integer;
  v_today_common_before integer;
  v_today_common_after_first integer;
  v_today_common_after_second integer;
  v_today_uncommon_before integer;
  v_today_uncommon_after_first integer;
  v_today_uncommon_after_second integer;
  v_weekly_common_before integer;
  v_weekly_common_after integer;
  v_weekly_uncommon_before integer;
  v_weekly_uncommon_after integer;
begin
  assert to_regprocedure('resolve_due_npc_daily_rewards()') is not null,
    'missing resolve_due_npc_daily_rewards()';
  assert position(
    'perform resolve_due_npc_daily_rewards();' in pg_get_functiondef('resolve_due_movements()'::regprocedure)
  ) > 0,
    'resolve_due_movements() is not wired to call resolve_due_npc_daily_rewards()';
  assert position(
    'perform resolve_due_npc_garrison_reinforcement();' in pg_get_functiondef('resolve_due_movements()'::regprocedure)
  ) < position(
    'perform resolve_due_npc_daily_rewards();' in pg_get_functiondef('resolve_due_movements()'::regprocedure)
  ),
    'resolve_due_npc_daily_rewards() should run after resolve_due_npc_garrison_reinforcement()';
  assert position(
    'perform resolve_due_npc_daily_rewards();' in pg_get_functiondef('resolve_due_movements()'::regprocedure)
  ) < position(
    'perform resolve_due_npc_diplomacy();' in pg_get_functiondef('resolve_due_movements()'::regprocedure)
  ),
    'resolve_due_npc_daily_rewards() should run before resolve_due_npc_diplomacy()';

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_fresh_npc_id,
      'authenticated',
      'authenticated',
      'npc-daily-reward-fresh@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Fresh Reward NPC","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_yesterday_npc_id,
      'authenticated',
      'authenticated',
      'npc-daily-reward-yesterday@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Yesterday Reward NPC","nation":"francia"}'::jsonb,
      now(),
      now()
    ),
    (
      v_today_npc_id,
      'authenticated',
      'authenticated',
      'npc-daily-reward-today@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Today Reward NPC","nation":"mongol_horde"}'::jsonb,
      now(),
      now()
    ),
    (
      v_weekly_npc_id,
      'authenticated',
      'authenticated',
      'npc-daily-reward-weekly@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Weekly Reward NPC","nation":"hre"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_fresh_npc_id, 'Fresh Reward NPC Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_yesterday_npc_id, 'Yesterday Reward NPC Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_today_npc_id, 'Today Reward NPC Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_weekly_npc_id, 'Weekly Reward NPC Realm', 'lion-gold');

  update players
  set is_npc = true,
      npc_next_action_at = null,
      npc_garrison_reeval_at = now() + interval '30 days'
  where id in (v_fresh_npc_id, v_yesterday_npc_id, v_today_npc_id, v_weekly_npc_id);

  update players
  set last_daily_reward_at = now(),
      daily_reward_streak = greatest(daily_reward_streak, 1)
  where is_npc = true
    and id not in (v_fresh_npc_id, v_yesterday_npc_id, v_today_npc_id, v_weekly_npc_id)
    and (
      last_daily_reward_at is null
      or date_trunc('day', now()) > date_trunc('day', last_daily_reward_at)
    );

  update players
  set daily_reward_streak = 0,
      last_daily_reward_at = null
  where id = v_fresh_npc_id;

  update players
  set daily_reward_streak = 3,
      last_daily_reward_at = date_trunc('day', now()) - interval '1 day'
  where id = v_yesterday_npc_id;

  update players
  set daily_reward_streak = 5,
      last_daily_reward_at = v_today_before
  where id = v_today_npc_id;

  update players
  set daily_reward_streak = 6,
      last_daily_reward_at = date_trunc('day', now()) - interval '1 day'
  where id = v_weekly_npc_id;

  select count(*) into v_fresh_common_before
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_fresh_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_yesterday_common_before
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_yesterday_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_today_common_before
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_today_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_today_uncommon_before
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_today_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'uncommon';

  select count(*) into v_weekly_common_before
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_weekly_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_weekly_uncommon_before
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_weekly_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'uncommon';

  perform resolve_due_npc_daily_rewards();

  select count(*) into v_fresh_common_after
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_fresh_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_yesterday_common_after
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_yesterday_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_today_common_after_first
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_today_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_today_uncommon_after_first
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_today_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'uncommon';

  select count(*) into v_weekly_common_after
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_weekly_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_weekly_uncommon_after
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_weekly_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'uncommon';

  assert (select daily_reward_streak from players where id = v_fresh_npc_id) = 1,
    'fresh NPC should start streak at 1';
  assert v_fresh_common_after = v_fresh_common_before + 1,
    format('fresh NPC should gain 1 common unit card, before=%s after=%s', v_fresh_common_before, v_fresh_common_after);
  assert date_trunc('day', (select last_daily_reward_at from players where id = v_fresh_npc_id)) = date_trunc('day', now()),
    'fresh NPC should receive today''s timestamp';

  assert (select daily_reward_streak from players where id = v_yesterday_npc_id) = 4,
    'yesterday NPC should increment streak to 4';
  assert v_yesterday_common_after = v_yesterday_common_before + 1,
    format('yesterday NPC should gain 1 common unit card, before=%s after=%s', v_yesterday_common_before, v_yesterday_common_after);

  assert (select daily_reward_streak from players where id = v_today_npc_id) = 5,
    'today NPC should keep the same streak';
  assert (select last_daily_reward_at from players where id = v_today_npc_id) = v_today_before,
    'today NPC should keep the existing claim timestamp';
  assert v_today_common_after_first = v_today_common_before,
    format('today NPC should not gain a common card, before=%s after=%s', v_today_common_before, v_today_common_after_first);
  assert v_today_uncommon_after_first = v_today_uncommon_before,
    format('today NPC should not gain an uncommon card, before=%s after=%s', v_today_uncommon_before, v_today_uncommon_after_first);

  assert (select daily_reward_streak from players where id = v_weekly_npc_id) = 7,
    'weekly NPC should increment streak to 7';
  assert v_weekly_common_after = v_weekly_common_before + 1,
    format('weekly NPC should gain 1 common unit card, before=%s after=%s', v_weekly_common_before, v_weekly_common_after);
  assert v_weekly_uncommon_after = v_weekly_uncommon_before + 1,
    format('weekly NPC should gain 1 uncommon bonus card, before=%s after=%s', v_weekly_uncommon_before, v_weekly_uncommon_after);

  perform resolve_due_npc_daily_rewards();

  select count(*) into v_today_common_after_second
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_today_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_today_uncommon_after_second
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = v_today_npc_id
    and ci.stationed_territory_id is null
    and ci.status = 'stationed'
    and ct.category = 'unit'
    and ct.rank = 'uncommon';

  assert v_today_common_after_second = v_today_common_after_first,
    'second run should not add a duplicate common card for the already-claimed NPC';
  assert v_today_uncommon_after_second = v_today_uncommon_after_first,
    'second run should not add a duplicate uncommon card for the already-claimed NPC';
  assert (select daily_reward_streak from players where id = v_fresh_npc_id) = 1,
    'fresh NPC should not receive a second same-day streak increment';
  assert (select daily_reward_streak from players where id = v_yesterday_npc_id) = 4,
    'yesterday NPC should not receive a second same-day streak increment';
  assert (select daily_reward_streak from players where id = v_weekly_npc_id) = 7,
    'weekly NPC should not receive a second same-day streak increment';
end;
$$;

rollback;
