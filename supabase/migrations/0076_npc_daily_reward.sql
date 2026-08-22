-- ---------------------------------------------------------------------------
-- 0076_npc_daily_reward.sql
--
-- Adds an automated once-per-day daily card reward pass for NPC kingdoms and
-- wires it into the lazy resolve_due_movements() pipeline.
-- ---------------------------------------------------------------------------

create or replace function resolve_due_npc_daily_rewards()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_npc record;
  v_claimed_at timestamptz;
  v_today timestamptz;
  v_new_streak integer;
  v_template_id text;
begin
  for v_npc in
    select id, daily_reward_streak, last_daily_reward_at
    from players
    where is_npc = true
      and (
        last_daily_reward_at is null
        or date_trunc('day', now()) > date_trunc('day', last_daily_reward_at)
      )
    order by id
    for update skip locked
  loop
    begin
      v_claimed_at := clock_timestamp();
      v_today := date_trunc('day', v_claimed_at);

      if v_npc.last_daily_reward_at is not null
         and date_trunc('day', v_npc.last_daily_reward_at) = v_today then
        continue;
      end if;

      if v_npc.last_daily_reward_at is not null
         and date_trunc('day', v_npc.last_daily_reward_at) = v_today - interval '1 day' then
        v_new_streak := coalesce(v_npc.daily_reward_streak, 0) + 1;
      else
        v_new_streak := 1;
      end if;

      update players
      set daily_reward_streak = v_new_streak,
          last_daily_reward_at = v_claimed_at
      where id = v_npc.id;

      select id into v_template_id
      from card_templates
      where category = 'unit'
        and rank = 'common'
      order by random()
      limit 1;

      if v_template_id is null then
        raise exception 'no common unit card template found';
      end if;

      insert into card_instances (template_id, owner_id, stationed_territory_id, status)
      values (v_template_id, v_npc.id, null, 'stationed');

      if mod(v_new_streak, 7) = 0 then
        select id into v_template_id
        from card_templates
        where category = 'unit'
          and rank = 'uncommon'
        order by random()
        limit 1;

        if v_template_id is null then
          raise exception 'no uncommon unit card template found';
        end if;

        insert into card_instances (template_id, owner_id, stationed_territory_id, status)
        values (v_template_id, v_npc.id, null, 'stationed');
      end if;
    exception
      when others then
        raise log 'resolve_due_npc_daily_rewards failed for NPC % (sqlstate %, error %)', v_npc.id, SQLSTATE, SQLERRM;
    end;
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
  perform resolve_due_npc_daily_rewards();
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

revoke execute on function resolve_due_npc_daily_rewards() from public, anon, authenticated;
grant execute on function resolve_due_npc_daily_rewards() to service_role;
