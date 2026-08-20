-- 0040_chat.verification.sql
--
-- Safe verification for the chat schema + RLS migration.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_player_a uuid := gen_random_uuid();
  v_player_b uuid := gen_random_uuid();
  v_player_c uuid := gen_random_uuid();
  v_global_id bigint;
  v_dm_ab_id bigint;
  v_dm_bc_id bigint;
  v_conv_ab uuid;
  v_conv_bc uuid;
  v_count integer;
begin
  assert to_regclass('chat_messages') is not null, 'missing chat_messages table';
  assert to_regclass('chat_blocks') is not null, 'missing chat_blocks table';
  assert to_regclass('chat_read_state') is not null, 'missing chat_read_state table';

  insert into players (id, display_name, nation)
  values
    (v_player_a, 'Chat A', 'england'),
    (v_player_b, 'Chat B', 'francia'),
    (v_player_c, 'Chat C', 'hre');

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);

  insert into chat_messages (sender_id, channel_type, body)
  values (v_player_a, 'global', 'Ahoj sedmim mořím')
  returning id into v_global_id;

  v_conv_ab := md5(least(v_player_a::text, v_player_b::text) || greatest(v_player_a::text, v_player_b::text))::uuid;

  insert into chat_messages (sender_id, channel_type, conversation_id, recipient_id, body)
  values (v_player_a, 'dm', v_conv_ab, v_player_b, 'Tajná zpráva A-B')
  returning id into v_dm_ab_id;

  perform set_config('request.jwt.claim.sub', v_player_b::text, true);

  v_conv_bc := md5(least(v_player_b::text, v_player_c::text) || greatest(v_player_b::text, v_player_c::text))::uuid;

  insert into chat_messages (sender_id, channel_type, conversation_id, recipient_id, body)
  values (v_player_b, 'dm', v_conv_bc, v_player_c, 'Tajná zpráva B-C')
  returning id into v_dm_bc_id;

  perform set_config('request.jwt.claim.sub', v_player_c::text, true);

  select count(*)
  into v_count
  from chat_messages
  where id = v_global_id;

  assert v_count = 1, 'global chat row should be visible to a third authenticated player';

  select count(*)
  into v_count
  from chat_messages
  where id = v_dm_ab_id;

  assert v_count = 0, 'player C must not see A/B direct messages';

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);

  select count(*)
  into v_count
  from chat_messages
  where id = v_dm_bc_id;

  assert v_count = 0, 'player A must not see B/C direct messages';

  select count(*)
  into v_count
  from chat_messages
  where id = v_dm_ab_id;

  assert v_count = 1, 'player A should see their own direct message';

  begin
    insert into chat_messages (sender_id, channel_type, conversation_id, recipient_id, body)
    values (v_player_a, 'global', gen_random_uuid(), v_player_b, 'Neplatné');
    raise exception 'expected global rows with recipient_id/conversation_id to fail';
  exception
    when check_violation then
      null;
  end;
end;
$$;

rollback;
