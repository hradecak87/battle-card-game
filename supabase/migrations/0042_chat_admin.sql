-- Chat admin RPCs

create or replace function admin_list_chat_messages(
  p_channel_type text default null,
  p_limit int default 50,
  p_before_id bigint default null
)
returns table (
  id bigint,
  sender_id uuid,
  sender_display_name text,
  recipient_id uuid,
  recipient_display_name text,
  channel_type text,
  conversation_id uuid,
  body text,
  created_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_channel_type text := nullif(lower(trim(coalesce(p_channel_type, ''))), '');
begin
  perform admin_require_admin();

  if v_channel_type is not null and v_channel_type not in ('global', 'dm') then
    raise exception 'invalid channel type: %', p_channel_type;
  end if;

  return query
  select
    m.id,
    m.sender_id,
    sender_player.display_name,
    m.recipient_id,
    recipient_player.display_name,
    m.channel_type,
    m.conversation_id,
    m.body,
    m.created_at,
    m.deleted_at,
    m.deleted_by
  from chat_messages m
  join players sender_player on sender_player.id = m.sender_id
  left join players recipient_player on recipient_player.id = m.recipient_id
  where (v_channel_type is null or m.channel_type = v_channel_type)
    and (p_before_id is null or m.id < p_before_id)
  order by m.id desc
  limit v_limit;
end;
$$;

create or replace function admin_delete_chat_message(p_message_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := admin_require_admin();
begin
  update chat_messages
  set deleted_at = now(),
      deleted_by = v_admin_id
  where id = p_message_id
    and deleted_at is null;

  if not found then
    raise exception 'chat message % not found or already deleted', p_message_id;
  end if;
end;
$$;

revoke all on function admin_list_chat_messages(text, int, bigint) from public, anon;
revoke all on function admin_delete_chat_message(bigint) from public, anon;

grant execute on function admin_list_chat_messages(text, int, bigint) to authenticated;
grant execute on function admin_delete_chat_message(bigint) to authenticated;
