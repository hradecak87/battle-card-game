-- 0029_card_limit_deposit.verification.sql
--
-- Safe-to-run live verification for the card-limit/deposit helpers and RPCs.
-- Runs entirely inside a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_player_id uuid;
  v_home_territory_id integer;
  v_common_template_id text;
  v_rare_template_id text;
  v_original_log_count integer;
  v_base_deck_count integer;
  v_base_deposit_count integer;
  v_needed_limit integer;
  v_target_level integer;
  v_fill_stationed integer;
  v_fill_deposit integer;
  v_overflow_card uuid;
  v_common_return uuid;
  v_rare_return uuid;
  v_withdraw_ok uuid;
  v_withdraw_blocked uuid;
  v_expired_from_cards uuid;
  v_expired_from_profile uuid;
  v_after_log_count integer;
  v_deck_limit integer;
  v_deposit_limit integer;
  v_deposit_row record;
  v_profile_count integer;
  v_dummy integer;
begin
  assert to_regprocedure('_level_for_xp(integer)') is not null, 'missing _level_for_xp(integer)';
  assert to_regprocedure('_deck_limit(integer)') is not null, 'missing _deck_limit(integer)';
  assert to_regprocedure('_deposit_limit(integer)') is not null, 'missing _deposit_limit(integer)';
  assert to_regprocedure('_return_card(uuid, text)') is not null, 'missing _return_card(uuid, text)';
  assert to_regprocedure('_expire_deposit(uuid)') is not null, 'missing _expire_deposit(uuid)';
  assert to_regprocedure('_deposit_or_grant_card(uuid, uuid, text)') is not null, 'missing _deposit_or_grant_card(uuid, uuid, text)';
  assert to_regprocedure('get_my_player_profile()') is not null, 'missing get_my_player_profile()';
  assert to_regprocedure('get_my_card_instances()') is not null, 'missing get_my_card_instances()';
  assert to_regprocedure('return_card_to_pool(uuid)') is not null, 'missing return_card_to_pool(uuid)';
  assert to_regprocedure('withdraw_from_deposit(uuid)') is not null, 'missing withdraw_from_deposit(uuid)';

  assert _level_for_xp(0) = 1, 'level 1 expected at 0 xp';
  assert _level_for_xp(4500) = 10, 'level 10 expected at 4500 xp';
  assert _level_for_xp(43500) = 30, 'level 30 expected at 43500 xp';
  assert _deck_limit(1) = 100, 'deck limit level 1 should be 100';
  assert _deck_limit(10) = 280, 'deck limit level 10 should be 280';
  assert _deck_limit(30) = 680, 'deck limit level 30 should be 680';
  assert _deposit_limit(1) = 50, 'deposit limit level 1 should be 50';
  assert _deposit_limit(10) = 140, 'deposit limit level 10 should be 140';

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

  if v_player_id is null then
    select p.id, t.id
    into v_player_id, v_home_territory_id
    from players p
    join territories t on t.owner_id = p.id and t.is_home = true
    order by p.created_at
    limit 1;
  end if;

  assert v_player_id is not null, 'need at least one player with a home territory';
  perform set_config('request.jwt.claim.sub', v_player_id::text, true);

  select id into v_common_template_id
  from card_templates
  where category = 'unit' and rank = 'common'
  order by id
  limit 1;

  select id into v_rare_template_id
  from card_templates
  where category = 'unit' and rank = 'rare'
  order by id
  limit 1;

  assert v_common_template_id is not null, 'missing common unit template';
  assert v_rare_template_id is not null, 'missing rare unit template';

  select count(*) into v_original_log_count
  from card_return_log
  where player_id = v_player_id;

  select count(*) into v_base_deck_count
  from card_instances
  where owner_id = v_player_id
    and status in ('stationed', 'in_transit');

  select count(*) into v_base_deposit_count
  from card_instances
  where owner_id = v_player_id
    and status = 'deposit';

  v_needed_limit := greatest(v_base_deck_count, (v_base_deposit_count + 1) * 2, 80);
  v_target_level := greatest(1, ceil((v_needed_limit - 70) / 10.0)::integer);

  update players
  set xp = (100 * (v_target_level - 1) * v_target_level) / 2
  where id = v_player_id;

  v_deck_limit := _deck_limit(v_target_level);
  v_deposit_limit := _deposit_limit(v_target_level);
  v_fill_stationed := greatest(0, v_deck_limit - v_base_deck_count);

  if v_fill_stationed > 0 then
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    select v_common_template_id, v_player_id, v_home_territory_id, 'stationed'
    from generate_series(1, v_fill_stationed);
  end if;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_common_template_id, null, null, 'stationed')
  returning instance_id into v_overflow_card;

  perform _deposit_or_grant_card(v_player_id, v_overflow_card);

  select owner_id, stationed_territory_id, status, deposit_expires_at
  into v_deposit_row
  from card_instances
  where instance_id = v_overflow_card;

  assert v_deposit_row.owner_id = v_player_id, 'overflow card should now belong to the player';
  assert v_deposit_row.stationed_territory_id is null, 'overflow card should leave the map when deposited';
  assert v_deposit_row.status = 'deposit', 'overflow card should land in deposit';
  assert v_deposit_row.deposit_expires_at > now() + interval '2 days 23 hours', 'deposit expiry should be ~3 days in the future';

  v_fill_deposit := greatest(0, v_deposit_limit - v_base_deposit_count - 1);
  if v_fill_deposit > 0 then
    insert into card_instances (template_id, owner_id, stationed_territory_id, status, deposit_expires_at)
    select v_common_template_id, v_player_id, null, 'deposit', now() + interval '3 days'
    from generate_series(1, v_fill_deposit);
  end if;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_rare_template_id, null, null, 'stationed')
  returning instance_id into v_common_return;

  perform _deposit_or_grant_card(v_player_id, v_common_return);

  assert not exists (select 1 from card_instances where instance_id = v_common_return),
    'rare overflow card should be recycled immediately when deck and deposit are full';

  select count(*) into v_after_log_count
  from card_return_log
  where player_id = v_player_id;

  assert v_after_log_count = v_original_log_count + 1,
    format('expected exactly one new return-log row after rare overflow, before=%s after=%s', v_original_log_count, v_after_log_count);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_common_template_id, v_player_id, v_home_territory_id, 'stationed')
  returning instance_id into v_common_return;

  perform return_card_to_pool(v_common_return);
  assert not exists (select 1 from card_instances where instance_id = v_common_return),
    'manual return should delete a common card';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_rare_template_id, v_player_id, v_home_territory_id, 'stationed')
  returning instance_id into v_rare_return;

  perform return_card_to_pool(v_rare_return);
  assert not exists (select 1 from card_instances where instance_id = v_rare_return),
    'manual return should delete the rare card instance too';

  select count(*) into v_after_log_count
  from card_return_log
  where player_id = v_player_id
    and reason = 'manual_return';

  assert v_after_log_count >= 1, 'manual rare return should create a return-log row';

  update players
  set xp = (100 * (greatest(v_target_level, 30) - 1) * greatest(v_target_level, 30)) / 2
  where id = v_player_id;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status, deposit_expires_at)
  values (v_common_template_id, v_player_id, null, 'deposit', now() + interval '2 days')
  returning instance_id into v_withdraw_ok;

  perform withdraw_from_deposit(v_withdraw_ok);

  select stationed_territory_id, status, deposit_expires_at
  into v_deposit_row
  from card_instances
  where instance_id = v_withdraw_ok;

  assert v_deposit_row.stationed_territory_id = v_home_territory_id, 'withdraw should station the card at the home territory';
  assert v_deposit_row.status = 'stationed', 'withdraw should flip status back to stationed';
  assert v_deposit_row.deposit_expires_at is null, 'withdraw should clear deposit expiry';

  update players
  set xp = (100 * (v_target_level - 1) * v_target_level) / 2
  where id = v_player_id;

  select count(*) into v_dummy
  from card_instances
  where owner_id = v_player_id
    and status in ('stationed', 'in_transit');

  if v_dummy < v_deck_limit then
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    select v_common_template_id, v_player_id, v_home_territory_id, 'stationed'
    from generate_series(1, v_deck_limit - v_dummy);
  end if;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status, deposit_expires_at)
  values (v_common_template_id, v_player_id, null, 'deposit', now() + interval '2 days')
  returning instance_id into v_withdraw_blocked;

  begin
    perform withdraw_from_deposit(v_withdraw_blocked);
    raise exception 'expected withdraw_from_deposit to reject a full deck';
  exception
    when others then
      assert position('balíček je stále plný' in sqlerrm) > 0,
        format('expected full-deck withdrawal error, got %s', sqlerrm);
  end;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status, deposit_expires_at)
  values (v_rare_template_id, v_player_id, null, 'deposit', now() - interval '1 hour')
  returning instance_id into v_expired_from_cards;

  select count(*) into v_original_log_count
  from card_return_log
  where player_id = v_player_id;

  select count(*) into v_dummy
  from get_my_card_instances();

  assert not exists (select 1 from card_instances where instance_id = v_expired_from_cards),
    'get_my_card_instances() should lazily expire old deposit cards';
  assert (select count(*) from card_return_log where player_id = v_player_id) = v_original_log_count + 1,
    'lazy expiry from get_my_card_instances() should log rare returns';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status, deposit_expires_at)
  values (v_rare_template_id, v_player_id, null, 'deposit', now() - interval '1 hour')
  returning instance_id into v_expired_from_profile;

  select count(*) into v_original_log_count
  from card_return_log
  where player_id = v_player_id;

  select count(*) into v_profile_count from get_my_player_profile();
  assert v_profile_count = 1, 'get_my_player_profile() should still return exactly one row';
  assert not exists (select 1 from card_instances where instance_id = v_expired_from_profile),
    'get_my_player_profile() should lazily expire old deposit cards';
  assert (select count(*) from card_return_log where player_id = v_player_id) = v_original_log_count + 1,
    'lazy expiry from get_my_player_profile() should log rare returns';
end;
$$;

rollback;
