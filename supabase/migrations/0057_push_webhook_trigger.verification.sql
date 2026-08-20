-- 0057_push_webhook_trigger.verification.sql
--
-- Safe verification: runs in a transaction and finishes with ROLLBACK, so
-- `net.http_post`'s queued request is never actually sent (pg_net only
-- dispatches after the enclosing transaction commits).

begin;

do $$
declare
  v_player_id uuid;
  v_notification_id bigint;
  v_queue_count_before bigint;
  v_queue_count_after bigint;
begin
  -- No config row yet in this transaction's snapshot (table starts empty)
  -- -> trigger must no-op without raising.
  select id into v_player_id from players limit 1;
  assert found, 'expected at least one player row to exist for this test';

  insert into notifications (player_id, type, payload)
  values (v_player_id, 'level_up', jsonb_build_object('new_level', 2, 'verification', '0057-noop'))
  returning id into v_notification_id;

  assert v_notification_id is not null, 'expected a notification row to be created even with no webhook config';

  -- Now insert a config row (only visible inside this transaction) and
  -- confirm the trigger queues a pg_net request this time.
  insert into push_webhook_config (id, url, secret)
  values (true, 'https://example.invalid/api/push/send', 'verification-secret');

  select count(*) into v_queue_count_before from net.http_request_queue;

  insert into notifications (player_id, type, payload)
  values (v_player_id, 'level_up', jsonb_build_object('new_level', 3, 'verification', '0057-with-config'));

  select count(*) into v_queue_count_after from net.http_request_queue;

  assert v_queue_count_after = v_queue_count_before + 1,
    'expected exactly one new pg_net request to be queued once a webhook config row exists';
end;
$$;

rollback;

select 'VERIFICATION OK' as result;
