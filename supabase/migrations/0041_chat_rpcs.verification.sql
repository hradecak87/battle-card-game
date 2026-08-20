-- 0041_chat_rpcs.verification.sql
--
-- Safe verification for chat RPCs.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_player_a uuid := gen_random_uuid();
  v_player_b uuid := gen_random_uuid();
  v_player_c uuid := gen_random_uuid();
  v_conv_ab uuid;
  v_conv_bc uuid;
  v_msg_id_1 bigint;
  v_msg_id_2 bigint;
  v_msg_id_3 bigint;
  v_msg_id_4 bigint;
  v_msg_id_5 bigint;
  v_row chat_messages;
  v_count integer;
  v_unread bigint;
begin
  assert to_regprocedure('chat_send_message(text, uuid, text)') is not null, 'missing chat_send_message';
  assert to_regprocedure('chat_list_global_messages(bigint, integer)') is not null, 'missing chat_list_global_messages';
  assert to_regprocedure('chat_list_conversations()') is not null, 'missing chat_list_conversations';
  assert to_regprocedure('chat_list_dm_messages(uuid, bigint, integer)') is not null, 'missing chat_list_dm_messages';
  assert to_regprocedure('chat_mark_read(uuid)') is not null, 'missing chat_mark_read';
  assert to_regprocedure('chat_block_player(uuid)') is not null, 'missing chat_block_player';
  assert to_regprocedure('chat_unblock_player(uuid)') is not null, 'missing chat_unblock_player';

  insert into players (id, display_name, nation)
  values
    (v_player_a, 'Chat RPC A', 'england'),
    (v_player_b, 'Chat RPC B', 'francia'),
    (v_player_c, 'Chat RPC C', 'hre');

  v_conv_ab := chat_conversation_id(v_player_a, v_player_b);
  v_conv_bc := chat_conversation_id(v_player_b, v_player_c);
  assert v_conv_ab = chat_conversation_id(v_player_b, v_player_a), 'conversation id must be deterministic both ways';

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  v_row := chat_send_message('dm', v_player_b, 'První zpráva');
  v_msg_id_1 := v_row.id;
  assert v_row.conversation_id = v_conv_ab, 'sender -> recipient DM should use deterministic conversation id';

  begin
    perform chat_send_message('dm', v_player_b, 'Příliš brzy');
    raise exception 'expected chat rate limit to reject the rapid resend';
  exception
    when others then
      assert position('chat_rate_limit' in sqlerrm) > 0,
        format('expected rate-limit error, got %s', sqlerrm);
  end;

  update chat_messages
  set created_at = now() - interval '5 seconds'
  where id = v_msg_id_1;

  v_row := chat_send_message('dm', v_player_b, 'Druhá zpráva');
  v_msg_id_2 := v_row.id;

  update chat_messages
  set created_at = now() - interval '4 seconds'
  where id = v_msg_id_2;

  v_row := chat_send_message('global', null, 'Globální zpráva');
  v_msg_id_3 := v_row.id;

  update chat_messages
  set created_at = now() - interval '3 seconds'
  where id = v_msg_id_3;

  v_row := chat_send_message('dm', v_player_b, 'Třetí zpráva');
  v_msg_id_4 := v_row.id;

  perform set_config('request.jwt.claim.sub', v_player_b::text, true);
  v_row := chat_send_message('dm', v_player_c, 'B-C zpráva');
  v_msg_id_5 := v_row.id;
  assert v_row.conversation_id = v_conv_bc, 'B/C DM should use the correct deterministic conversation id';

  perform set_config('request.jwt.claim.sub', v_player_c::text, true);
  begin
    perform 1 from chat_list_dm_messages(v_conv_ab, null, 30);
    raise exception 'expected non-participant DM listing to fail';
  exception
    when others then
      assert position('chat_forbidden_conversation' in sqlerrm) > 0,
        format('expected forbidden-conversation error, got %s', sqlerrm);
  end;

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  select count(*)
  into v_count
  from chat_list_dm_messages(v_conv_ab, null, 2);

  assert v_count = 2, 'DM page size should honor the requested limit';

  select count(*)
  into v_count
  from chat_list_dm_messages(v_conv_ab, v_msg_id_4, 30);

  assert v_count = 2, 'DM keyset pagination should return only older messages';

  select unread_count
  into v_unread
  from chat_list_conversations()
  where conversation_id = v_conv_ab;

  assert coalesce(v_unread, -1) = 0, 'sender should not see their own messages as unread';

  perform set_config('request.jwt.claim.sub', v_player_b::text, true);
  select unread_count
  into v_unread
  from chat_list_conversations()
  where conversation_id = v_conv_ab;

  assert coalesce(v_unread, -1) = 3, 'recipient should see all unread A/B messages before marking read';

  perform chat_mark_read(v_conv_ab);

  select unread_count
  into v_unread
  from chat_list_conversations()
  where conversation_id = v_conv_ab;

  assert coalesce(v_unread, -1) = 0, 'mark_read should reset unread count';

  update chat_messages
  set created_at = now() - interval '5 seconds'
  where id in (v_msg_id_1, v_msg_id_2, v_msg_id_3, v_msg_id_4, v_msg_id_5);

  perform chat_block_player(v_player_a);

  begin
    perform chat_send_message('dm', v_player_a, 'Blokovaná odpověď');
    raise exception 'expected blocked DM send to fail';
  exception
    when others then
      assert position('chat_blocked' in sqlerrm) > 0,
        format('expected blocked-send error, got %s', sqlerrm);
  end;

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  begin
    perform chat_send_message('dm', v_player_b, 'Stále blokováno');
    raise exception 'expected reverse-direction blocked DM send to fail';
  exception
    when others then
      assert position('chat_blocked' in sqlerrm) > 0,
        format('expected reverse blocked-send error, got %s', sqlerrm);
  end;

  perform set_config('request.jwt.claim.sub', v_player_b::text, true);
  perform chat_unblock_player(v_player_a);
  update chat_messages
  set created_at = now() - interval '5 seconds'
  where id = v_msg_id_4;

  v_row := chat_send_message('dm', v_player_a, 'Po odblokování');
  assert v_row.recipient_id = v_player_a, 'send should succeed again after unblocking';

  perform set_config('request.jwt.claim.sub', v_player_c::text, true);
  select count(*)
  into v_count
  from chat_list_global_messages(null, 100);

  assert v_count = 1, 'global chat list should expose the one non-deleted global message to third players';
end;
$$;

rollback;
