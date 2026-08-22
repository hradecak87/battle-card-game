-- ---------------------------------------------------------------------------
-- 0075_npc_garrison_reinforcement.sql
--
-- Adds lazy NPC garrison reinforcement / redistribution with time-to-threat
-- escalation, plus an internal transfer helper so NPC-created reinforcements
-- reuse the same transfer-movement mechanism as player-owned transfers.
-- ---------------------------------------------------------------------------

alter table players
  add column if not exists npc_garrison_reeval_at timestamptz not null default now();

update players
set npc_garrison_reeval_at = now()
where npc_garrison_reeval_at is null;

create index if not exists players_npc_garrison_reeval_at_idx
  on players (npc_garrison_reeval_at)
  where is_npc = true;

create or replace function _start_transfer_core(
  p_caller uuid,
  origin_territory_id integer,
  destination_territory_id integer,
  card_instance_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_nation nation_id;
  origin_x smallint;
  origin_y smallint;
  dest_x smallint;
  dest_y smallint;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  transfer_hrs numeric;
  matching_count integer;
  arrives_at timestamptz;
  movement_id uuid;
begin
  if p_caller is null then
    raise exception 'caller is required';
  end if;

  if card_instance_ids is null or array_length(card_instance_ids, 1) is null then
    raise exception 'card_instance_ids must be non-empty';
  end if;

  select nation into caller_nation
  from players
  where id = p_caller;

  if not found then
    raise exception 'caller not found';
  end if;

  select x, y
  into origin_x, origin_y
  from territories
  where id = origin_territory_id
    and owner_id = p_caller;

  if not found then
    raise exception 'caller does not own origin_territory_id';
  end if;

  select x, y
  into dest_x, dest_y
  from territories
  where id = destination_territory_id
    and owner_id = p_caller;

  if not found then
    raise exception 'caller does not own destination_territory_id (use start_claim instead)';
  end if;

  if exists (
    select 1
    from battles
    where territory_id = destination_territory_id
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'cannot reinforce a territory with an unresolved battle';
  end if;

  select count(*)
  into matching_count
  from card_instances ci
  join card_templates ct
    on ct.id = ci.template_id
   and ct.category = 'unit'
  where ci.instance_id = any(card_instance_ids)
    and ci.owner_id = p_caller
    and ci.stationed_territory_id = origin_territory_id
    and ci.status = 'stationed';

  if matching_count <> array_length(card_instance_ids, 1) then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  distance := greatest(abs(dest_x - origin_x), abs(dest_y - origin_y));
  group_speed := _min_group_speed(card_instance_ids);
  speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
  transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);

  perform ci.instance_id
  from card_instances ci
  where ci.instance_id = any(card_instance_ids)
    and ci.owner_id = p_caller
    and ci.stationed_territory_id = origin_territory_id
    and ci.status = 'stationed'
  for update;

  if not found then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  arrives_at := now() + (transfer_hrs || ' hours')::interval;

  insert into troop_movements
    (
      player_id,
      kind,
      origin_territory_id,
      destination_territory_id,
      transfer_arrives_at
    )
  values
    (
      p_caller,
      'transfer',
      origin_territory_id,
      destination_territory_id,
      arrives_at
    )
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);

  return movement_id;
end;
$$;

create or replace function start_transfer(
  origin_territory_id integer,
  destination_territory_id integer,
  card_instance_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  perform resolve_due_movements();

  if caller is null then
    raise exception 'not authenticated';
  end if;

  perform _start_transfer_core(
    caller,
    origin_territory_id,
    destination_territory_id,
    card_instance_ids
  );
end;
$$;

create or replace function resolve_due_npc_garrison_reinforcement()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_npc record;
  v_target record;
  v_source record;
  v_base_target integer;
  v_target_count integer;
  v_current_garrison_count integer;
  v_shortfall integer;
  v_attack_arrival timestamptz;
  v_source_limit integer;
  v_sources_used integer;
  v_require_timely_arrival boolean;
  v_alarm_mode boolean;
  v_source_base_target integer;
  v_source_surplus integer;
  v_cards_to_send integer;
  v_selected_card_ids uuid[];
  v_selected_count integer;
  v_transfer_hours numeric;
  v_selected_arrival timestamptz;
begin
  for v_npc in
    select id, nation
    from players
    where is_npc = true
      and npc_garrison_reeval_at <= now()
    order by npc_garrison_reeval_at, id
    for update
  loop
    begin
      for v_target in
        with npc_targets as (
          select
            t.id,
            t.x,
            t.y,
            t.difficulty,
            t.castle_rank,
            t.village_rank,
            t.wall_rank,
            (
              select min(tm.transfer_arrives_at)
              from troop_movements tm
              where tm.kind = 'attack'
                and tm.status = 'in_transit'
                and tm.destination_territory_id = t.id
            ) as first_attack_arrival
          from territories t
          where t.owner_id = v_npc.id
            and not exists (
              select 1
              from battles b
              where b.territory_id = t.id
                and b.status not in ('resolved', 'expired')
            )
        )
        select *
        from npc_targets
        order by first_attack_arrival nulls last, id
      loop
        v_base_target := _npc_garrison_target_size(v_target.difficulty);
        v_attack_arrival := v_target.first_attack_arrival;
        v_target_count := v_base_target;
        v_source_limit := 1;
        v_require_timely_arrival := false;
        v_alarm_mode := false;

        if v_attack_arrival is not null then
          if v_attack_arrival > now() + interval '24 hours' then
            null;
          elsif v_attack_arrival >= now() + interval '6 hours' then
            v_target_count := ceil(v_base_target::numeric * 1.5)::integer;
            v_source_limit := 2;
            v_require_timely_arrival := true;
          else
            v_alarm_mode := true;
            v_source_limit := null;
            v_require_timely_arrival := true;
          end if;
        end if;

        select
          coalesce((
            select count(*)
            from card_instances ci
            join card_templates ct
              on ct.id = ci.template_id
             and ct.category = 'unit'
            where ci.owner_id = v_npc.id
              and ci.status = 'stationed'
              and ci.stationed_territory_id = v_target.id
          ), 0)
          + coalesce((
            select count(*)
            from troop_movements reinforcement
            join troop_movement_units tmu
              on tmu.movement_id = reinforcement.id
            join card_instances ci
              on ci.instance_id = tmu.card_instance_id
            join card_templates ct
              on ct.id = ci.template_id
             and ct.category = 'unit'
            where reinforcement.kind = 'transfer'
              and reinforcement.status = 'in_transit'
              and reinforcement.player_id = v_npc.id
              and reinforcement.destination_territory_id = v_target.id
              and (
                v_attack_arrival is null
                or reinforcement.transfer_arrives_at <= v_attack_arrival
              )
          ), 0)
        into v_current_garrison_count;

        if not v_alarm_mode and v_current_garrison_count >= v_target_count then
          continue;
        end if;

        v_sources_used := 0;

        for v_source in
          select
            source.id,
            source.x,
            source.y,
            source.difficulty,
            count(ci.instance_id) as stationed_unit_count
          from territories source
          join card_instances ci
            on ci.stationed_territory_id = source.id
           and ci.owner_id = v_npc.id
           and ci.status = 'stationed'
          join card_templates ct
            on ct.id = ci.template_id
           and ct.category = 'unit'
          where source.owner_id = v_npc.id
            and source.id <> v_target.id
          group by
            source.id,
            source.x,
            source.y,
            source.difficulty
          having count(ci.instance_id) > _npc_garrison_target_size(source.difficulty)
          order by greatest(abs(source.x - v_target.x), abs(source.y - v_target.y)) asc, source.id
        loop
          exit when v_source_limit is not null and v_sources_used >= v_source_limit;

          v_source_base_target := _npc_garrison_target_size(v_source.difficulty);
          v_source_surplus := v_source.stationed_unit_count - v_source_base_target;

          if v_source_surplus <= 0 then
            continue;
          end if;

          if v_alarm_mode then
            v_cards_to_send := v_source_surplus;
          else
            v_shortfall := greatest(v_target_count - v_current_garrison_count, 0);
            exit when v_shortfall <= 0;
            v_cards_to_send := least(v_source_surplus, v_shortfall);
          end if;

          if v_cards_to_send <= 0 then
            continue;
          end if;

          select coalesce(array_agg(card_id order by effective_power desc, card_id), '{}'::uuid[])
          into v_selected_card_ids
          from (
            select
              ci.instance_id as card_id,
              (e.hp + e.str + e.lng + e.def) as effective_power
            from card_instances ci
            join card_templates ct
              on ct.id = ci.template_id
             and ct.category = 'unit'
            cross join lateral _compute_effective_stats(
              ct.base_stats,
              ct.rank,
              v_npc.nation,
              true,
              v_target.castle_rank,
              v_target.village_rank,
              v_target.wall_rank
            ) e
            where ci.owner_id = v_npc.id
              and ci.status = 'stationed'
              and ci.stationed_territory_id = v_source.id
            order by effective_power desc, ci.instance_id
            limit v_cards_to_send
          ) ranked_cards;

          v_selected_count := coalesce(array_length(v_selected_card_ids, 1), 0);

          if v_selected_count = 0 then
            continue;
          end if;

          if v_require_timely_arrival then
            v_transfer_hours := greatest(
              0.25,
              greatest(abs(v_target.x - v_source.x), abs(v_target.y - v_source.y))
              * 0.3
              * least(3.0, greatest(0.4, 5.0 / coalesce(_min_group_speed(v_selected_card_ids), 5.0)))
            ) * (case when v_npc.nation = 'mongol_horde' then 0.75 else 1.0 end);

            v_selected_arrival := now() + (v_transfer_hours || ' hours')::interval;

            if v_selected_arrival > v_attack_arrival then
              continue;
            end if;
          end if;

          perform _start_transfer_core(
            v_npc.id,
            v_source.id,
            v_target.id,
            v_selected_card_ids
          );

          v_sources_used := v_sources_used + 1;
          v_current_garrison_count := v_current_garrison_count + v_selected_count;

          exit when not v_alarm_mode and v_current_garrison_count >= v_target_count;
        end loop;
      end loop;
    exception
      when others then
        raise log 'resolve_due_npc_garrison_reinforcement failed for NPC % (sqlstate %, error %)', v_npc.id, SQLSTATE, SQLERRM;
    end;

    update players
    set npc_garrison_reeval_at = now() + interval '30 minutes'
    where id = v_npc.id;
  end loop;
end;
$$;

create or replace function resolve_due_movements()
returns void
language plpgsql
security definer
set search_path = public
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
  v_loan_arrival record;
  v_due_loan record;
  v_loan_ctx record;
begin
  perform resolve_due_npc_actions();
  perform resolve_due_npc_garrison_reinforcement();
  perform resolve_due_npc_diplomacy();
  perform resolve_due_npc_attack_reevaluations();

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

  for v_loan_arrival in
    with completed_loans as (
      update troop_movements
      set status = 'completed'
      where status = 'in_transit'
        and transfer_arrives_at <= now()
        and kind = 'loan'
      returning id, player_id, destination_territory_id, loan_duration_hours
    )
    select
      cl.id,
      cl.player_id,
      cl.destination_territory_id,
      cl.loan_duration_hours,
      t.owner_id as borrower_id,
      t.x as territory_x,
      t.y as territory_y,
      t.name as territory_name,
      lender.display_name as lender_display_name
    from completed_loans cl
    join territories t on t.id = cl.destination_territory_id
    left join players lender on lender.id = cl.player_id
  loop
    update card_instances ci
    set owner_id = v_loan_arrival.borrower_id,
        loaned_from_id = v_loan_arrival.player_id,
        loan_return_at = now() + (coalesce(v_loan_arrival.loan_duration_hours, 0) || ' hours')::interval
    from troop_movement_units tmu
    where tmu.movement_id = v_loan_arrival.id
      and ci.instance_id = tmu.card_instance_id;

    if v_loan_arrival.borrower_id is not null then
      perform _notify(
        v_loan_arrival.borrower_id,
        'loan_arrived',
        jsonb_build_object(
          'territory_id', v_loan_arrival.destination_territory_id,
          'territory_x', v_loan_arrival.territory_x::integer,
          'territory_y', v_loan_arrival.territory_y::integer,
          'territory_name', v_loan_arrival.territory_name,
          'other_player_id', v_loan_arrival.player_id,
          'other_display_name', coalesce(v_loan_arrival.lender_display_name, 'Neznámý hráč')
        )
      );
    end if;
  end loop;

  update troop_movements
  set status = 'completed'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'loan_return';

  update troop_movements
  set status = 'occupying'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'claim';

  for v_due_loan in
    select ci.instance_id, ci.loaned_from_id
    from card_instances ci
    where ci.status = 'stationed'
      and ci.owner_id is not null
      and ci.loaned_from_id is not null
      and ci.loan_return_at is not null
      and ci.loan_return_at <= now()
    order by ci.loan_return_at, ci.instance_id
    for update of ci skip locked
  loop
    begin
      select *
      into v_loan_ctx
      from _recall_loan_core(v_due_loan.loaned_from_id, v_due_loan.instance_id);

      perform _notify(
        v_loan_ctx.lender_id,
        'loan_returned',
        jsonb_build_object(
          'territory_id', v_loan_ctx.loan_territory_id,
          'territory_x', v_loan_ctx.loan_territory_x::integer,
          'territory_y', v_loan_ctx.loan_territory_y::integer,
          'territory_name', v_loan_ctx.loan_territory_name,
          'other_player_id', v_loan_ctx.borrower_id,
          'other_display_name', coalesce(v_loan_ctx.borrower_display_name, 'Neznámý hráč')
        )
      );
    exception
      when others then
        raise log 'resolve_due_movements failed to auto-recall loaned card % (sqlstate %, error %)', v_due_loan.instance_id, SQLSTATE, SQLERRM;
    end;
  end loop;

  for v_completed_claim in
    update territories
    set owner_id = claim_locked_by,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null,
        battle_locked_by = null,
        is_home = false
    where claim_locked_by is not null
      and claim_occupation_completes_at <= now()
    returning id, owner_id
  loop
    insert into world_events (event_type, payload)
    select
      'territory_claimed',
      jsonb_build_object(
        'player_id', p.id,
        'player_display_name', p.display_name,
        'player_home_x', home.x::integer,
        'player_home_y', home.y::integer,
        'territory_id', t.id,
        'territory_x', t.x::integer,
        'territory_y', t.y::integer
      )
    from players p
    left join territories home
      on home.owner_id = p.id
     and home.is_home = true
    join territories t
      on t.id = v_completed_claim.id
    where p.id = v_completed_claim.owner_id;

    update troop_movements
    set status = 'completed'
    where kind = 'claim'
      and status = 'occupying'
      and destination_territory_id = v_completed_claim.id;
  end loop;
end;
$$;

revoke execute on function _start_transfer_core(uuid, integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function _start_transfer_core(uuid, integer, integer, uuid[]) to service_role;

revoke execute on function resolve_due_npc_garrison_reinforcement() from public, anon, authenticated;
grant execute on function resolve_due_npc_garrison_reinforcement() to service_role;
