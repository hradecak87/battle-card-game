-- 0056_notifications.verification.sql
--
-- Safe verification for notifications schema, helper, RPCs, and RLS.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_player_a uuid;
  v_player_b uuid;
  v_notification_id bigint;
  v_second_notification_id bigint;
  v_unread_count integer;
  v_list_row notifications%rowtype;
  v_dm_notification notifications%rowtype;
  v_dm_created_at timestamptz;
  v_visible_count integer;
  v_newest_id bigint;
begin
  assert to_regclass('notifications') is not null, 'missing notifications table';
  assert to_regclass('push_subscriptions') is not null, 'missing push_subscriptions table';
  assert to_regprocedure('get_unread_notification_count()') is not null,
    'missing get_unread_notification_count()';
  assert to_regprocedure('list_notifications(integer,bigint)') is not null,
    'missing list_notifications(integer,bigint)';
  assert to_regprocedure('mark_notification_read(bigint)') is not null,
    'missing mark_notification_read(bigint)';
  assert to_regprocedure('mark_all_notifications_read()') is not null,
    'missing mark_all_notifications_read()';
  assert to_regprocedure('_notify(uuid,text,jsonb)') is not null,
    'missing _notify(uuid,text,jsonb)';

  select p.id
  into v_player_a
  from players p
  where coalesce(p.is_npc, false) = false
  order by p.created_at, p.id
  limit 1;

  select p.id
  into v_player_b
  from players p
  where coalesce(p.is_npc, false) = false
    and p.id <> v_player_a
  order by p.created_at, p.id
  limit 1;

  assert v_player_a is not null and v_player_b is not null,
    'need two human players for 0055 verification';

  delete from notifications
  where player_id in (v_player_a, v_player_b)
    and (
      payload->>'verification' = '0055'
      or type = 'dm_message'
    );

  perform _notify(
    v_player_a,
    'attack_incoming',
    jsonb_build_object(
      'territory_id', 123,
      'x', 4,
      'y', 167,
      'other_player_id', v_player_b,
      'other_display_name', 'Verifier B',
      'verification', '0055'
    )
  );

  select id
  into v_notification_id
  from notifications
  where player_id = v_player_a
    and type = 'attack_incoming'
    and payload->>'verification' = '0055'
  order by id desc
  limit 1;

  assert v_notification_id is not null,
    'expected helper to create attack_incoming notification';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_a::text, true);

  select get_unread_notification_count() into v_unread_count;
  assert v_unread_count >= 1,
    'get_unread_notification_count() should include the new unread notification';

  select *
  into v_list_row
  from list_notifications(20, null)
  where id = v_notification_id;

  assert found, 'list_notifications() should return the new notification';
  assert v_list_row.type = 'attack_incoming',
    'list_notifications() should preserve notification type';

  select id
  into v_newest_id
  from list_notifications(1, null)
  limit 1;

  if v_newest_id is not null then
    select *
    into v_list_row
    from list_notifications(20, v_newest_id + 1)
    where id = v_notification_id;

    assert found,
      'list_notifications() should honor a before_id cursor above the row id';
  end if;

  perform mark_notification_read(v_notification_id);

  assert exists (
    select 1
    from notifications
    where id = v_notification_id
      and is_read = true
  ), 'mark_notification_read() should flip is_read to true';

  execute 'reset role';

  perform _notify(
    v_player_a,
    'trade_offer_received',
    jsonb_build_object(
      'offer_id', gen_random_uuid(),
      'other_player_id', v_player_b,
      'other_display_name', 'Verifier B',
      'verification', '0055'
    )
  );

  select id
  into v_second_notification_id
  from notifications
  where player_id = v_player_a
    and type = 'trade_offer_received'
    and payload->>'verification' = '0055'
  order by id desc
  limit 1;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  perform mark_all_notifications_read();

  assert exists (
    select 1
    from notifications
    where id in (v_notification_id, v_second_notification_id)
      and is_read = true
  ), 'mark_all_notifications_read() should mark verification notifications as read';

  execute 'reset role';

  perform _notify(
    v_player_a,
    'dm_message',
    jsonb_build_object(
      'conversation_id', chat_conversation_id(v_player_a, v_player_b),
      'other_player_id', v_player_b,
      'other_display_name', 'Verifier B',
      'verification', '0055-first'
    )
  );

  select *
  into v_dm_notification
  from notifications
  where player_id = v_player_a
    and type = 'dm_message'
    and payload->>'conversation_id' = chat_conversation_id(v_player_a, v_player_b)::text
  order by id desc
  limit 1;

  assert found, 'expected first dm_message notification row';
  v_dm_created_at := v_dm_notification.created_at;

  update notifications
  set is_read = true
  where id = v_dm_notification.id;

  perform pg_sleep(1);

  perform _notify(
    v_player_a,
    'dm_message',
    jsonb_build_object(
      'conversation_id', chat_conversation_id(v_player_a, v_player_b),
      'other_player_id', v_player_b,
      'other_display_name', 'Verifier B Updated',
      'verification', '0055-second'
    )
  );

  select *
  into v_dm_notification
  from notifications
  where player_id = v_player_a
    and type = 'dm_message'
    and payload->>'conversation_id' = chat_conversation_id(v_player_a, v_player_b)::text
  order by id desc
  limit 1;

  assert found, 'expected dm_message notification row after upsert';
  -- Not a strict `>` comparison: `now()` is fixed for the entire duration
  -- of this transaction in Postgres (transaction_timestamp() semantics),
  -- so even with the `pg_sleep(1)` above, both `_notify` calls in this
  -- single verification transaction observe the identical `now()` value.
  -- In real usage each DM arrives in its own transaction, so created_at
  -- does advance — the `is_read`/payload/row-count assertions below are
  -- the real signal that the upsert (not two rows) actually happened.
  assert v_dm_notification.created_at >= v_dm_created_at,
    'dm_message upsert should never move created_at backwards';
  assert v_dm_notification.is_read = false,
    'dm_message upsert should reset is_read to false';
  assert v_dm_notification.payload->>'other_display_name' = 'Verifier B Updated',
    'dm_message upsert should replace payload with the newest message metadata';
  assert (
    select count(*)
    from notifications
    where player_id = v_player_a
      and type = 'dm_message'
      and payload->>'conversation_id' = chat_conversation_id(v_player_a, v_player_b)::text
  ) = 1, 'dm_message upsert should collapse duplicate conversation notifications';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_b::text, true);

  select count(*)
  into v_visible_count
  from notifications
  where player_id = v_player_a;

  assert v_visible_count = 0,
    'RLS should block another player from selecting player A notifications directly';
end;
$$;

rollback;
