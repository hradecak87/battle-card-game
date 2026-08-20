-- NPC diplomacy and war-focus behavior.

create table npc_diplomacy_state (
  id boolean primary key default true check (id),
  last_run_at timestamptz
);

insert into npc_diplomacy_state (id, last_run_at)
values (true, null);

alter table npc_diplomacy_state enable row level security;
revoke all on npc_diplomacy_state from public, anon, authenticated;

create or replace function _npc_diplomacy_power(p_player_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(e.hp + e.str + e.lng + e.def), 0)
  from card_instances ci
  join card_templates ct
    on ct.id = ci.template_id
   and ct.category = 'unit'
  cross join lateral _compute_effective_stats(
    ct.base_stats,
    ct.rank,
    null,
    false,
    null,
    null,
    null
  ) e
  where ci.owner_id = p_player_id
    and ci.status = 'stationed'
    and ci.stationed_territory_id is not null
$$;

create or replace function _diplomacy_propose_peace_core(
  p_caller_id uuid,
  p_target_id uuid,
  p_kind text,
  p_offered_card_ids uuid[] default '{}'::uuid[],
  p_offered_territory_id integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid := gen_random_uuid();
begin
  if p_target_id is null or p_target_id = p_caller_id then
    raise exception 'target player is invalid';
  end if;

  perform diplomacy_lock_pair(p_caller_id, p_target_id);
  perform diplomacy_expire_visible_offers(p_caller_id);

  if not exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(p_caller_id, p_target_id)
      and player_b_id = greatest(p_caller_id, p_target_id)
  ) then
    raise exception 'you are not currently at war with this player';
  end if;

  if exists (
    select 1
    from diplomacy_offers
    where initiator_id = p_caller_id
      and target_id = p_target_id
      and status = 'pending'
    for update
  ) then
    raise exception 'you already have a pending peace offer for this player';
  end if;

  if p_kind = 'white_peace' then
    if coalesce(array_length(p_offered_card_ids, 1), 0) > 0 or p_offered_territory_id is not null then
      raise exception 'white peace cannot include tribute';
    end if;
  elsif p_kind = 'tribute_peace' then
    if coalesce(array_length(p_offered_card_ids, 1), 0) = 0 and p_offered_territory_id is null then
      raise exception 'tribute peace must include at least one card or one territory';
    end if;

    perform diplomacy_validate_cards(p_caller_id, p_offered_card_ids);
    perform diplomacy_validate_territory(p_caller_id, p_offered_territory_id);
  else
    raise exception 'invalid peace offer kind: %', p_kind;
  end if;

  insert into diplomacy_offers (
    id,
    initiator_id,
    target_id,
    kind,
    offered_card_ids,
    offered_territory_id,
    status
  ) values (
    v_offer_id,
    p_caller_id,
    p_target_id,
    p_kind,
    coalesce(p_offered_card_ids, '{}'::uuid[]),
    p_offered_territory_id,
    'pending'
  );

  return v_offer_id;
end;
$$;

create or replace function diplomacy_propose_peace(
  p_target_id uuid,
  p_kind text,
  p_offered_card_ids uuid[] default '{}'::uuid[],
  p_offered_territory_id integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
begin
  return _diplomacy_propose_peace_core(
    v_caller,
    p_target_id,
    p_kind,
    p_offered_card_ids,
    p_offered_territory_id
  );
end;
$$;

create or replace function _diplomacy_accept_peace_core(
  p_caller_id uuid,
  p_offer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair record;
  v_offer diplomacy_offers%rowtype;
  v_target_home_id integer;
  v_target_xp integer;
  v_target_limit integer;
  v_target_deck_count integer;
  v_card_id uuid;
begin
  select initiator_id, target_id
  into v_pair
  from diplomacy_offers
  where id = p_offer_id;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  perform diplomacy_lock_pair(v_pair.initiator_id, v_pair.target_id);
  perform diplomacy_expire_visible_offers(p_caller_id);

  select *
  into v_offer
  from diplomacy_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  if v_offer.target_id <> p_caller_id then
    raise exception 'only the target player may accept this peace offer';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'peace offer % is no longer pending', p_offer_id;
  end if;

  if not exists (
    select 1
    from diplomacy_relations
    where player_a_id = least(v_offer.initiator_id, v_offer.target_id)
      and player_b_id = greatest(v_offer.initiator_id, v_offer.target_id)
  ) then
    raise exception 'this war has already been resolved';
  end if;

  if exists (
    select 1
    from battles
    where status not in ('resolved', 'expired')
      and (
        (attacker_id = v_offer.initiator_id and defender_id = v_offer.target_id)
        or (attacker_id = v_offer.target_id and defender_id = v_offer.initiator_id)
      )
  ) then
    raise exception 'peace cannot be accepted while a battle between these players is still unresolved';
  end if;

  perform diplomacy_validate_cards(v_offer.initiator_id, v_offer.offered_card_ids);
  perform diplomacy_validate_territory(v_offer.initiator_id, v_offer.offered_territory_id);

  select id
  into v_target_home_id
  from territories
  where owner_id = p_caller_id
    and is_home = true
  for update;

  if not found then
    raise exception 'target player has no home territory';
  end if;

  select xp
  into v_target_xp
  from players
  where id = p_caller_id
  for update;

  v_target_limit := _deck_limit(_level_for_xp(v_target_xp));

  foreach v_card_id in array coalesce(v_offer.offered_card_ids, '{}'::uuid[]) loop
    update card_instances
    set owner_id = p_caller_id,
        stationed_territory_id = v_target_home_id,
        status = 'stationed',
        deposit_expires_at = null
    where instance_id = v_card_id;

    select count(*)
    into v_target_deck_count
    from card_instances
    where owner_id = p_caller_id
      and status in ('stationed', 'in_transit');

    if v_target_deck_count > v_target_limit then
      perform _deposit_or_grant_card(p_caller_id, v_card_id, 'stationed');
    end if;
  end loop;

  if v_offer.offered_territory_id is not null then
    update territories
    set owner_id = p_caller_id
    where id = v_offer.offered_territory_id;
  end if;

  delete from diplomacy_relations
  where player_a_id = least(v_offer.initiator_id, v_offer.target_id)
    and player_b_id = greatest(v_offer.initiator_id, v_offer.target_id);

  update diplomacy_offers
  set status = 'accepted',
      resolved_at = now()
  where id = v_offer.id;

  update diplomacy_offers
  set status = 'cancelled',
      resolved_at = coalesce(resolved_at, now())
  where status = 'pending'
    and id <> v_offer.id
    and (
      (initiator_id = v_offer.initiator_id and target_id = v_offer.target_id)
      or (initiator_id = v_offer.target_id and target_id = v_offer.initiator_id)
    );

  insert into world_events (event_type, payload)
  select
    'peace_signed',
    jsonb_build_object(
      'player_a_id', a.id,
      'player_a_display_name', a.display_name,
      'player_a_home_x', a_home.x::integer,
      'player_a_home_y', a_home.y::integer,
      'player_b_id', b.id,
      'player_b_display_name', b.display_name,
      'player_b_home_x', b_home.x::integer,
      'player_b_home_y', b_home.y::integer,
      'had_tribute', (
        coalesce(array_length(v_offer.offered_card_ids, 1), 0) > 0
        or v_offer.offered_territory_id is not null
      )
    )
  from players a
  left join territories a_home
    on a_home.owner_id = a.id
   and a_home.is_home = true
  join players b
    on b.id = v_offer.target_id
  left join territories b_home
    on b_home.owner_id = b.id
   and b_home.is_home = true
  where a.id = v_offer.initiator_id;
end;
$$;

create or replace function diplomacy_accept_peace(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
begin
  perform _diplomacy_accept_peace_core(v_caller, p_offer_id);
end;
$$;

create or replace function _diplomacy_reject_peace_core(
  p_caller_id uuid,
  p_offer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair record;
  v_offer diplomacy_offers%rowtype;
begin
  select initiator_id, target_id
  into v_pair
  from diplomacy_offers
  where id = p_offer_id;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  perform diplomacy_lock_pair(v_pair.initiator_id, v_pair.target_id);
  perform diplomacy_expire_visible_offers(p_caller_id);

  select *
  into v_offer
  from diplomacy_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'peace offer % not found', p_offer_id;
  end if;

  if v_offer.target_id <> p_caller_id then
    raise exception 'only the target player may reject this peace offer';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'peace offer % is no longer pending', p_offer_id;
  end if;

  update diplomacy_offers
  set status = 'rejected',
      resolved_at = now()
  where id = p_offer_id;
end;
$$;

create or replace function diplomacy_reject_peace(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
begin
  perform _diplomacy_reject_peace_core(v_caller, p_offer_id);
end;
$$;

create or replace function resolve_due_npc_diplomacy()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_run timestamptz;
  v_offer record;
  v_war record;
  v_npc_power numeric;
  v_opponent_power numeric;
  v_ratio numeric;
  v_has_tribute boolean;
  v_lost_recently boolean;
  v_card_count integer;
  v_offered_card_ids uuid[];
begin
  select last_run_at
  into v_last_run
  from npc_diplomacy_state
  where id = true
  for update;

  if v_last_run is not null and v_last_run > now() - interval '1 hour' then
    return;
  end if;

  update npc_diplomacy_state
  set last_run_at = now()
  where id = true;

  for v_offer in
    select
      o.id,
      o.initiator_id,
      o.target_id,
      o.offered_card_ids,
      o.offered_territory_id
    from diplomacy_offers o
    join players target
      on target.id = o.target_id
    where o.status = 'pending'
      and target.is_npc = true
    order by o.created_at, o.id
  loop
    begin
      select
        _npc_diplomacy_power(v_offer.target_id),
        _npc_diplomacy_power(v_offer.initiator_id)
      into v_npc_power, v_opponent_power;

      v_ratio := case
        when v_opponent_power = 0 and v_npc_power = 0 then 1.0
        when v_opponent_power = 0 then 1000000000
        else v_npc_power / v_opponent_power
      end;

      v_has_tribute := coalesce(array_length(v_offer.offered_card_ids, 1), 0) > 0
        or v_offer.offered_territory_id is not null;

      if v_has_tribute or v_ratio < 1.2 then
        perform _diplomacy_accept_peace_core(v_offer.target_id, v_offer.id);
      else
        perform _diplomacy_reject_peace_core(v_offer.target_id, v_offer.id);
      end if;
    exception
      when others then
        raise log 'resolve_due_npc_diplomacy incoming offer % failed (sqlstate %, error %)',
          v_offer.id, SQLSTATE, SQLERRM;
    end;
  end loop;

  for v_war in
    select
      case when a.is_npc then a.id else b.id end as npc_id,
      case when a.is_npc then b.id else a.id end as human_id
    from diplomacy_relations r
    join players a
      on a.id = r.player_a_id
    join players b
      on b.id = r.player_b_id
    where (a.is_npc = true and coalesce(b.is_npc, false) = false)
       or (b.is_npc = true and coalesce(a.is_npc, false) = false)
    order by r.war_started_at, npc_id, human_id
  loop
    begin
      if exists (
        select 1
        from diplomacy_offers
        where initiator_id = v_war.npc_id
          and target_id = v_war.human_id
          and status = 'pending'
      ) then
        continue;
      end if;

      select
        _npc_diplomacy_power(v_war.npc_id),
        _npc_diplomacy_power(v_war.human_id)
      into v_npc_power, v_opponent_power;

      v_ratio := case
        when v_opponent_power = 0 and v_npc_power = 0 then 1.0
        when v_opponent_power = 0 then 1000000000
        else v_npc_power / v_opponent_power
      end;

      select exists (
        select 1
        from world_events
        where event_type in ('battle_won', 'battle_surrendered')
          and payload->>'loser_id' = v_war.npc_id::text
          and payload->>'winner_id' = v_war.human_id::text
          and created_at > now() - interval '24 hours'
      )
      into v_lost_recently;

      if v_ratio < 0.6 or v_lost_recently then
        if v_ratio < 0.4 then
          v_card_count := case
            when v_ratio < 0.2 then 3
            when v_ratio < 0.3 then 2
            else 1
          end;

          with eligible_cards as (
            select
              ci.instance_id,
              case ct.rank
                when 'common' then 1
                when 'uncommon' then 2
                when 'rare' then 3
                when 'epic' then 4
                when 'legend' then 5
              end as rank_strength,
              e.hp + e.str + e.lng + e.def as total_power
            from card_instances ci
            join card_templates ct
              on ct.id = ci.template_id
             and ct.category = 'unit'
            cross join lateral _compute_effective_stats(
              ct.base_stats,
              ct.rank,
              null,
              false,
              null,
              null,
              null
            ) e
            where ci.owner_id = v_war.npc_id
              and ci.status = 'stationed'
              and ci.stationed_territory_id is not null
              and not exists (
                select 1
                from territories t
                where t.id = ci.stationed_territory_id
                  and t.battle_locked_by is not null
              )
              and not exists (
                select 1
                from battles b
                where b.territory_id = ci.stationed_territory_id
                  and b.status not in ('resolved', 'expired')
              )
          ),
          chosen_cards as (
            select instance_id
            from eligible_cards
            order by rank_strength asc, total_power asc, instance_id asc
            limit v_card_count
          )
          select coalesce(array_agg(instance_id order by instance_id), '{}'::uuid[])
          into v_offered_card_ids
          from chosen_cards;

          if coalesce(array_length(v_offered_card_ids, 1), 0) > 0 then
            perform _diplomacy_propose_peace_core(
              v_war.npc_id,
              v_war.human_id,
              'tribute_peace',
              v_offered_card_ids,
              null
            );
          end if;
        else
          perform _diplomacy_propose_peace_core(
            v_war.npc_id,
            v_war.human_id,
            'white_peace',
            '{}'::uuid[],
            null
          );
        end if;
      end if;
    exception
      when others then
        raise log 'resolve_due_npc_diplomacy outgoing proposal for NPC % vs human % failed (sqlstate %, error %)',
          v_war.npc_id, v_war.human_id, SQLSTATE, SQLERRM;
    end;
  end loop;
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
end;
$$;

create or replace function resolve_due_npc_actions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_npc record;
  v_owned_territory_count integer;
  v_adjacent_expansion_target_id integer;
  v_adjacent_expansion_origin_id integer;
  v_adjacent_expansion_card_ids uuid[];
  v_adjacent_attack_target_id integer;
  v_adjacent_attack_origin_id integer;
  v_adjacent_attack_card_ids uuid[];
  v_focus_enemy_id uuid;
  v_focus_attack_target_id integer;
  v_focus_attack_origin_id integer;
  v_focus_attack_card_ids uuid[];
  v_expansion_target_id integer;
  v_expansion_origin_id integer;
  v_expansion_card_ids uuid[];
  v_attack_target_id integer;
  v_attack_origin_id integer;
  v_attack_card_ids uuid[];
  v_war_roll numeric;
  v_tier_roll numeric;
  v_pick_roll numeric;
begin
  for v_npc in
    select id
    from players
    where is_npc = true
      and npc_next_action_at is not null
      and npc_next_action_at <= now()
    order by npc_next_action_at, id
    for update
  loop
    v_adjacent_expansion_target_id := null;
    v_adjacent_expansion_origin_id := null;
    v_adjacent_expansion_card_ids := null;
    v_adjacent_attack_target_id := null;
    v_adjacent_attack_origin_id := null;
    v_adjacent_attack_card_ids := null;
    v_focus_enemy_id := null;
    v_focus_attack_target_id := null;
    v_focus_attack_origin_id := null;
    v_focus_attack_card_ids := null;
    v_expansion_target_id := null;
    v_expansion_origin_id := null;
    v_expansion_card_ids := null;
    v_attack_target_id := null;
    v_attack_origin_id := null;
    v_attack_card_ids := null;

    begin
      select opponent_id
      into v_focus_enemy_id
      from (
        select case
          when r.player_a_id = v_npc.id then r.player_b_id
          else r.player_a_id
        end as opponent_id
        from diplomacy_relations r
        where v_npc.id in (r.player_a_id, r.player_b_id)
      ) war_opponents
      order by _npc_diplomacy_power(opponent_id) asc, opponent_id
      limit 1;

      if v_focus_enemy_id is not null then
        v_war_roll := random();

        if v_war_roll < 0.8 then
          with sampled_targets as (
            select t.id, t.x, t.y
            from territories t
            where t.owner_id = v_focus_enemy_id
              and t.battle_locked_by is null
              and exists (
                select 1
                from (values (t.x - 1, t.y), (t.x + 1, t.y),
                             (t.x, t.y - 1), (t.x, t.y + 1)) as n(nx, ny)
                left join territories t2 on t2.x = n.nx and t2.y = n.ny
                where t2.id is null or t2.owner_id is distinct from t.owner_id
              )
            order by random()
            limit 200
          )
          select candidate.target_id, candidate.origin_id, candidate.card_ids
          into v_focus_attack_target_id, v_focus_attack_origin_id, v_focus_attack_card_ids
          from (
            select
              t.id as target_id,
              origin.id as origin_id,
              origin.card_ids
            from sampled_targets t
            join lateral (
              select
                o.id,
                array_agg(ci.instance_id order by ci.instance_id) as card_ids,
                _territory_effective_unit_power(v_npc.id, o.id, false) as attack_power
              from territories o
              join card_instances ci
                on ci.stationed_territory_id = o.id
               and ci.owner_id = v_npc.id
               and ci.status = 'stationed'
              join card_templates ct
                on ct.id = ci.template_id
               and ct.category = 'unit'
              where o.owner_id = v_npc.id
              group by o.id, o.x, o.y
              order by greatest(abs(o.x - t.x), abs(o.y - t.y)) asc, o.id
              limit 1
            ) origin on true
            where origin.attack_power >=
              _territory_effective_unit_power(v_focus_enemy_id, t.id, true) * 1.2
            order by random()
            limit 1
          ) candidate;

          if v_focus_attack_target_id is not null then
            perform _declare_attack_core(
              v_npc.id,
              v_focus_attack_target_id,
              jsonb_build_array(
                jsonb_build_object(
                  'origin_territory_id', v_focus_attack_origin_id,
                  'card_instance_ids', to_jsonb(v_focus_attack_card_ids)
                )
              ),
              null
            );

            update players
            set npc_next_action_at = now() + (4 + random() * 8) * interval '1 hour'
            where id = v_npc.id;

            continue;
          end if;
        end if;
      end if;

      select count(*) into v_owned_territory_count
      from territories
      where owner_id = v_npc.id;

      if v_owned_territory_count < 32 then
        with adjacent_origin_pairs as (
          select
            target.id as target_id,
            o.id as origin_id,
            array_agg(ci.instance_id order by ci.instance_id) as card_ids
          from territories o
          join card_instances ci
            on ci.stationed_territory_id = o.id
           and ci.owner_id = v_npc.id
           and ci.status = 'stationed'
          join card_templates ct
            on ct.id = ci.template_id
           and ct.category = 'unit'
          cross join lateral (
            values (o.x - 1, o.y), (o.x + 1, o.y), (o.x, o.y - 1), (o.x, o.y + 1)
          ) as n(nx, ny)
          join territories target
            on target.x = n.nx
           and target.y = n.ny
          where o.owner_id = v_npc.id
            and target.owner_id is null
            and target.claim_locked_by is null
            and target.battle_locked_by is null
            and not exists (
              select 1
              from card_instances ci2
              join card_templates ct2 on ct2.id = ci2.template_id
              where ci2.stationed_territory_id = target.id
                and ci2.owner_id is null
                and ct2.category = 'unit'
            )
          group by target.id, o.id
        ),
        adjacent_targets as (
          select distinct on (target_id)
            target_id,
            origin_id,
            card_ids
          from adjacent_origin_pairs
          order by target_id, origin_id
        )
        select target_id, origin_id, card_ids
        into v_adjacent_expansion_target_id, v_adjacent_expansion_origin_id, v_adjacent_expansion_card_ids
        from adjacent_targets
        order by random()
        limit 1;
      end if;

      with adjacent_origin_pairs as (
        select
          target.id as target_id,
          target.owner_id as target_owner_id,
          target.claim_locked_by as target_claim_locked_by,
          o.id as origin_id,
          array_agg(ci.instance_id order by ci.instance_id) as card_ids,
          _territory_effective_unit_power(v_npc.id, o.id, false) as attack_power
        from territories o
        join card_instances ci
          on ci.stationed_territory_id = o.id
         and ci.owner_id = v_npc.id
         and ci.status = 'stationed'
        join card_templates ct
          on ct.id = ci.template_id
         and ct.category = 'unit'
        cross join lateral (
          values (o.x - 1, o.y), (o.x + 1, o.y), (o.x, o.y - 1), (o.x, o.y + 1)
        ) as n(nx, ny)
        join territories target
          on target.x = n.nx
         and target.y = n.ny
        where o.owner_id = v_npc.id
          and target.battle_locked_by is null
          and (
            (target.owner_id is not null and target.owner_id <> v_npc.id)
            or (target.owner_id is null and target.claim_locked_by is not null and target.claim_locked_by <> v_npc.id)
          )
        group by target.id, target.owner_id, target.claim_locked_by, o.id
      ),
      eligible_adjacent_targets as (
        select distinct on (target_id)
          target_id,
          origin_id,
          card_ids
        from adjacent_origin_pairs
        where attack_power >=
          _territory_effective_unit_power(
            case when target_owner_id is not null then target_owner_id else target_claim_locked_by end,
            target_id,
            true
          ) * 1.2
        order by target_id, attack_power desc, origin_id
      )
      select target_id, origin_id, card_ids
      into v_adjacent_attack_target_id, v_adjacent_attack_origin_id, v_adjacent_attack_card_ids
      from eligible_adjacent_targets
      order by random()
      limit 1;

      v_tier_roll := random();

      if (v_adjacent_expansion_target_id is not null or v_adjacent_attack_target_id is not null)
         and v_tier_roll < 0.9 then
        v_expansion_target_id := v_adjacent_expansion_target_id;
        v_expansion_origin_id := v_adjacent_expansion_origin_id;
        v_expansion_card_ids := v_adjacent_expansion_card_ids;
        v_attack_target_id := v_adjacent_attack_target_id;
        v_attack_origin_id := v_adjacent_attack_origin_id;
        v_attack_card_ids := v_adjacent_attack_card_ids;
      else
        -- NOTE: expansion/attack candidate search is deliberately bounded to a
        -- random 200-row sample of the *base* filter conditions before the
        -- expensive per-candidate lateral join (nearest-origin distance sort,
        -- `_territory_effective_unit_power(...)`) runs — without this bound,
        -- the lateral join was evaluated once per matching territory across
        -- the full 256x256 map (tens of thousands of rows), which took ~65s
        -- per tick and made every RPC calling resolve_due_movements() (i.e.
        -- almost every RPC in the app, including the map) time out with a
        -- Postgres statement-timeout 500 once real NPC ticks started firing.
        if v_owned_territory_count < 32 then
          with sampled_targets as (
            select t.id, t.x, t.y
            from territories t
            where t.owner_id is null
              and t.claim_locked_by is null
              and t.battle_locked_by is null
              and not exists (
                select 1
                from card_instances ci
                join card_templates ct on ct.id = ci.template_id
                where ci.stationed_territory_id = t.id
                  and ci.owner_id is null
                  and ct.category = 'unit'
              )
            order by random()
            limit 200
          )
          select candidate.target_id, candidate.origin_id, candidate.card_ids
          into v_expansion_target_id, v_expansion_origin_id, v_expansion_card_ids
          from (
            select
              t.id as target_id,
              origin.id as origin_id,
              origin.card_ids
            from sampled_targets t
            join lateral (
              select
                o.id,
                array_agg(ci.instance_id order by ci.instance_id) as card_ids
              from territories o
              join card_instances ci
                on ci.stationed_territory_id = o.id
               and ci.owner_id = v_npc.id
               and ci.status = 'stationed'
              join card_templates ct
                on ct.id = ci.template_id
               and ct.category = 'unit'
              where o.owner_id = v_npc.id
              group by o.id, o.x, o.y
              order by greatest(abs(o.x - t.x), abs(o.y - t.y)) asc, o.id
              limit 1
            ) origin on true
            order by random()
            limit 1
          ) candidate;
        end if;

        with sampled_targets as (
          select t.id, t.x, t.y, t.owner_id, t.claim_locked_by
          from territories t
          where t.battle_locked_by is null
            and (
              (t.owner_id is not null and t.owner_id <> v_npc.id)
              or (t.owner_id is null and t.claim_locked_by is not null and t.claim_locked_by <> v_npc.id)
            )
            and (
              t.owner_id is null
              or exists (
                select 1
                from (values (t.x - 1, t.y), (t.x + 1, t.y),
                             (t.x, t.y - 1), (t.x, t.y + 1)) as n(nx, ny)
                left join territories t2 on t2.x = n.nx and t2.y = n.ny
                where t2.id is null or t2.owner_id is distinct from t.owner_id
              )
            )
          order by random()
          limit 200
        )
        select candidate.target_id, candidate.origin_id, candidate.card_ids
        into v_attack_target_id, v_attack_origin_id, v_attack_card_ids
        from (
          select
            t.id as target_id,
            origin.id as origin_id,
            origin.card_ids
          from sampled_targets t
          join lateral (
            select
              o.id,
              array_agg(ci.instance_id order by ci.instance_id) as card_ids,
              _territory_effective_unit_power(v_npc.id, o.id, false) as attack_power
            from territories o
            join card_instances ci
              on ci.stationed_territory_id = o.id
             and ci.owner_id = v_npc.id
             and ci.status = 'stationed'
            join card_templates ct
              on ct.id = ci.template_id
             and ct.category = 'unit'
            where o.owner_id = v_npc.id
            group by o.id, o.x, o.y
            order by greatest(abs(o.x - t.x), abs(o.y - t.y)) asc, o.id
            limit 1
          ) origin on true
          where origin.attack_power >=
            _territory_effective_unit_power(
              case when t.owner_id is not null then t.owner_id else t.claim_locked_by end,
              t.id,
              true
            ) * 1.2
          order by random()
          limit 1
        ) candidate;
      end if;

      v_pick_roll := random();

      if v_expansion_target_id is not null
         and (v_attack_target_id is null or v_pick_roll < 0.7) then
        perform _start_claim_core(
          v_npc.id,
          v_expansion_origin_id,
          v_expansion_target_id,
          v_expansion_card_ids
        );
      elsif v_attack_target_id is not null then
        perform _declare_attack_core(
          v_npc.id,
          v_attack_target_id,
          jsonb_build_array(
            jsonb_build_object(
              'origin_territory_id', v_attack_origin_id,
              'card_instance_ids', to_jsonb(v_attack_card_ids)
            )
          ),
          null
        );
      end if;
    exception
      when others then
        raise log 'resolve_due_npc_actions failed for NPC % (sqlstate %, error %)', v_npc.id, SQLSTATE, SQLERRM;
    end;

    update players
    set npc_next_action_at = now() + (4 + random() * 8) * interval '1 hour'
    where id = v_npc.id;
  end loop;
end;
$$;

revoke execute on function _npc_diplomacy_power(uuid) from public, anon, authenticated;
revoke execute on function _diplomacy_propose_peace_core(uuid, uuid, text, uuid[], integer) from public, anon, authenticated;
revoke execute on function _diplomacy_accept_peace_core(uuid, uuid) from public, anon, authenticated;
revoke execute on function _diplomacy_reject_peace_core(uuid, uuid) from public, anon, authenticated;
revoke execute on function resolve_due_npc_diplomacy() from public, anon, authenticated;

revoke execute on function diplomacy_propose_peace(uuid, text, uuid[], integer) from public, anon;
revoke execute on function diplomacy_accept_peace(uuid) from public, anon;
revoke execute on function diplomacy_reject_peace(uuid) from public, anon;

grant execute on function diplomacy_propose_peace(uuid, text, uuid[], integer) to authenticated;
grant execute on function diplomacy_accept_peace(uuid) to authenticated;
grant execute on function diplomacy_reject_peace(uuid) to authenticated;
