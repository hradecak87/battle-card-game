-- ---------------------------------------------------------------------------
-- 0013_level_up_cards.sql
--
-- Daily login rewards + per-level unit-card grants.
--
-- 1. Adds players.daily_reward_streak + players.last_daily_reward_at.
-- 2. Adds claim_daily_reward() for once-per-day active claims with streaks.
-- 3. Replaces _award_xp(...) so every crossed level grants a unit card while
--    preserving the existing structure-card milestone logic unchanged.
-- ---------------------------------------------------------------------------

alter table players
  add column daily_reward_streak integer not null default 0,
  add column last_daily_reward_at timestamptz;

create or replace function claim_daily_reward()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
  v_claimed_at timestamptz;
  v_today timestamptz;
  v_last_claim_at timestamptz;
  v_old_streak integer;
  v_new_streak integer;
  v_template_id text;
  v_granted_cards jsonb := '[]'::jsonb;
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  select last_daily_reward_at, daily_reward_streak
  into v_last_claim_at, v_old_streak
  from players
  where id = v_player_id
  for update;
  if not found then
    raise exception 'player % not found', v_player_id;
  end if;

  v_claimed_at := clock_timestamp();
  v_today := date_trunc('day', v_claimed_at);

  if v_last_claim_at is not null and date_trunc('day', v_last_claim_at) = v_today then
    raise exception 'daily reward already claimed today';
  end if;

  if v_last_claim_at is not null
     and date_trunc('day', v_last_claim_at) = v_today - interval '1 day' then
    v_new_streak := v_old_streak + 1;
  else
    v_new_streak := 1;
  end if;

  update players
  set daily_reward_streak = v_new_streak,
      last_daily_reward_at = v_claimed_at
  where id = v_player_id;

  select id into v_template_id
  from card_templates
  where category = 'unit' and rank = 'common'
  order by random()
  limit 1;

  if v_template_id is null then
    raise exception 'no common unit card template found';
  end if;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_player_id, null, 'stationed');

  v_granted_cards := v_granted_cards || jsonb_build_array(
    jsonb_build_object('template_id', v_template_id, 'rank', 'common')
  );

  if mod(v_new_streak, 7) = 0 then
    select id into v_template_id
    from card_templates
    where category = 'unit' and rank = 'uncommon'
    order by random()
    limit 1;

    if v_template_id is null then
      raise exception 'no uncommon unit card template found';
    end if;

    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_template_id, v_player_id, null, 'stationed');

    v_granted_cards := v_granted_cards || jsonb_build_array(
      jsonb_build_object('template_id', v_template_id, 'rank', 'uncommon')
    );
  end if;

  return jsonb_build_object(
    'streak', v_new_streak,
    'claimed_at', v_claimed_at,
    'granted_cards', v_granted_cards
  );
end;
$$;

create or replace function _award_xp(
  p_player_id uuid,
  p_amount integer
) returns void
language plpgsql
security definer
as $$
declare
  v_old_xp integer;
  v_old_level integer;
  v_new_level integer;
  v_structure_category text;
  v_level integer;
  v_unit_rank text;
  v_unit_template_id text;
begin
  if p_amount <= 0 then
    return;
  end if;

  select xp into v_old_xp
  from players
  where id = p_player_id
  for update;
  if not found then
    raise exception 'player % not found', p_player_id;
  end if;

  -- Row-lock the player so concurrent XP awards cannot race the
  -- old/new-level comparison and double-grant (or miss) a milestone card.
  v_old_level := xp_level(v_old_xp);

  update players
  set xp = xp + p_amount
  where id = p_player_id;

  v_new_level := xp_level(v_old_xp + p_amount);

  if v_new_level > v_old_level then
    for v_level in (v_old_level + 1)..v_new_level loop
      v_unit_rank := case when mod(v_level, 10) = 0 then 'uncommon' else 'common' end;

      select id into v_unit_template_id
      from card_templates
      where category = 'unit' and rank = v_unit_rank
      order by random()
      limit 1;

      if v_unit_template_id is null then
        raise exception 'no % unit card template found', v_unit_rank;
      end if;

      insert into card_instances (template_id, owner_id, stationed_territory_id, status)
      values (v_unit_template_id, p_player_id, null, 'stationed');
    end loop;
  end if;

  if floor(v_new_level::numeric / 5) > floor(v_old_level::numeric / 5) then
    v_structure_category := case when random() < 0.5 then 'castle' else 'village' end;
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_structure_category || '-common', p_player_id, null, 'stationed');
  end if;
end;
$$;
