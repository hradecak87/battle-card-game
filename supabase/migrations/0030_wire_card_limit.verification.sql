-- 0030_wire_card_limit.verification.sql
--
-- Safe-to-run live verification for the rewired card-grant call sites.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_player_id uuid;
  v_other_player_id uuid;
  v_home_territory_id integer;
  v_other_home_territory_id integer;
  v_common_template_id text;
  v_offer_id uuid := gen_random_uuid();
  v_before_deposit integer;
  v_after_deposit integer;
  v_base_deck_count integer;
  v_target_level integer;
  v_limit integer;
  v_trade_card_1 uuid;
  v_trade_card_2 uuid;
  v_trade_card_3 uuid;
  v_trade_card_4 uuid;
  v_trade_p1_base integer;
  v_trade_p2_base integer;
  v_daily_result jsonb;
  v_fn text;
begin
  foreach v_fn in array array[
    'claim_daily_reward()',
    '_award_xp(uuid, integer)',
    '_trigger_instant_boost_if_needed(uuid, integer, uuid, uuid)',
    '_finalize_battle_base_0025(uuid, text, boolean)',
    '_finalize_battle(uuid, text, boolean)',
    '_resolve_round(uuid, uuid, uuid, boolean)',
    'accept_trade_offer(uuid)',
    '_complete_kingdom_onboarding_core(uuid, text, text)'
  ] loop
    assert position('_deposit_or_grant_card' in pg_get_functiondef(to_regprocedure(v_fn))) > 0,
      format('expected %s to route grants through _deposit_or_grant_card', v_fn);
  end loop;

  select p.id, t.id
  into v_player_id, v_home_territory_id
  from players p
  join territories t on t.owner_id = p.id and t.is_home = true
  where coalesce(p.is_npc, false) = false
    and not exists (
      select 1 from battles b
      where b.territory_id = t.id
        and b.status not in ('resolved', 'expired')
    )
    and t.battle_locked_by is null
  order by p.created_at
  limit 1;

  select p.id, t.id
  into v_other_player_id, v_other_home_territory_id
  from players p
  join territories t on t.owner_id = p.id and t.is_home = true
  where p.id <> v_player_id
    and coalesce(p.is_npc, false) = false
    and not exists (
      select 1 from battles b
      where b.territory_id = t.id
        and b.status not in ('resolved', 'expired')
    )
    and t.battle_locked_by is null
  order by p.created_at
  limit 1;

  assert v_player_id is not null, 'need a first player with a safe home territory';
  assert v_other_player_id is not null, 'need a second player with a safe home territory';

  select id into v_common_template_id
  from card_templates
  where category = 'unit' and rank = 'common'
  order by id
  limit 1;

  assert v_common_template_id is not null, 'missing common unit template';

  perform set_config('request.jwt.claim.sub', v_player_id::text, true);

  select count(*) into v_base_deck_count
  from card_instances
  where owner_id = v_player_id
    and status in ('stationed', 'in_transit');

  v_target_level := greatest(1, ceil((greatest(v_base_deck_count, 80) - 70) / 10.0)::integer);
  v_limit := _deck_limit(v_target_level);

  update players
  set xp = (100 * (v_target_level - 1) * v_target_level) / 2,
      daily_reward_streak = 0,
      last_daily_reward_at = now() - interval '2 days'
  where id = v_player_id;

  select count(*) into v_base_deck_count
  from card_instances
  where owner_id = v_player_id
    and status in ('stationed', 'in_transit');

  if v_base_deck_count < v_limit then
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    select v_common_template_id, v_player_id, v_home_territory_id, 'stationed'
    from generate_series(1, v_limit - v_base_deck_count);
  end if;

  select count(*) into v_before_deposit
  from card_instances
  where owner_id = v_player_id
    and status = 'deposit';

  v_daily_result := claim_daily_reward();
  assert jsonb_array_length(v_daily_result->'granted_cards') = 1, 'daily reward should still report one granted card';

  select count(*) into v_after_deposit
  from card_instances
  where owner_id = v_player_id
    and status = 'deposit';

  assert v_after_deposit = v_before_deposit + 1,
    format('expected full-deck daily reward to route to deposit, before=%s after=%s', v_before_deposit, v_after_deposit);

  update players
  set xp = (100 * 30 * 31) / 2 - 1
  where id = v_player_id;

  v_limit := _deck_limit(31);

  select count(*) into v_base_deck_count
  from card_instances
  where owner_id = v_player_id
    and status in ('stationed', 'in_transit');

  if v_base_deck_count < v_limit then
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    select v_common_template_id, v_player_id, v_home_territory_id, 'stationed'
    from generate_series(1, v_limit - v_base_deck_count);
  end if;

  select count(*) into v_before_deposit
  from card_instances
  where owner_id = v_player_id
    and status = 'deposit';

  perform _award_xp(v_player_id, 1);

  select count(*) into v_after_deposit
  from card_instances
  where owner_id = v_player_id
    and status = 'deposit';

  assert v_after_deposit >= v_before_deposit + 1,
    format('expected level-up reward to route to deposit when deck is full, before=%s after=%s', v_before_deposit, v_after_deposit);

  select count(*) into v_trade_p1_base
  from card_instances
  where owner_id = v_player_id
    and status in ('stationed', 'in_transit');

  select count(*) into v_trade_p2_base
  from card_instances
  where owner_id = v_other_player_id
    and status in ('stationed', 'in_transit');

  v_limit := v_trade_p1_base + 2;
  v_target_level := greatest(1, ceil((greatest(v_limit, 80) - 70) / 10.0)::integer);
  update players
  set xp = (100 * (v_target_level - 1) * v_target_level) / 2
  where id = v_player_id;

  update players
  set xp = 43500
  where id = v_other_player_id;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values
    (v_common_template_id, v_player_id, v_home_territory_id, 'stationed'),
    (v_common_template_id, v_player_id, v_home_territory_id, 'stationed'),
    (v_common_template_id, v_other_player_id, v_other_home_territory_id, 'stationed'),
    (v_common_template_id, v_other_player_id, v_other_home_territory_id, 'stationed');

  select instance_id into v_trade_card_1
  from card_instances
  where owner_id = v_player_id
    and stationed_territory_id = v_home_territory_id
  order by minted_at desc, instance_id desc
  limit 1;

  select instance_id into v_trade_card_2
  from card_instances
  where owner_id = v_player_id
    and stationed_territory_id = v_home_territory_id
    and instance_id <> v_trade_card_1
  order by minted_at desc, instance_id desc
  limit 1;

  select instance_id into v_trade_card_3
  from card_instances
  where owner_id = v_other_player_id
    and stationed_territory_id = v_other_home_territory_id
  order by minted_at desc, instance_id desc
  limit 1;

  select instance_id into v_trade_card_4
  from card_instances
  where owner_id = v_other_player_id
    and stationed_territory_id = v_other_home_territory_id
    and instance_id <> v_trade_card_3
  order by minted_at desc, instance_id desc
  limit 1;

  insert into trade_offers (
    id,
    type,
    status,
    initiator_id,
    target_player_id,
    root_offer_id,
    offered_card_ids,
    requested_card_ids,
    expires_at
  ) values (
    v_offer_id,
    'direct',
    'pending',
    v_player_id,
    v_other_player_id,
    v_offer_id,
    array[v_trade_card_1, v_trade_card_2],
    array[v_trade_card_3, v_trade_card_4],
    now() + interval '1 day'
  );

  perform set_config('request.jwt.claim.sub', v_other_player_id::text, true);
  perform accept_trade_offer(v_offer_id);

  assert exists (
    select 1 from card_instances
    where instance_id in (v_trade_card_1, v_trade_card_2)
      and owner_id = v_other_player_id
      and status = 'stationed'
  ), 'target player should receive the initiator cards as stationed cards';

  assert exists (
    select 1 from card_instances
    where instance_id in (v_trade_card_3, v_trade_card_4)
      and owner_id = v_player_id
      and status = 'stationed'
  ), 'initiator should receive the target cards as stationed cards';

  assert not exists (
    select 1 from card_instances
    where instance_id in (v_trade_card_1, v_trade_card_2, v_trade_card_3, v_trade_card_4)
      and status = 'deposit'
  ), 'net-zero trade swap should not push any received card into deposit';
end;
$$;

rollback;
