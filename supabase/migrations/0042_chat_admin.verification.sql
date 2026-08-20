-- 0042_chat_admin.verification.sql
--
-- Safe verification for chat admin RPCs.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_admin_id uuid := gen_random_uuid();
  v_player_a uuid := gen_random_uuid();
  v_player_b uuid := gen_random_uuid();
  v_conv_ab uuid;
  v_message_id bigint;
  v_count integer;
begin
  assert to_regprocedure('admin_list_chat_messages(text, integer, bigint)') is not null, 'missing admin_list_chat_messages';
  assert to_regprocedure('admin_delete_chat_message(bigint)') is not null, 'missing admin_delete_chat_message';

  insert into players (id, display_name, nation, is_admin)
  values
    (v_admin_id, 'Chat Admin', 'england', true),
    (v_player_a, 'Chat Admin A', 'francia', false),
    (v_player_b, 'Chat Admin B', 'hre', false);

  v_conv_ab := chat_conversation_id(v_player_a, v_player_b);

  insert into chat_messages (sender_id, channel_type, conversation_id, recipient_id, body)
  values (v_player_a, 'dm', v_conv_ab, v_player_b, 'Moderovat mě')
  returning id into v_message_id;

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  begin
    perform 1 from admin_list_chat_messages(null, 50, null);
    raise exception 'expected non-admin admin_list_chat_messages call to fail';
  exception
    when others then
      assert position('admin access required' in sqlerrm) > 0,
        format('expected admin rejection, got %s', sqlerrm);
  end;

  begin
    perform admin_delete_chat_message(v_message_id);
    raise exception 'expected non-admin admin_delete_chat_message call to fail';
  exception
    when others then
      assert position('admin access required' in sqlerrm) > 0,
        format('expected admin rejection, got %s', sqlerrm);
  end;

  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  select count(*)
  into v_count
  from admin_list_chat_messages('dm', 50, null)
  where id = v_message_id
    and deleted_at is null;

  assert v_count = 1, 'admin list should include the non-deleted DM row';

  perform admin_delete_chat_message(v_message_id);

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  select count(*)
  into v_count
  from chat_list_dm_messages(v_conv_ab, null, 50)
  where id = v_message_id;

  assert v_count = 0, 'soft-deleted DM rows must disappear from normal DM queries';

  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  select count(*)
  into v_count
  from admin_list_chat_messages('dm', 50, null)
  where id = v_message_id
    and deleted_at is not null
    and deleted_by = v_admin_id;

  assert v_count = 1, 'soft-deleted DM rows must remain visible to the admin audit list';
end;
$$;

rollback;
