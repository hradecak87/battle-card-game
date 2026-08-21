-- Coalition lifecycle/read RPCs plus a shared diplomacy-declare-war core
-- used by both per-player and coalition-wide war declarations.

create or replace function coalition_lock(p_coalition_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_coalition_id::text));
end;
$$;

create or replace function _coalition_cancel_other_pending_for_player(
  p_player_id uuid,
  p_except_invite_id uuid default null,
  p_except_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update coalition_invites
  set status = 'cancelled'
  where invited_player_id = p_player_id
    and status = 'pending'
    and (p_except_invite_id is null or id <> p_except_invite_id);

  update coalition_join_requests
  set status = 'cancelled'
  where player_id = p_player_id
    and status = 'pending'
    and (p_except_request_id is null or id <> p_except_request_id);
end;
$$;

create or replace function _coalition_auto_recall_loans_between(
  p_player_a uuid,
  p_player_b uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stationed record;
  v_in_transit record;
  v_card_id uuid;
begin
  if p_player_a is null or p_player_b is null or p_player_a = p_player_b then
    return;
  end if;

  for v_stationed in
    select
      ci.loaned_from_id as lender_id,
      ci.owner_id as borrower_id,
      ci.stationed_territory_id as territory_id,
      t.x as territory_x,
      t.y as territory_y,
      t.name as territory_name,
      lender.display_name as lender_display_name,
      borrower.display_name as borrower_display_name,
      array_agg(ci.instance_id order by ci.instance_id) as card_instance_ids
    from card_instances ci
    join territories t on t.id = ci.stationed_territory_id
    left join players lender on lender.id = ci.loaned_from_id
    left join players borrower on borrower.id = ci.owner_id
    where ci.status = 'stationed'
      and ci.owner_id is not null
      and (
        (ci.loaned_from_id = p_player_a and ci.owner_id = p_player_b)
        or (ci.loaned_from_id = p_player_b and ci.owner_id = p_player_a)
      )
    group by
      ci.loaned_from_id,
      ci.owner_id,
      ci.stationed_territory_id,
      t.x,
      t.y,
      t.name,
      lender.display_name,
      borrower.display_name
  loop
    foreach v_card_id in array v_stationed.card_instance_ids
    loop
      perform _recall_loan_core(v_stationed.lender_id, v_card_id);
    end loop;

    perform _notify(
      v_stationed.lender_id,
      'loan_auto_recalled',
      jsonb_build_object(
        'territory_id', v_stationed.territory_id,
        'territory_x', v_stationed.territory_x::integer,
        'territory_y', v_stationed.territory_y::integer,
        'territory_name', v_stationed.territory_name,
        'other_player_id', v_stationed.borrower_id,
        'other_display_name', coalesce(v_stationed.borrower_display_name, 'Neznámý hráč')
      )
    );

    perform _notify(
      v_stationed.borrower_id,
      'loan_auto_recalled',
      jsonb_build_object(
        'territory_id', v_stationed.territory_id,
        'territory_x', v_stationed.territory_x::integer,
        'territory_y', v_stationed.territory_y::integer,
        'territory_name', v_stationed.territory_name,
        'other_player_id', v_stationed.lender_id,
        'other_display_name', coalesce(v_stationed.lender_display_name, 'Neznámý hráč')
      )
    );
  end loop;

  for v_in_transit in
    select
      tm.id as movement_id,
      tm.player_id as lender_id,
      dest.owner_id as borrower_id,
      dest.id as territory_id,
      dest.x as territory_x,
      dest.y as territory_y,
      dest.name as territory_name,
      lender.display_name as lender_display_name,
      borrower.display_name as borrower_display_name
    from troop_movements tm
    join territories dest on dest.id = tm.destination_territory_id
    left join players lender on lender.id = tm.player_id
    left join players borrower on borrower.id = dest.owner_id
    where tm.kind = 'loan'
      and tm.status = 'in_transit'
      and dest.owner_id is not null
      and (
        (tm.player_id = p_player_a and dest.owner_id = p_player_b)
        or (tm.player_id = p_player_b and dest.owner_id = p_player_a)
      )
    for update of tm skip locked
  loop
    perform _recall_movement_to_origin(v_in_transit.movement_id);

    perform _notify(
      v_in_transit.lender_id,
      'loan_auto_recalled',
      jsonb_build_object(
        'territory_id', v_in_transit.territory_id,
        'territory_x', v_in_transit.territory_x::integer,
        'territory_y', v_in_transit.territory_y::integer,
        'territory_name', v_in_transit.territory_name,
        'other_player_id', v_in_transit.borrower_id,
        'other_display_name', coalesce(v_in_transit.borrower_display_name, 'Neznámý hráč')
      )
    );

    perform _notify(
      v_in_transit.borrower_id,
      'loan_auto_recalled',
      jsonb_build_object(
        'territory_id', v_in_transit.territory_id,
        'territory_x', v_in_transit.territory_x::integer,
        'territory_y', v_in_transit.territory_y::integer,
        'territory_name', v_in_transit.territory_name,
        'other_player_id', v_in_transit.lender_id,
        'other_display_name', coalesce(v_in_transit.lender_display_name, 'Neznámý hráč')
      )
    );
  end loop;
end;
$$;

create or replace function _coalition_disband_core(p_coalition_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coalition coalitions%rowtype;
  v_pair record;
begin
  select *
  into v_coalition
  from coalitions
  where id = p_coalition_id
  for update;

  if not found then
    raise exception 'coalition % not found', p_coalition_id;
  end if;

  for v_pair in
    select
      a.player_id as player_a_id,
      b.player_id as player_b_id
    from coalition_members a
    join coalition_members b
      on b.coalition_id = a.coalition_id
     and a.player_id < b.player_id
    where a.coalition_id = p_coalition_id
  loop
    perform _coalition_auto_recall_loans_between(v_pair.player_a_id, v_pair.player_b_id);
  end loop;

  delete from coalition_members
  where coalition_id = p_coalition_id;

  update coalitions
  set disbanded_at = now()
  where id = p_coalition_id;

  update coalition_invites
  set status = 'cancelled'
  where coalition_id = p_coalition_id
    and status = 'pending';

  update coalition_join_requests
  set status = 'cancelled'
  where coalition_id = p_coalition_id
    and status = 'pending';

  insert into world_events (event_type, payload)
  select
    'coalition_disbanded',
    jsonb_build_object(
      'coalition_id', v_coalition.id,
      'coalition_name', v_coalition.name,
      'leader_id', leader.id,
      'leader_display_name', leader.display_name,
      'leader_home_x', home.x::integer,
      'leader_home_y', home.y::integer
    )
  from players leader
  left join territories home
    on home.owner_id = leader.id
   and home.is_home = true
  where leader.id = v_coalition.leader_id;
end;
$$;

create or replace function _diplomacy_declare_war_core(
  p_caller uuid,
  p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relation_state text;
begin
  perform diplomacy_lock_pair(p_caller, p_target_id);

  if exists (
    select 1
    from coalition_members cm_self
    join coalition_members cm_other
      on cm_other.coalition_id = cm_self.coalition_id
     and cm_other.player_id = p_target_id
    join coalitions c
      on c.id = cm_self.coalition_id
    where cm_self.player_id = p_caller
      and c.disbanded_at is null
  ) then
    raise exception 'cannot declare war on a coalition member';
  end if;

  select state
  into v_relation_state
  from diplomacy_relations
  where player_a_id = least(p_caller, p_target_id)
    and player_b_id = greatest(p_caller, p_target_id)
  for update;

  if v_relation_state = 'war' then
    raise exception 'already at war with this player';
  end if;

  if v_relation_state = 'non_aggression' then
    delete from diplomacy_relations
    where player_a_id = least(p_caller, p_target_id)
      and player_b_id = greatest(p_caller, p_target_id);

    insert into world_events (event_type, payload)
    select
      'non_aggression_broken',
      jsonb_build_object(
        'player_a_id', a.id,
        'player_a_display_name', a.display_name,
        'player_a_home_x', a_home.x::integer,
        'player_a_home_y', a_home.y::integer,
        'player_b_id', b.id,
        'player_b_display_name', b.display_name,
        'player_b_home_x', b_home.x::integer,
        'player_b_home_y', b_home.y::integer
      )
    from players a
    left join territories a_home
      on a_home.owner_id = a.id
     and a_home.is_home = true
    join players b
      on b.id = p_target_id
    left join territories b_home
      on b_home.owner_id = b.id
     and b_home.is_home = true
    where a.id = p_caller;
  end if;

  insert into diplomacy_relations (
    player_a_id,
    player_b_id,
    state,
    war_started_at
  )
  values (
    least(p_caller, p_target_id),
    greatest(p_caller, p_target_id),
    'war',
    now()
  );

  insert into world_events (event_type, payload)
  select
    'war_declared',
    jsonb_build_object(
      'attacker_id', attacker.id,
      'attacker_display_name', attacker.display_name,
      'attacker_home_x', attacker_home.x::integer,
      'attacker_home_y', attacker_home.y::integer,
      'defender_id', defender.id,
      'defender_display_name', defender.display_name,
      'defender_home_x', defender_home.x::integer,
      'defender_home_y', defender_home.y::integer
    )
  from players attacker
  left join territories attacker_home
    on attacker_home.owner_id = attacker.id
   and attacker_home.is_home = true
  join players defender
    on defender.id = p_target_id
  left join territories defender_home
    on defender_home.owner_id = defender.id
   and defender_home.is_home = true
  where attacker.id = p_caller;

  perform _notify(
    p_caller,
    'war_declared',
    (
      select jsonb_build_object(
        'other_player_id', defender.id,
        'other_display_name', defender.display_name
      )
      from players defender
      where defender.id = p_target_id
    )
  );

  perform _notify(
    p_target_id,
    'war_declared',
    (
      select jsonb_build_object(
        'other_player_id', attacker.id,
        'other_display_name', attacker.display_name
      )
      from players attacker
      where attacker.id = p_caller
    )
  );
end;
$$;

create or replace function diplomacy_declare_war(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_target_is_npc boolean;
begin
  if p_target_id = v_caller then
    raise exception 'cannot declare war on yourself';
  end if;

  select coalesce(is_npc, false)
  into v_target_is_npc
  from players
  where id = p_target_id;

  if not found then
    raise exception 'target player not found';
  end if;

  if v_target_is_npc then
    raise exception 'cannot declare war on an NPC kingdom';
  end if;

  perform _diplomacy_declare_war_core(v_caller, p_target_id);
end;
$$;

create or replace function coalition_get_mine()
returns table (
  id uuid,
  name text,
  leader_id uuid,
  leader_display_name text,
  created_at timestamptz,
  members jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
begin
  return query
  select
    c.id,
    c.name,
    c.leader_id,
    leader.display_name,
    c.created_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'player_id', member_player.id,
          'display_name', member_player.display_name,
          'joined_at', cm.joined_at,
          'is_leader', member_player.id = c.leader_id,
          'is_online', coalesce(member_player.last_seen_at >= now() - interval '2 minutes', false)
        )
        order by (member_player.id = c.leader_id) desc, cm.joined_at, member_player.display_name
      )
      from coalition_members cm
      join players member_player
        on member_player.id = cm.player_id
      where cm.coalition_id = c.id
    ), '[]'::jsonb)
  from coalition_members mine
  join coalitions c
    on c.id = mine.coalition_id
   and c.disbanded_at is null
  join players leader
    on leader.id = c.leader_id
  where mine.player_id = v_caller
  limit 1;

  if not found then
    return query
    select
      null::uuid,
      null::text,
      null::uuid,
      null::text,
      null::timestamptz,
      '[]'::jsonb;
  end if;
end;
$$;

create or replace function coalition_list()
returns table (
  id uuid,
  name text,
  leader_id uuid,
  leader_display_name text,
  member_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform diplomacy_require_player();

  return query
  select
    c.id,
    c.name,
    c.leader_id,
    leader.display_name,
    count(cm.player_id)::integer
  from coalitions c
  join players leader
    on leader.id = c.leader_id
  left join coalition_members cm
    on cm.coalition_id = c.id
  where c.disbanded_at is null
  group by c.id, c.name, c.leader_id, leader.display_name
  order by count(cm.player_id) desc, c.name asc;
end;
$$;

create or replace function coalition_list_invites()
returns table (
  id uuid,
  coalition_id uuid,
  coalition_name text,
  leader_id uuid,
  leader_display_name text,
  invited_by uuid,
  invited_by_display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
begin
  return query
  select
    ci.id,
    ci.coalition_id,
    c.name,
    c.leader_id,
    leader.display_name,
    ci.invited_by,
    inviter.display_name,
    ci.created_at
  from coalition_invites ci
  join coalitions c
    on c.id = ci.coalition_id
   and c.disbanded_at is null
  join players leader
    on leader.id = c.leader_id
  join players inviter
    on inviter.id = ci.invited_by
  where ci.invited_player_id = v_caller
    and ci.status = 'pending'
  order by ci.created_at desc, ci.id desc;
end;
$$;

create or replace function coalition_list_join_requests(p_coalition_id uuid)
returns table (
  id uuid,
  coalition_id uuid,
  player_id uuid,
  player_display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_leader_id uuid;
begin
  select leader_id
  into v_leader_id
  from coalitions c
  where c.id = p_coalition_id
    and disbanded_at is null;

  if not found then
    raise exception 'coalition % is not active', p_coalition_id;
  end if;

  if v_leader_id <> v_caller then
    raise exception 'only the coalition leader may list join requests';
  end if;

  return query
  select
    cjr.id,
    cjr.coalition_id,
    cjr.player_id,
    p.display_name,
    cjr.created_at
  from coalition_join_requests cjr
  join players p
    on p.id = cjr.player_id
  where cjr.coalition_id = p_coalition_id
    and cjr.status = 'pending'
  order by cjr.created_at desc, cjr.id desc;
end;
$$;

create or replace function coalition_create(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_coalition_id uuid := gen_random_uuid();
begin
  if exists (
    select 1
    from coalition_members
    where player_id = v_caller
  ) then
    raise exception 'you are already in a coalition';
  end if;

  if exists (
    select 1
    from coalitions
    where disbanded_at is null
      and name = p_name
  ) then
    raise exception 'coalition name is already taken';
  end if;

  insert into coalitions (id, name, leader_id)
  values (v_coalition_id, p_name, v_caller);

  insert into coalition_members (coalition_id, player_id)
  values (v_coalition_id, v_caller);

  insert into world_events (event_type, payload)
  select
    'coalition_created',
    jsonb_build_object(
      'coalition_id', v_coalition_id,
      'coalition_name', p_name,
      'leader_id', p.id,
      'leader_display_name', p.display_name,
      'leader_home_x', home.x::integer,
      'leader_home_y', home.y::integer
    )
  from players p
  left join territories home
    on home.owner_id = p.id
   and home.is_home = true
  where p.id = v_caller;

  return v_coalition_id;
end;
$$;

create or replace function coalition_invite(p_coalition_id uuid, p_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_invite_id uuid := gen_random_uuid();
  v_leader_id uuid;
  v_member_count integer;
begin
  perform coalition_lock(p_coalition_id);

  select leader_id
  into v_leader_id
  from coalitions
  where id = p_coalition_id
    and disbanded_at is null
  for update;

  if not found then
    raise exception 'coalition % is not active', p_coalition_id;
  end if;

  if v_leader_id <> v_caller then
    raise exception 'only the coalition leader may invite players';
  end if;

  select count(*)
  into v_member_count
  from coalition_members
  where coalition_id = p_coalition_id;

  if v_member_count >= 10 then
    raise exception 'coalition member cap (10) reached';
  end if;

  if exists (
    select 1
    from coalition_members
    where player_id = p_player_id
  ) then
    raise exception 'target player is already in a coalition';
  end if;

  if exists (
    select 1
    from coalition_invites
    where coalition_id = p_coalition_id
      and invited_player_id = p_player_id
      and status = 'pending'
  ) or exists (
    select 1
    from coalition_join_requests
    where coalition_id = p_coalition_id
      and player_id = p_player_id
      and status = 'pending'
  ) then
    raise exception 'target player already has a pending invite or request for this coalition';
  end if;

  insert into coalition_invites (
    id,
    coalition_id,
    invited_player_id,
    invited_by,
    status
  )
  values (
    v_invite_id,
    p_coalition_id,
    p_player_id,
    v_caller,
    'pending'
  );

  return v_invite_id;
end;
$$;

create or replace function coalition_request_join(p_coalition_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_request_id uuid := gen_random_uuid();
  v_member_count integer;
  v_member_id uuid;
begin
  if exists (
    select 1
    from coalition_members
    where player_id = v_caller
  ) then
    raise exception 'you are already in a coalition';
  end if;

  perform coalition_lock(p_coalition_id);

  if not exists (
    select 1
    from coalitions
    where id = p_coalition_id
      and disbanded_at is null
  ) then
    raise exception 'coalition % is not active', p_coalition_id;
  end if;

  select count(*)
  into v_member_count
  from coalition_members
  where coalition_id = p_coalition_id;

  if v_member_count >= 10 then
    raise exception 'coalition member cap (10) reached';
  end if;

  if exists (
    select 1
    from coalition_invites
    where coalition_id = p_coalition_id
      and invited_player_id = v_caller
      and status = 'pending'
  ) or exists (
    select 1
    from coalition_join_requests
    where coalition_id = p_coalition_id
      and player_id = v_caller
      and status = 'pending'
  ) then
    raise exception 'you already have a pending invite or request for this coalition';
  end if;

  for v_member_id in
    select player_id
    from coalition_members
    where coalition_id = p_coalition_id
    order by player_id
  loop
    if exists (
      select 1
      from diplomacy_relations
      where player_a_id = least(v_caller, v_member_id)
        and player_b_id = greatest(v_caller, v_member_id)
        and state = 'war'
    ) then
      raise exception 'you are currently at war with a member of this coalition';
    end if;
  end loop;

  insert into coalition_join_requests (
    id,
    coalition_id,
    player_id,
    status
  )
  values (
    v_request_id,
    p_coalition_id,
    v_caller,
    'pending'
  );

  return v_request_id;
end;
$$;

create or replace function coalition_accept_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_invite coalition_invites%rowtype;
  v_coalition coalitions%rowtype;
  v_member_id uuid;
  v_member_count integer;
begin
  select *
  into v_invite
  from coalition_invites
  where id = p_invite_id;

  if not found then
    raise exception 'coalition invite % not found', p_invite_id;
  end if;

  perform coalition_lock(v_invite.coalition_id);

  select *
  into v_invite
  from coalition_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'coalition invite % not found', p_invite_id;
  end if;

  if v_invite.invited_player_id <> v_caller then
    raise exception 'only the invited player may accept this coalition invite';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'coalition invite % is no longer pending', p_invite_id;
  end if;

  select *
  into v_coalition
  from coalitions
  where id = v_invite.coalition_id
    and disbanded_at is null
  for update;

  if not found then
    update coalition_invites
    set status = 'cancelled'
    where id = p_invite_id
      and status = 'pending';
    raise exception 'coalition % is not active', v_invite.coalition_id;
  end if;

  for v_member_id in
    select player_id
    from coalition_members
    where coalition_id = v_invite.coalition_id
    order by player_id
  loop
    perform diplomacy_lock_pair(v_caller, v_member_id);
  end loop;

  if exists (
    select 1
    from coalition_members
    where player_id = v_caller
  ) then
    raise exception 'you are already in a coalition';
  end if;

  select count(*)
  into v_member_count
  from coalition_members
  where coalition_id = v_invite.coalition_id;

  if v_member_count >= 10 then
    raise exception 'coalition member cap (10) reached';
  end if;

  for v_member_id in
    select player_id
    from coalition_members
    where coalition_id = v_invite.coalition_id
    order by player_id
  loop
    if exists (
      select 1
      from diplomacy_relations
      where player_a_id = least(v_caller, v_member_id)
        and player_b_id = greatest(v_caller, v_member_id)
        and state = 'war'
    ) then
      raise exception 'you are currently at war with a member of this coalition';
    end if;
  end loop;

  insert into coalition_members (coalition_id, player_id)
  values (v_invite.coalition_id, v_caller);

  update coalition_invites
  set status = 'accepted'
  where id = p_invite_id;

  perform _coalition_cancel_other_pending_for_player(v_caller, p_invite_id, null);

  delete from diplomacy_relations r
  using coalition_members cm
  where cm.coalition_id = v_invite.coalition_id
    and cm.player_id <> v_caller
    and r.state = 'non_aggression'
    and r.player_a_id = least(cm.player_id, v_caller)
    and r.player_b_id = greatest(cm.player_id, v_caller);

  insert into world_events (event_type, payload)
  select
    'coalition_member_joined',
    jsonb_build_object(
      'coalition_id', v_coalition.id,
      'coalition_name', v_coalition.name,
      'player_id', p.id,
      'player_display_name', p.display_name,
      'player_home_x', home.x::integer,
      'player_home_y', home.y::integer
    )
  from players p
  left join territories home
    on home.owner_id = p.id
   and home.is_home = true
  where p.id = v_caller;
end;
$$;

create or replace function coalition_accept_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_request coalition_join_requests%rowtype;
  v_coalition coalitions%rowtype;
  v_member_id uuid;
  v_member_count integer;
begin
  select *
  into v_request
  from coalition_join_requests
  where id = p_request_id;

  if not found then
    raise exception 'coalition join request % not found', p_request_id;
  end if;

  perform coalition_lock(v_request.coalition_id);

  select *
  into v_request
  from coalition_join_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'coalition join request % not found', p_request_id;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'coalition join request % is no longer pending', p_request_id;
  end if;

  select *
  into v_coalition
  from coalitions
  where id = v_request.coalition_id
    and disbanded_at is null
  for update;

  if not found then
    update coalition_join_requests
    set status = 'cancelled'
    where id = p_request_id
      and status = 'pending';
    raise exception 'coalition % is not active', v_request.coalition_id;
  end if;

  if v_coalition.leader_id <> v_caller then
    raise exception 'only the coalition leader may accept join requests';
  end if;

  for v_member_id in
    select player_id
    from coalition_members
    where coalition_id = v_request.coalition_id
    order by player_id
  loop
    perform diplomacy_lock_pair(v_request.player_id, v_member_id);
  end loop;

  if exists (
    select 1
    from coalition_members
    where player_id = v_request.player_id
  ) then
    raise exception 'target player is already in a coalition';
  end if;

  select count(*)
  into v_member_count
  from coalition_members
  where coalition_id = v_request.coalition_id;

  if v_member_count >= 10 then
    raise exception 'coalition member cap (10) reached';
  end if;

  for v_member_id in
    select player_id
    from coalition_members
    where coalition_id = v_request.coalition_id
    order by player_id
  loop
    if exists (
      select 1
      from diplomacy_relations
      where player_a_id = least(v_request.player_id, v_member_id)
        and player_b_id = greatest(v_request.player_id, v_member_id)
        and state = 'war'
    ) then
      raise exception 'target player is currently at war with a member of this coalition';
    end if;
  end loop;

  insert into coalition_members (coalition_id, player_id)
  values (v_request.coalition_id, v_request.player_id);

  update coalition_join_requests
  set status = 'accepted'
  where id = p_request_id;

  perform _coalition_cancel_other_pending_for_player(v_request.player_id, null, p_request_id);

  delete from diplomacy_relations r
  using coalition_members cm
  where cm.coalition_id = v_request.coalition_id
    and cm.player_id <> v_request.player_id
    and r.state = 'non_aggression'
    and r.player_a_id = least(cm.player_id, v_request.player_id)
    and r.player_b_id = greatest(cm.player_id, v_request.player_id);

  insert into world_events (event_type, payload)
  select
    'coalition_member_joined',
    jsonb_build_object(
      'coalition_id', v_coalition.id,
      'coalition_name', v_coalition.name,
      'player_id', p.id,
      'player_display_name', p.display_name,
      'player_home_x', home.x::integer,
      'player_home_y', home.y::integer
    )
  from players p
  left join territories home
    on home.owner_id = p.id
   and home.is_home = true
  where p.id = v_request.player_id;
end;
$$;

create or replace function coalition_reject_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_invite coalition_invites%rowtype;
begin
  select *
  into v_invite
  from coalition_invites
  where id = p_invite_id;

  if not found then
    raise exception 'coalition invite % not found', p_invite_id;
  end if;

  perform coalition_lock(v_invite.coalition_id);

  select *
  into v_invite
  from coalition_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'coalition invite % not found', p_invite_id;
  end if;

  if v_invite.invited_player_id <> v_caller then
    raise exception 'only the invited player may reject this coalition invite';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'coalition invite % is no longer pending', p_invite_id;
  end if;

  update coalition_invites
  set status = 'rejected'
  where id = p_invite_id;
end;
$$;

create or replace function coalition_cancel_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_invite coalition_invites%rowtype;
  v_leader_id uuid;
begin
  select *
  into v_invite
  from coalition_invites
  where id = p_invite_id;

  if not found then
    raise exception 'coalition invite % not found', p_invite_id;
  end if;

  perform coalition_lock(v_invite.coalition_id);

  select *
  into v_invite
  from coalition_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'coalition invite % not found', p_invite_id;
  end if;

  select leader_id
  into v_leader_id
  from coalitions
  where id = v_invite.coalition_id
    and disbanded_at is null;

  if not found then
    raise exception 'coalition % is not active', v_invite.coalition_id;
  end if;

  if v_invite.invited_by <> v_caller or v_leader_id <> v_caller then
    raise exception 'only the leader who sent the invite may cancel it';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'coalition invite % is no longer pending', p_invite_id;
  end if;

  update coalition_invites
  set status = 'cancelled'
  where id = p_invite_id;
end;
$$;

create or replace function coalition_reject_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_request coalition_join_requests%rowtype;
  v_leader_id uuid;
begin
  select *
  into v_request
  from coalition_join_requests
  where id = p_request_id;

  if not found then
    raise exception 'coalition join request % not found', p_request_id;
  end if;

  perform coalition_lock(v_request.coalition_id);

  select *
  into v_request
  from coalition_join_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'coalition join request % not found', p_request_id;
  end if;

  select leader_id
  into v_leader_id
  from coalitions
  where id = v_request.coalition_id
    and disbanded_at is null;

  if not found then
    raise exception 'coalition % is not active', v_request.coalition_id;
  end if;

  if v_leader_id <> v_caller then
    raise exception 'only the coalition leader may reject join requests';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'coalition join request % is no longer pending', p_request_id;
  end if;

  update coalition_join_requests
  set status = 'rejected'
  where id = p_request_id;
end;
$$;

create or replace function coalition_cancel_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_request coalition_join_requests%rowtype;
begin
  select *
  into v_request
  from coalition_join_requests
  where id = p_request_id;

  if not found then
    raise exception 'coalition join request % not found', p_request_id;
  end if;

  perform coalition_lock(v_request.coalition_id);

  select *
  into v_request
  from coalition_join_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'coalition join request % not found', p_request_id;
  end if;

  if v_request.player_id <> v_caller then
    raise exception 'only the requester may cancel this join request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'coalition join request % is no longer pending', p_request_id;
  end if;

  update coalition_join_requests
  set status = 'cancelled'
  where id = p_request_id;
end;
$$;

create or replace function coalition_kick(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_coalition coalitions%rowtype;
  v_other_member record;
begin
  select c.*
  into v_coalition
  from coalition_members cm
  join coalitions c
    on c.id = cm.coalition_id
   and c.disbanded_at is null
  where cm.player_id = v_caller;

  if not found then
    raise exception 'you are not in an active coalition';
  end if;

  perform coalition_lock(v_coalition.id);

  select *
  into v_coalition
  from coalitions
  where id = v_coalition.id
    and disbanded_at is null
  for update;

  if not found then
    raise exception 'coalition % is not active', v_coalition.id;
  end if;

  if v_coalition.leader_id <> v_caller then
    raise exception 'only the coalition leader may kick members';
  end if;

  if p_player_id = v_caller then
    raise exception 'coalition leader cannot kick themselves';
  end if;

  if not exists (
    select 1
    from coalition_members
    where coalition_id = v_coalition.id
      and player_id = p_player_id
  ) then
    raise exception 'target player is not a member of this coalition';
  end if;

  for v_other_member in
    select player_id
    from coalition_members
    where coalition_id = v_coalition.id
      and player_id <> p_player_id
  loop
    perform _coalition_auto_recall_loans_between(p_player_id, v_other_member.player_id);
  end loop;

  delete from coalition_members
  where coalition_id = v_coalition.id
    and player_id = p_player_id;

  insert into world_events (event_type, payload)
  select
    'coalition_member_kicked',
    jsonb_build_object(
      'coalition_id', v_coalition.id,
      'coalition_name', v_coalition.name,
      'player_id', p.id,
      'player_display_name', p.display_name,
      'player_home_x', home.x::integer,
      'player_home_y', home.y::integer
    )
  from players p
  left join territories home
    on home.owner_id = p.id
   and home.is_home = true
  where p.id = p_player_id;
end;
$$;

create or replace function coalition_transfer_leadership(p_new_leader_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_coalition coalitions%rowtype;
begin
  select c.*
  into v_coalition
  from coalition_members cm
  join coalitions c
    on c.id = cm.coalition_id
   and c.disbanded_at is null
  where cm.player_id = v_caller;

  if not found then
    raise exception 'you are not in an active coalition';
  end if;

  perform coalition_lock(v_coalition.id);

  select *
  into v_coalition
  from coalitions
  where id = v_coalition.id
    and disbanded_at is null
  for update;

  if not found then
    raise exception 'coalition % is not active', v_coalition.id;
  end if;

  if v_coalition.leader_id <> v_caller then
    raise exception 'only the coalition leader may transfer leadership';
  end if;

  if not exists (
    select 1
    from coalition_members
    where coalition_id = v_coalition.id
      and player_id = p_new_leader_id
  ) then
    raise exception 'new leader must already be a member of the coalition';
  end if;

  update coalitions
  set leader_id = p_new_leader_id
  where id = v_coalition.id;

  insert into world_events (event_type, payload)
  select
    'coalition_leadership_transferred',
    jsonb_build_object(
      'coalition_id', v_coalition.id,
      'coalition_name', v_coalition.name,
      'old_leader_id', old_leader.id,
      'old_leader_display_name', old_leader.display_name,
      'old_leader_home_x', old_home.x::integer,
      'old_leader_home_y', old_home.y::integer,
      'new_leader_id', new_leader.id,
      'new_leader_display_name', new_leader.display_name,
      'new_leader_home_x', new_home.x::integer,
      'new_leader_home_y', new_home.y::integer
    )
  from players old_leader
  left join territories old_home
    on old_home.owner_id = old_leader.id
   and old_home.is_home = true
  join players new_leader
    on new_leader.id = p_new_leader_id
  left join territories new_home
    on new_home.owner_id = new_leader.id
   and new_home.is_home = true
  where old_leader.id = v_caller;
end;
$$;

create or replace function coalition_leave()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_coalition coalitions%rowtype;
  v_other_member_count integer;
  v_other_member record;
begin
  select c.*
  into v_coalition
  from coalition_members cm
  join coalitions c
    on c.id = cm.coalition_id
   and c.disbanded_at is null
  where cm.player_id = v_caller;

  if not found then
    raise exception 'you are not in an active coalition';
  end if;

  perform coalition_lock(v_coalition.id);

  select *
  into v_coalition
  from coalitions
  where id = v_coalition.id
    and disbanded_at is null
  for update;

  if not found then
    raise exception 'coalition % is not active', v_coalition.id;
  end if;

  if v_coalition.leader_id = v_caller then
    select count(*)
    into v_other_member_count
    from coalition_members
    where coalition_id = v_coalition.id
      and player_id <> v_caller;

    if v_other_member_count > 0 then
      raise exception 'transfer leadership before leaving the coalition';
    end if;

    perform _coalition_disband_core(v_coalition.id);
    return;
  end if;

  for v_other_member in
    select player_id
    from coalition_members
    where coalition_id = v_coalition.id
      and player_id <> v_caller
  loop
    perform _coalition_auto_recall_loans_between(v_caller, v_other_member.player_id);
  end loop;

  delete from coalition_members
  where coalition_id = v_coalition.id
    and player_id = v_caller;

  insert into world_events (event_type, payload)
  select
    'coalition_member_left',
    jsonb_build_object(
      'coalition_id', v_coalition.id,
      'coalition_name', v_coalition.name,
      'player_id', p.id,
      'player_display_name', p.display_name,
      'player_home_x', home.x::integer,
      'player_home_y', home.y::integer
    )
  from players p
  left join territories home
    on home.owner_id = p.id
   and home.is_home = true
  where p.id = v_caller;
end;
$$;

create or replace function coalition_disband()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_coalition_id uuid;
  v_leader_id uuid;
begin
  select cm.coalition_id, c.leader_id
  into v_coalition_id, v_leader_id
  from coalition_members cm
  join coalitions c
    on c.id = cm.coalition_id
   and c.disbanded_at is null
  where cm.player_id = v_caller;

  if not found then
    raise exception 'you are not in an active coalition';
  end if;

  perform coalition_lock(v_coalition_id);

  select leader_id
  into v_leader_id
  from coalitions
  where id = v_coalition_id
    and disbanded_at is null
  for update;

  if not found then
    raise exception 'coalition % is not active', v_coalition_id;
  end if;

  if v_leader_id <> v_caller then
    raise exception 'only the coalition leader may disband the coalition';
  end if;

  perform _coalition_disband_core(v_coalition_id);
end;
$$;

create or replace function coalition_declare_war(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_coalition coalitions%rowtype;
  v_target_is_npc boolean;
  v_member_id uuid;
  v_members_summary jsonb;
begin
  select c.*
  into v_coalition
  from coalition_members cm
  join coalitions c
    on c.id = cm.coalition_id
   and c.disbanded_at is null
  where cm.player_id = v_caller;

  if not found then
    raise exception 'you are not in an active coalition';
  end if;

  perform coalition_lock(v_coalition.id);

  select *
  into v_coalition
  from coalitions
  where id = v_coalition.id
    and disbanded_at is null
  for update;

  if not found then
    raise exception 'coalition % is not active', v_coalition.id;
  end if;

  if v_coalition.leader_id <> v_caller then
    raise exception 'only the coalition leader may declare coalition war';
  end if;

  if p_target_id = v_caller or exists (
    select 1
    from coalition_members
    where coalition_id = v_coalition.id
      and player_id = p_target_id
  ) then
    raise exception 'cannot declare coalition war on one of your own members';
  end if;

  select coalesce(is_npc, false)
  into v_target_is_npc
  from players
  where id = p_target_id;

  if not found then
    raise exception 'target player not found';
  end if;

  if v_target_is_npc then
    raise exception 'cannot declare coalition war on an NPC kingdom';
  end if;

  for v_member_id in
    select player_id
    from coalition_members
    where coalition_id = v_coalition.id
    order by player_id
  loop
    if not exists (
      select 1
      from diplomacy_relations
      where player_a_id = least(v_member_id, p_target_id)
        and player_b_id = greatest(v_member_id, p_target_id)
        and state = 'war'
    ) then
      perform _diplomacy_declare_war_core(v_member_id, p_target_id);
    end if;
  end loop;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'player_id', p.id,
      'display_name', p.display_name
    )
    order by p.display_name
  ), '[]'::jsonb)
  into v_members_summary
  from coalition_members cm
  join players p
    on p.id = cm.player_id
  where cm.coalition_id = v_coalition.id
    and exists (
      select 1
      from diplomacy_relations r
      where r.player_a_id = least(cm.player_id, p_target_id)
        and r.player_b_id = greatest(cm.player_id, p_target_id)
        and r.state = 'war'
    );

  insert into world_events (event_type, payload)
  select
    'coalition_war_declared',
    jsonb_build_object(
      'coalition_id', v_coalition.id,
      'coalition_name', v_coalition.name,
      'target_id', target_player.id,
      'target_display_name', target_player.display_name,
      'target_home_x', target_home.x::integer,
      'target_home_y', target_home.y::integer,
      'member_summaries', v_members_summary
    )
  from players target_player
  left join territories target_home
    on target_home.owner_id = target_player.id
   and target_home.is_home = true
  where target_player.id = p_target_id;
end;
$$;

create or replace function coalition_declare_peace(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_coalition coalitions%rowtype;
  v_member_id uuid;
  v_created_member_ids uuid[] := '{}'::uuid[];
  v_created_members_summary jsonb;
begin
  select c.*
  into v_coalition
  from coalition_members cm
  join coalitions c
    on c.id = cm.coalition_id
   and c.disbanded_at is null
  where cm.player_id = v_caller;

  if not found then
    raise exception 'you are not in an active coalition';
  end if;

  perform coalition_lock(v_coalition.id);

  select *
  into v_coalition
  from coalitions
  where id = v_coalition.id
    and disbanded_at is null
  for update;

  if not found then
    raise exception 'coalition % is not active', v_coalition.id;
  end if;

  if v_coalition.leader_id <> v_caller then
    raise exception 'only the coalition leader may declare coalition peace';
  end if;

  for v_member_id in
    select player_id
    from coalition_members
    where coalition_id = v_coalition.id
      and exists (
        select 1
        from diplomacy_relations r
        where r.player_a_id = least(player_id, p_target_id)
          and r.player_b_id = greatest(player_id, p_target_id)
          and r.state = 'war'
      )
    order by player_id
  loop
    begin
      perform _diplomacy_propose_peace_core(
        v_member_id,
        p_target_id,
        'white_peace',
        '{}'::uuid[],
        null
      );
      v_created_member_ids := array_append(v_created_member_ids, v_member_id);
    exception when others then
      if position('you already have a pending peace offer for this player' in sqlerrm) > 0 then
        null;
      else
        raise;
      end if;
    end;
  end loop;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'player_id', p.id,
      'display_name', p.display_name
    )
    order by p.display_name
  ), '[]'::jsonb)
  into v_created_members_summary
  from players p
  where p.id = any(v_created_member_ids);

  insert into world_events (event_type, payload)
  select
    'coalition_peace_signed',
    jsonb_build_object(
      'coalition_id', v_coalition.id,
      'coalition_name', v_coalition.name,
      'target_id', target_player.id,
      'target_display_name', target_player.display_name,
      'target_home_x', target_home.x::integer,
      'target_home_y', target_home.y::integer,
      'member_summaries', v_created_members_summary
    )
  from players target_player
  left join territories target_home
    on target_home.owner_id = target_player.id
   and target_home.is_home = true
  where target_player.id = p_target_id;
end;
$$;

revoke execute on function coalition_lock(uuid) from public, anon, authenticated;
revoke execute on function _coalition_cancel_other_pending_for_player(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function _coalition_disband_core(uuid) from public, anon, authenticated;
revoke execute on function _diplomacy_declare_war_core(uuid, uuid) from public, anon, authenticated;

revoke execute on function coalition_get_mine() from public, anon;
revoke execute on function coalition_list() from public, anon;
revoke execute on function coalition_list_invites() from public, anon;
revoke execute on function coalition_list_join_requests(uuid) from public, anon;
revoke execute on function coalition_create(text) from public, anon;
revoke execute on function coalition_invite(uuid, uuid) from public, anon;
revoke execute on function coalition_request_join(uuid) from public, anon;
revoke execute on function coalition_accept_invite(uuid) from public, anon;
revoke execute on function coalition_accept_request(uuid) from public, anon;
revoke execute on function coalition_reject_invite(uuid) from public, anon;
revoke execute on function coalition_cancel_invite(uuid) from public, anon;
revoke execute on function coalition_reject_request(uuid) from public, anon;
revoke execute on function coalition_cancel_request(uuid) from public, anon;
revoke execute on function coalition_kick(uuid) from public, anon;
revoke execute on function coalition_transfer_leadership(uuid) from public, anon;
revoke execute on function coalition_leave() from public, anon;
revoke execute on function coalition_disband() from public, anon;
revoke execute on function coalition_declare_war(uuid) from public, anon;
revoke execute on function coalition_declare_peace(uuid) from public, anon;
revoke execute on function diplomacy_declare_war(uuid) from public, anon;

grant execute on function coalition_get_mine() to authenticated;
grant execute on function coalition_list() to authenticated;
grant execute on function coalition_list_invites() to authenticated;
grant execute on function coalition_list_join_requests(uuid) to authenticated;
grant execute on function coalition_create(text) to authenticated;
grant execute on function coalition_invite(uuid, uuid) to authenticated;
grant execute on function coalition_request_join(uuid) to authenticated;
grant execute on function coalition_accept_invite(uuid) to authenticated;
grant execute on function coalition_accept_request(uuid) to authenticated;
grant execute on function coalition_reject_invite(uuid) to authenticated;
grant execute on function coalition_cancel_invite(uuid) to authenticated;
grant execute on function coalition_reject_request(uuid) to authenticated;
grant execute on function coalition_cancel_request(uuid) to authenticated;
grant execute on function coalition_kick(uuid) to authenticated;
grant execute on function coalition_transfer_leadership(uuid) to authenticated;
grant execute on function coalition_leave() to authenticated;
grant execute on function coalition_disband() to authenticated;
grant execute on function coalition_declare_war(uuid) to authenticated;
grant execute on function coalition_declare_peace(uuid) to authenticated;
grant execute on function diplomacy_declare_war(uuid) to authenticated;
