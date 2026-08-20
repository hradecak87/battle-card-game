-- Notifications schema, RPCs, and retention helper wiring.

create table notifications (
  id bigserial primary key,
  player_id uuid not null references players(id),
  type text not null check (
    type in (
      'attack_incoming',
      'war_declared',
      'battle_resolved',
      'territory_lost',
      'trade_offer_received',
      'trade_offer_accepted',
      'trade_offer_rejected',
      'peace_offer_received',
      'level_up',
      'dm_message'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_player_created_idx
  on notifications (player_id, created_at desc);

create index notifications_player_unread_idx
  on notifications (player_id, is_read)
  where is_read = false;

create unique index notifications_dm_conversation_idx
  on notifications (player_id, type, (payload->>'conversation_id'))
  where type = 'dm_message';

alter publication supabase_realtime add table notifications;

create table push_subscriptions (
  id bigserial primary key,
  player_id uuid not null references players(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;
alter table push_subscriptions enable row level security;

create policy notifications_select_own
  on notifications
  for select
  using (player_id = auth.uid());

create policy push_subscriptions_select_own
  on push_subscriptions
  for select
  using (player_id = auth.uid());

create policy push_subscriptions_insert_own
  on push_subscriptions
  for insert
  with check (player_id = auth.uid());

create policy push_subscriptions_update_own
  on push_subscriptions
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

create policy push_subscriptions_delete_own
  on push_subscriptions
  for delete
  using (player_id = auth.uid());

create or replace function get_unread_notification_count()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
  v_count integer;
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from players where id = v_player_id) then
    raise exception 'player % not found', v_player_id;
  end if;

  select count(*)
  into v_count
  from notifications
  where player_id = v_player_id
    and is_read = false;

  return v_count;
end;
$$;

create or replace function list_notifications(
  p_limit integer default 20,
  p_before_id bigint default null
)
returns setof notifications
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

  return query
  select *
  from notifications
  where player_id = v_player_id
    and (p_before_id is null or id < p_before_id)
  order by id desc
  limit p_limit;
end;
$$;

create or replace function mark_notification_read(p_id bigint)
returns void
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

  update notifications
  set is_read = true
  where id = p_id
    and player_id = v_player_id;
end;
$$;

create or replace function mark_all_notifications_read()
returns void
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

  update notifications
  set is_read = true
  where player_id = v_player_id
    and is_read = false;
end;
$$;

create or replace function _notify(
  p_player_id uuid,
  p_type text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_type = 'dm_message' then
    insert into notifications (player_id, type, payload)
    values (p_player_id, p_type, coalesce(p_payload, '{}'::jsonb))
    on conflict (player_id, type, (payload->>'conversation_id'))
      where type = 'dm_message'
    do update
      set created_at = now(),
          is_read = false,
          payload = excluded.payload;
  else
    insert into notifications (player_id, type, payload)
    values (p_player_id, p_type, coalesce(p_payload, '{}'::jsonb));
  end if;
end;
$$;

create or replace function resolve_due_movements()
returns void
language plpgsql
security definer
as $$
declare
  arrival record;
  battle_id uuid;
  claim_movement_id uuid;
  target_owner uuid;
  target_claim_locked_by uuid;
  target_is_home boolean;
  target_owner_is_npc boolean;
  target_claim_is_npc boolean;
  arrival_card_instance_ids uuid[];
  occupation_hrs numeric;
  effective_count integer;
  v_completed_claim record;
  v_recall record;
begin
  perform resolve_due_npc_actions();
  perform resolve_due_npc_diplomacy();

  update card_instances ci
  set stationed_territory_id = tm.destination_territory_id,
      status = 'stationed'
  from troop_movements tm
  where tm.status = 'in_transit'
    and tm.transfer_arrives_at <= now()
    and tm.kind = 'attack'
    and ci.instance_id in (
      select tmu.card_instance_id from troop_movement_units tmu
      where tmu.movement_id = tm.id
    );

  for arrival in
    update troop_movements
    set status = 'completed'
    where status = 'in_transit'
      and transfer_arrives_at <= now()
      and kind = 'attack'
    returning id, player_id, origin_territory_id, destination_territory_id
  loop
    select owner_id, claim_locked_by, is_home
    into target_owner, target_claim_locked_by, target_is_home
    from territories
    where id = arrival.destination_territory_id
    for update;

    select is_npc into target_owner_is_npc
    from players
    where id = target_owner;

    select is_npc into target_claim_is_npc
    from players
    where id = target_claim_locked_by;

    if target_owner is not null and target_owner <> arrival.player_id then
      if coalesce(target_owner_is_npc, false) then
        insert into battles
          (
            territory_id,
            attacker_id,
            defender_id,
            is_home_target,
            movement_id,
            status,
            ready_deadline,
            round_deadline
          )
        values
          (
            arrival.destination_territory_id,
            arrival.player_id,
            target_owner,
            target_is_home,
            arrival.id,
            'active',
            now() + interval '24 hours',
            now()
          )
        returning id into battle_id;
      else
        insert into battles
          (territory_id, attacker_id, defender_id, is_home_target, movement_id, status, ready_deadline)
        values
          (
            arrival.destination_territory_id,
            arrival.player_id,
            target_owner,
            target_is_home,
            arrival.id,
            'awaiting_ready',
            now() + interval '24 hours'
          )
        returning id into battle_id;
      end if;

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      if coalesce(target_owner_is_npc, false) then
        perform _start_next_round(battle_id);
      end if;

      for v_recall in
        select id from troop_movements
        where kind = 'transfer'
          and status = 'in_transit'
          and destination_territory_id = arrival.destination_territory_id
          and player_id = target_owner
      loop
        perform _recall_movement_to_origin(v_recall.id);
      end loop;
    elsif target_owner is null
      and target_claim_locked_by is not null
      and target_claim_locked_by <> arrival.player_id then
      if coalesce(target_claim_is_npc, false) then
        insert into battles
          (
            territory_id,
            attacker_id,
            defender_id,
            is_home_target,
            movement_id,
            status,
            ready_deadline,
            round_deadline
          )
        values
          (
            arrival.destination_territory_id,
            arrival.player_id,
            target_claim_locked_by,
            false,
            arrival.id,
            'active',
            now() + interval '24 hours',
            now()
          )
        returning id into battle_id;
      else
        insert into battles
          (territory_id, attacker_id, defender_id, is_home_target, movement_id, status, ready_deadline)
        values
          (
            arrival.destination_territory_id,
            arrival.player_id,
            target_claim_locked_by,
            false,
            arrival.id,
            'awaiting_ready',
            now() + interval '24 hours'
          )
        returning id into battle_id;
      end if;

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      if coalesce(target_claim_is_npc, false) then
        perform _start_next_round(battle_id);
      end if;

      for v_recall in
        select id from troop_movements
        where kind = 'transfer'
          and status = 'in_transit'
          and destination_territory_id = arrival.destination_territory_id
          and player_id = target_claim_locked_by
      loop
        perform _recall_movement_to_origin(v_recall.id);
      end loop;
    elsif target_owner is null
      and target_claim_locked_by is null
      and exists (
        select 1
        from card_instances ci
        join card_templates ct on ct.id = ci.template_id
        where ci.stationed_territory_id = arrival.destination_territory_id
          and ci.owner_id is null
          and ct.category = 'unit'
      ) then
      insert into battles
        (
          territory_id,
          attacker_id,
          defender_id,
          is_home_target,
          movement_id,
          status,
          ready_deadline,
          round_deadline
        )
      values
        (
          arrival.destination_territory_id,
          arrival.player_id,
          null,
          target_is_home,
          arrival.id,
          'active',
          now() + interval '24 hours',
          now()
        )
      returning id into battle_id;

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      perform _start_next_round(battle_id);
    else
      select array_agg(tmu.card_instance_id order by tmu.card_instance_id)
      into arrival_card_instance_ids
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      select count(*) into effective_count
      from territories
      where owner_id = arrival.player_id or claim_locked_by = arrival.player_id;
      if effective_count >= 32 then
        raise exception 'territory ownership cap (32) reached';
      end if;

      occupation_hrs := _claim_occupation_hours(
        arrival.player_id,
        arrival.destination_territory_id,
        arrival_card_instance_ids
      );

      update territories
      set claim_locked_by = arrival.player_id,
          claim_started_at = now(),
          claim_transfer_arrives_at = now(),
          claim_occupation_completes_at = now() + (occupation_hrs || ' hours')::interval,
          battle_locked_by = null
      where id = arrival.destination_territory_id;

      insert into troop_movements
        (
          player_id,
          kind,
          origin_territory_id,
          destination_territory_id,
          transfer_arrives_at,
          status
        )
      values
        (
          arrival.player_id,
          'claim',
          arrival.origin_territory_id,
          arrival.destination_territory_id,
          now(),
          'occupying'
        )
      returning id into claim_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id)
      select claim_movement_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;
    end if;
  end loop;

  update card_instances ci
  set stationed_territory_id = tm.destination_territory_id,
      status = 'stationed'
  from troop_movements tm
  where tm.status = 'in_transit'
    and tm.transfer_arrives_at <= now()
    and ci.instance_id in (
      select tmu.card_instance_id from troop_movement_units tmu
      where tmu.movement_id = tm.id
    );

  update troop_movements
  set status = 'completed'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'transfer';

  update troop_movements
  set status = 'occupying'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'claim';

  for v_completed_claim in
    update territories
    set owner_id = claim_locked_by,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null
    where claim_occupation_completes_at <= now()
      and claim_locked_by is not null
    returning id, x, y, owner_id
  loop
    perform _award_xp(v_completed_claim.owner_id, 15);

    update troop_movements
    set status = 'completed'
    where kind = 'claim'
      and status = 'occupying'
      and destination_territory_id = v_completed_claim.id;

    insert into world_events (event_type, payload)
    select
      'territory_claimed',
      jsonb_build_object(
        'player_id', p.id,
        'player_display_name', p.display_name,
        'player_home_x', home.x::integer,
        'player_home_y', home.y::integer,
        'territory_id', v_completed_claim.id,
        'territory_x', v_completed_claim.x::integer,
        'territory_y', v_completed_claim.y::integer
      )
    from players p
    left join territories home
      on home.owner_id = p.id
     and home.is_home = true
    where p.id = v_completed_claim.owner_id;
  end loop;

  delete from notifications
  where created_at < now() - interval '30 days';
end;
$$;

revoke execute on function _notify(uuid, text, jsonb) from public, anon, authenticated;

revoke execute on function get_unread_notification_count() from public, anon;
revoke execute on function list_notifications(integer, bigint) from public, anon;
revoke execute on function mark_notification_read(bigint) from public, anon;
revoke execute on function mark_all_notifications_read() from public, anon;

grant execute on function get_unread_notification_count() to authenticated;
grant execute on function list_notifications(integer, bigint) to authenticated;
grant execute on function mark_notification_read(bigint) to authenticated;
grant execute on function mark_all_notifications_read() to authenticated;
