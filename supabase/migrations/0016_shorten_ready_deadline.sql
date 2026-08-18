-- Shorten awaiting_ready battle timeout to 24 hours (backlog #24)
--
-- Redefines resolve_due_movements() from 0011_claim_xp.sql without changing
-- any movement/battle logic except the three ready_deadline durations for newly
-- created battles, which now use 24 hours instead of 10 days.
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
  arrival_card_instance_ids uuid[];
  occupation_hrs numeric;
  effective_count integer;
  v_completed_claim record;
begin
  -- Step 1: attack arrival. Like a transfer, the cards physically land
  -- first; combat/claim classification happens only after re-reading the
  -- territory's current state at arrival time.
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

    if target_owner is not null and target_owner <> arrival.player_id then
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

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;
    elsif target_owner is null
      and target_claim_locked_by is not null
      and target_claim_locked_by <> arrival.player_id then
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

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;
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

      -- Safe forward reference: _start_next_round is appended later in
      -- this same migration and resolves at runtime, not function-creation
      -- time.
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

      -- Safe forward reference: the shared claim-occupation helper is
      -- defined later in this migration.
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

  -- Step 1: transfer/claim arrival. For 'transfer', complete the trip
  -- outright. For 'claim', flip to 'occupying' — its
  -- claim_occupation_completes_at was already precomputed at claim-start.
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

  -- Step 2: occupation completion. Flip ownership, clear the claim lock,
  -- and complete the corresponding troop_movements row. Peaceful empty-
  -- territory claims award only 15 XP here, intentionally below the
  -- 50-XP battle-win reward because they cost time but carry no combat risk.
  for v_completed_claim in
    select t.claim_locked_by
    from territories t
    where t.claim_occupation_completes_at <= now()
      and t.claim_locked_by is not null
    for update
  loop
    perform _award_xp(v_completed_claim.claim_locked_by, 15);
  end loop;

  update troop_movements tm
  set status = 'completed'
  from territories t
  where tm.kind = 'claim'
    and tm.status = 'occupying'
    and tm.destination_territory_id = t.id
    and t.claim_occupation_completes_at <= now()
    and t.claim_locked_by is not null;

  update territories
  set owner_id = claim_locked_by,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null
  where claim_occupation_completes_at <= now()
    and claim_locked_by is not null;
end;
$$;

