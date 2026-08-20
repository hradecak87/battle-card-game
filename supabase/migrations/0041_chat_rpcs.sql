-- Chat RPCs

create or replace function chat_require_player()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from players where id = v_player_id) then
    raise exception 'player % not found', v_player_id;
  end if;

  return v_player_id;
end;
$$;

create or replace function chat_conversation_id(p_player_a uuid, p_player_b uuid)
returns uuid
language sql
immutable
security definer
set search_path = public
as $$
  select md5(least(p_player_a::text, p_player_b::text) || greatest(p_player_a::text, p_player_b::text))::uuid;
$$;

create or replace function chat_validate_body(p_body text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_trimmed text := trim(coalesce(p_body, ''));
begin
  if char_length(v_trimmed) < 1 or char_length(v_trimmed) > 500 then
    raise exception 'message body must be between 1 and 500 characters';
  end if;

  return v_trimmed;
end;
$$;

create or replace function chat_send_message(
  p_channel_type text,
  p_recipient_id uuid default null,
  p_body text default null
)
returns chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid := chat_require_player();
  v_channel_type text := lower(trim(coalesce(p_channel_type, '')));
  v_body text := chat_validate_body(p_body);
  v_conversation_id uuid;
  v_row chat_messages%rowtype;
begin
  if exists (
    select 1
    from chat_messages
    where sender_id = v_sender_id
      and created_at > now() - interval '2 seconds'
  ) then
    raise exception 'chat_rate_limit';
  end if;

  if v_channel_type = 'dm' then
    if p_recipient_id is null then
      raise exception 'direct messages require a recipient';
    end if;

    if p_recipient_id = v_sender_id then
      raise exception 'cannot message yourself';
    end if;

    if not exists (select 1 from players where id = p_recipient_id) then
      raise exception 'recipient % not found', p_recipient_id;
    end if;

    if exists (
      select 1
      from chat_blocks
      where (blocker_id = v_sender_id and blocked_id = p_recipient_id)
         or (blocker_id = p_recipient_id and blocked_id = v_sender_id)
    ) then
      raise exception 'chat_blocked';
    end if;

    v_conversation_id := chat_conversation_id(v_sender_id, p_recipient_id);

    insert into chat_messages (
      sender_id,
      channel_type,
      conversation_id,
      recipient_id,
      body
    )
    values (
      v_sender_id,
      'dm',
      v_conversation_id,
      p_recipient_id,
      v_body
    )
    returning * into v_row;
  elsif v_channel_type = 'global' then
    insert into chat_messages (
      sender_id,
      channel_type,
      conversation_id,
      recipient_id,
      body
    )
    values (
      v_sender_id,
      'global',
      null,
      null,
      v_body
    )
    returning * into v_row;
  else
    raise exception 'invalid channel type: %', p_channel_type;
  end if;

  return v_row;
end;
$$;

create or replace function chat_list_global_messages(
  p_before_id bigint default null,
  p_limit int default 30
)
returns table (
  id bigint,
  sender_id uuid,
  sender_display_name text,
  channel_type text,
  conversation_id uuid,
  recipient_id uuid,
  body text,
  created_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  perform chat_require_player();

  return query
  select
    m.id,
    m.sender_id,
    p.display_name,
    m.channel_type,
    m.conversation_id,
    m.recipient_id,
    m.body,
    m.created_at,
    m.deleted_at
  from chat_messages m
  join players p on p.id = m.sender_id
  where m.channel_type = 'global'
    and m.deleted_at is null
    and (p_before_id is null or m.id < p_before_id)
  order by m.id desc
  limit v_limit;
end;
$$;

create or replace function chat_list_conversations()
returns table (
  conversation_id uuid,
  other_participant_id uuid,
  other_participant_display_name text,
  last_message_id bigint,
  last_message_sender_id uuid,
  last_message_body text,
  last_message_created_at timestamptz,
  unread_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := chat_require_player();
begin
  return query
  with visible_messages as (
    select *
    from chat_messages
    where channel_type = 'dm'
      and deleted_at is null
      and (sender_id = v_player_id or recipient_id = v_player_id)
  ),
  last_messages as (
    select distinct on (m.conversation_id)
      m.conversation_id,
      m.id,
      m.sender_id,
      m.recipient_id,
      m.body,
      m.created_at
    from visible_messages m
    order by m.conversation_id, m.id desc
  )
  select
    lm.conversation_id,
    case when lm.sender_id = v_player_id then lm.recipient_id else lm.sender_id end as other_participant_id,
    other_player.display_name as other_participant_display_name,
    lm.id as last_message_id,
    lm.sender_id as last_message_sender_id,
    lm.body as last_message_body,
    lm.created_at as last_message_created_at,
    (
      select count(*)
      from visible_messages vm
      left join chat_read_state rs
        on rs.player_id = v_player_id
       and rs.conversation_id = vm.conversation_id
      where vm.conversation_id = lm.conversation_id
        and vm.sender_id <> v_player_id
        and vm.created_at > coalesce(rs.last_read_at, '-infinity'::timestamptz)
    ) as unread_count
  from last_messages lm
  join players other_player
    on other_player.id = case when lm.sender_id = v_player_id then lm.recipient_id else lm.sender_id end
  order by lm.created_at desc, lm.id desc;
end;
$$;

create or replace function chat_list_dm_messages(
  p_conversation_id uuid,
  p_before_id bigint default null,
  p_limit int default 30
)
returns table (
  id bigint,
  sender_id uuid,
  sender_display_name text,
  channel_type text,
  conversation_id uuid,
  recipient_id uuid,
  body text,
  created_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := chat_require_player();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_exists boolean;
  v_is_participant boolean;
begin
  select exists(
    select 1
    from chat_messages
    where conversation_id = p_conversation_id
      and channel_type = 'dm'
  )
  into v_exists;

  if not v_exists then
    return;
  end if;

  select exists(
    select 1
    from chat_messages
    where conversation_id = p_conversation_id
      and channel_type = 'dm'
      and (sender_id = v_player_id or recipient_id = v_player_id)
  )
  into v_is_participant;

  if not v_is_participant then
    raise exception 'chat_forbidden_conversation';
  end if;

  return query
  select
    m.id,
    m.sender_id,
    p.display_name,
    m.channel_type,
    m.conversation_id,
    m.recipient_id,
    m.body,
    m.created_at,
    m.deleted_at
  from chat_messages m
  join players p on p.id = m.sender_id
  where m.conversation_id = p_conversation_id
    and m.channel_type = 'dm'
    and m.deleted_at is null
    and (p_before_id is null or m.id < p_before_id)
  order by m.id desc
  limit v_limit;
end;
$$;

create or replace function chat_mark_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := chat_require_player();
begin
  if exists (
    select 1
    from chat_messages
    where conversation_id = p_conversation_id
      and channel_type = 'dm'
      and not (sender_id = v_player_id or recipient_id = v_player_id)
  ) and not exists (
    select 1
    from chat_messages
    where conversation_id = p_conversation_id
      and channel_type = 'dm'
      and (sender_id = v_player_id or recipient_id = v_player_id)
  ) then
    raise exception 'chat_forbidden_conversation';
  end if;

  if not exists (
    select 1
    from chat_messages
    where conversation_id = p_conversation_id
      and channel_type = 'dm'
      and (sender_id = v_player_id or recipient_id = v_player_id)
  ) then
    return;
  end if;

  insert into chat_read_state (player_id, conversation_id, last_read_at)
  values (v_player_id, p_conversation_id, now())
  on conflict (player_id, conversation_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function chat_block_player(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := chat_require_player();
begin
  if p_target_id is null then
    raise exception 'target player is required';
  end if;

  if p_target_id = v_player_id then
    raise exception 'cannot block yourself';
  end if;

  if not exists (select 1 from players where id = p_target_id) then
    raise exception 'player % not found', p_target_id;
  end if;

  insert into chat_blocks (blocker_id, blocked_id)
  values (v_player_id, p_target_id)
  on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

create or replace function chat_unblock_player(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := chat_require_player();
begin
  if p_target_id is null then
    raise exception 'target player is required';
  end if;

  delete from chat_blocks
  where blocker_id = v_player_id
    and blocked_id = p_target_id;
end;
$$;

revoke all on function chat_require_player() from public;
revoke all on function chat_conversation_id(uuid, uuid) from public;
revoke all on function chat_validate_body(text) from public;
revoke all on function chat_send_message(text, uuid, text) from public, anon;
revoke all on function chat_list_global_messages(bigint, int) from public, anon;
revoke all on function chat_list_conversations() from public, anon;
revoke all on function chat_list_dm_messages(uuid, bigint, int) from public, anon;
revoke all on function chat_mark_read(uuid) from public, anon;
revoke all on function chat_block_player(uuid) from public, anon;
revoke all on function chat_unblock_player(uuid) from public, anon;

grant execute on function chat_send_message(text, uuid, text) to authenticated;
grant execute on function chat_list_global_messages(bigint, int) to authenticated;
grant execute on function chat_list_conversations() to authenticated;
grant execute on function chat_list_dm_messages(uuid, bigint, int) to authenticated;
grant execute on function chat_mark_read(uuid) to authenticated;
grant execute on function chat_block_player(uuid) to authenticated;
grant execute on function chat_unblock_player(uuid) to authenticated;
