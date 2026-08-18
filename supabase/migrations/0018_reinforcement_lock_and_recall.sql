-- Backlog #23 + #14 (narrow scope): reinforcement lock + attack recall.
--
-- 1. New shared helper `_recall_movement_to_origin(movement_id)`: turns any
--    in-transit movement around (swaps origin/destination, converts it to
--    kind='transfer' so the existing generic transfer-arrival landing logic
--    handles it with no further changes), taking exactly as long to return
--    as it had already traveled.
-- 2. `start_transfer()` (redefined from 0002_territories.sql): rejects
--    sending reinforcements to a territory that already has an unresolved
--    battle (status not in ('resolved', 'expired')).
-- 3. `resolve_due_movements()` (redefined from 0016_shorten_ready_deadline.sql,
--    its latest definition): the instant a PvP battle is created (the two
--    branches where the attacker actually fights a player, not an NPC or a
--    walkover claim), any other in-transit reinforcement transfer the
--    defender already had heading to that same territory is recalled via
--    `_recall_movement_to_origin`.
-- 4. New `recall_attack(movement_id)` RPC: lets the attacker call off their
--    own attack while it's still in transit (before it arrives and a battle
--    is created). Once it has arrived, it's too late — recalling an
--    already-arrived/awaiting_ready battle is out of scope here.
--
-- See docs/superpowers/specs/2026-08-19-reinforcement-lock-recall-design.md
-- for the full design rationale.

create or replace function _recall_movement_to_origin(p_movement_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_origin integer;
  v_destination integer;
  v_started_at timestamptz;
  v_elapsed_hours numeric;
begin
  select origin_territory_id, destination_territory_id, started_at
  into v_origin, v_destination, v_started_at
  from troop_movements
  where id = p_movement_id
  for update;

  v_elapsed_hours := greatest(0, extract(epoch from (now() - v_started_at)) / 3600.0);

  update troop_movements
  set kind = 'transfer',
      origin_territory_id = v_destination,
      destination_territory_id = v_origin,
      started_at = now(),
      transfer_arrives_at = now() + (v_elapsed_hours || ' hours')::interval
  where id = p_movement_id;
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
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  origin_x smallint; origin_y smallint;
  dest_x smallint; dest_y smallint;
  distance numeric;
  transfer_hrs numeric;
  matching_count integer;
  arrives_at timestamptz;
  movement_id uuid;
begin
  perform resolve_due_movements();

  if card_instance_ids is null or array_length(card_instance_ids, 1) is null then
    raise exception 'card_instance_ids must be non-empty';
  end if;

  select nation into caller_nation from players where id = caller;

  select x, y into origin_x, origin_y
  from territories where id = origin_territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own origin_territory_id';
  end if;

  select x, y into dest_x, dest_y
  from territories where id = destination_territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own destination_territory_id (use start_claim instead)';
  end if;

  if exists (
    select 1 from battles
    where territory_id = destination_territory_id
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'cannot reinforce a territory with an unresolved battle';
  end if;

  select count(*) into matching_count
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = any(card_instance_ids)
    and ci.owner_id = caller
    and ci.stationed_territory_id = origin_territory_id
    and ci.status = 'stationed'
    and ct.category = 'unit';
  if matching_count <> array_length(card_instance_ids, 1) then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  distance := greatest(abs(dest_x - origin_x), abs(dest_y - origin_y));
  transfer_hrs := greatest(0.25, distance * 0.3)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);

  -- Row-lock the selected instances and re-verify immediately before writing.
  perform instance_id from card_instances
  where instance_id = any(card_instance_ids)
    and owner_id = caller
    and stationed_territory_id = origin_territory_id
    and status = 'stationed'
  for update;
  if not found then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  arrives_at := now() + (transfer_hrs || ' hours')::interval;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (caller, 'transfer', origin_territory_id, destination_territory_id, arrives_at)
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);
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
  arrival_card_instance_ids uuid[];
  occupation_hrs numeric;
  effective_count integer;
  v_completed_claim record;
  v_recall record;
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

      -- Backlog #23: recall any of the defender's reinforcements still
      -- in transit to this same territory — the siege has now begun.
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

      -- Backlog #23: same recall as above, keyed by the territory's
      -- current claimant instead of an owner.
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

create or replace function recall_attack(p_movement_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_movement record;
begin
  perform resolve_due_movements();
  perform resolve_due_battles();

  select * into v_movement from troop_movements where id = p_movement_id for update;
  if not found then
    raise exception 'movement not found';
  end if;
  if v_movement.player_id <> caller then
    raise exception 'caller does not own this movement';
  end if;
  if v_movement.kind <> 'attack' then
    raise exception 'only an in-transit attack can be recalled';
  end if;
  if v_movement.status <> 'in_transit' then
    raise exception 'this attack has already arrived and cannot be recalled';
  end if;

  perform _recall_movement_to_origin(p_movement_id);

  update territories
  set battle_locked_by = null
  where id = v_movement.destination_territory_id and battle_locked_by = caller;
end;
$$;
