-- Daily reward + level-up cards — manual SQL verification checklist
--
-- NOT part of the applied migration. Paste these into the Supabase SQL
-- editor *after* 0013_level_up_cards.sql has been applied, to sanity-check
-- the new active daily reward and per-level unit-card grants in a scratch/dev
-- project only.

-- ---------------------------------------------------------------------
-- 1. A multi-level XP award grants one unit card per crossed level, with
--    level 10 using uncommon instead of common.
-- ---------------------------------------------------------------------
do $$
declare
  v_before_common integer;
  v_before_uncommon integer;
  v_after_common integer;
  v_after_uncommon integer;
begin
  assert auth.uid() is not null, 'Authenticate as a real test player first';

  update players
  set xp = 2800
  where id = auth.uid();

  select count(*) into v_before_common
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = auth.uid()
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_before_uncommon
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = auth.uid()
    and ct.category = 'unit'
    and ct.rank = 'uncommon';

  perform _award_xp(auth.uid(), 3800);

  select count(*) into v_after_common
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = auth.uid()
    and ct.category = 'unit'
    and ct.rank = 'common';

  select count(*) into v_after_uncommon
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.owner_id = auth.uid()
    and ct.category = 'unit'
    and ct.rank = 'uncommon';

  assert xp_level((select xp from players where id = auth.uid())) = 12,
    'Expected the simulated award to end at level 12';
  assert v_after_common = v_before_common + 3,
    format('Expected +3 common unit cards, before=%s after=%s', v_before_common, v_after_common);
  assert v_after_uncommon = v_before_uncommon + 1,
    format('Expected +1 uncommon unit card, before=%s after=%s', v_before_uncommon, v_after_uncommon);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. claim_daily_reward() grants once per day, gives the weekly bonus on a
--    7-day streak, and a second same-day claim raises the friendly error.
-- ---------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  assert auth.uid() is not null, 'Authenticate as a real test player first';

  update players
  set daily_reward_streak = 6,
      last_daily_reward_at = date_trunc('day', now()) - interval '1 day'
  where id = auth.uid();

  v_result := claim_daily_reward();

  assert (v_result->>'streak')::integer = 7,
    format('Expected streak 7, got %s', v_result->>'streak');
  assert jsonb_array_length(v_result->'granted_cards') = 2,
    format('Expected 2 granted cards on the weekly bonus, got %s', jsonb_array_length(v_result->'granted_cards'));
  assert exists (
    select 1
    from jsonb_array_elements(v_result->'granted_cards') as card
    where card->>'rank' = 'common'
  ), 'Expected a common daily card';
  assert exists (
    select 1
    from jsonb_array_elements(v_result->'granted_cards') as card
    where card->>'rank' = 'uncommon'
  ), 'Expected the weekly uncommon bonus card';

  begin
    perform claim_daily_reward();
    raise exception 'Expected second same-day claim to fail';
  exception
    when others then
      assert position('daily reward already claimed today' in sqlerrm) > 0,
        format('Expected friendly duplicate-claim error, got %s', sqlerrm);
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Missing a day resets the streak to 1 and still grants exactly one
--    common card (no backfill rewards).
-- ---------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  assert auth.uid() is not null, 'Authenticate as a real test player first';

  update players
  set daily_reward_streak = 19,
      last_daily_reward_at = date_trunc('day', now()) - interval '5 days'
  where id = auth.uid();

  v_result := claim_daily_reward();

  assert (v_result->>'streak')::integer = 1,
    format('Expected reset streak 1 after the gap, got %s', v_result->>'streak');
  assert jsonb_array_length(v_result->'granted_cards') = 1,
    format('Expected exactly 1 granted card after the gap, got %s', jsonb_array_length(v_result->'granted_cards'));
  assert (v_result->'granted_cards'->0->>'rank') = 'common',
    format('Expected the reset-day card to be common, got %s', v_result->'granted_cards'->0->>'rank');
end;
$$;
