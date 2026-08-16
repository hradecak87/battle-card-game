-- Multi-Army RTS Battle — schema migration (design spec §3.1-§3.4)
--
-- NOT YET APPLIED: no live Supabase project has this migration applied yet.
-- Once the user gives explicit go-ahead, apply with `supabase db push` (or
-- paste into the SQL editor) after 0002_territories.sql. This file is written
-- and reviewed now so the data model is locked in and version-controlled
-- ahead of time. See supabase/migrations/0003_battles.verification.sql
-- for the manual smoke-test checklist to run immediately after applying.

-- ---------------------------------------------------------------------
-- 1. territories / troop_movements amendments (§3.1) — battle-lock state
--    plus the new 'attack' troop movement kind.
-- ---------------------------------------------------------------------
alter table territories
  add column battle_locked_by uuid references players(id);

-- NOTE: If the live DB ever generated a different check-constraint name
-- here, adjust this drop statement before applying the migration.
alter table troop_movements drop constraint troop_movements_kind_check;
alter table troop_movements add constraint troop_movements_kind_check
  check (kind in ('transfer', 'claim', 'attack'));

-- ---------------------------------------------------------------------
-- 2. battles (§3.1) — one row per attack/contested-claim battle.
-- ---------------------------------------------------------------------
-- `winner_id` is deliberately not a separate column — the winning player
-- (if any; an NPC defender has none) is always derivable as
-- `case winner_side when 'attacker' then attacker_id when 'defender' then
-- defender_id end`, and storing it separately would risk it drifting out
-- of sync.
create table battles (
  id uuid primary key default gen_random_uuid(),
  territory_id integer not null references territories(id),
  attacker_id uuid not null references players(id),
  defender_id uuid references players(id),      -- null = NPC-garrisoned target
  is_home_target boolean not null default false,
  movement_id uuid not null references troop_movements(id),
  status text not null check (status in ('awaiting_ready','active','resolved','expired')),
  attacker_ready_at timestamptz,
  defender_ready_at timestamptz,
  ready_deadline timestamptz not null,          -- arrival + 10 days
  current_round integer not null default 0,
  round_deadline timestamptz,                    -- set once status='active'; null otherwise
  winner_side text check (winner_side in ('attacker','defender')),  -- null until resolved
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. battle_attacker_roster (§3.2) — attacker's fixed committed pool.
-- ---------------------------------------------------------------------
create table battle_attacker_roster (
  battle_id uuid not null references battles(id),
  card_instance_id uuid not null references card_instances(instance_id),
  primary key (battle_id, card_instance_id)
);

-- ---------------------------------------------------------------------
-- 4. battle_rounds (§3.3) — audit trail of every resolved/skipped round.
-- ---------------------------------------------------------------------
create table battle_rounds (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references battles(id),
  round_number integer not null,
  attacker_card_instance_id uuid references card_instances(instance_id),
  defender_card_instance_id uuid references card_instances(instance_id),
  winner_card_instance_id uuid references card_instances(instance_id),
  auto_picked boolean not null default false,   -- defender's pick timed out
  skipped boolean not null default false,       -- no available card for whichever side was due
  resolved_at timestamptz not null default now(),
  unique (battle_id, round_number)
);

-- ---------------------------------------------------------------------
-- 5. battle_unit_rest (§3.4) — per-battle cooldown tracking.
-- ---------------------------------------------------------------------
create table battle_unit_rest (
  battle_id uuid not null references battles(id),
  card_instance_id uuid not null references card_instances(instance_id),
  resting_until_round integer not null,
  primary key (battle_id, card_instance_id)
);

-- ---------------------------------------------------------------------
-- 6. Indexes (§3.1) — ready/round deadlines plus live territory lookups.
-- ---------------------------------------------------------------------
create index battles_ready_deadline_idx on battles (ready_deadline)
  where status = 'awaiting_ready';
create index battles_round_deadline_idx on battles (round_deadline)
  where status = 'active';
create index battles_territory_idx on battles (territory_id)
  where status not in ('resolved','expired');

-- ---------------------------------------------------------------------
-- 7. Row-Level Security (§3.6) — same convention as 0002_territories.sql:
--    public read-all, no direct write policies.
-- ---------------------------------------------------------------------
alter table battles enable row level security;
alter table battle_attacker_roster enable row level security;
alter table battle_rounds enable row level security;
alter table battle_unit_rest enable row level security;

create policy battles_select_all on battles for select using (true);
create policy battle_attacker_roster_select_all on battle_attacker_roster for select using (true);
create policy battle_rounds_select_all on battle_rounds for select using (true);
create policy battle_unit_rest_select_all on battle_unit_rest for select using (true);

-- ---------------------------------------------------------------------
-- 8. declare_attack() + subsystem #3 RPC amendments (§3.6).
-- ---------------------------------------------------------------------
create or replace function declare_attack(
  origin_territory_id integer,
  target_territory_id integer,
  card_instance_ids uuid[]
)
returns uuid
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  origin_x smallint; origin_y smallint;
  target_x smallint; target_y smallint;
  target_owner uuid;
  target_claim_locked_by uuid;
  target_battle_locked_by uuid;
  target_is_home boolean;
  distance numeric;
  transfer_hrs numeric;
  effective_count integer;
  matching_count integer;
  arrives_at timestamptz;
  movement_id uuid;
begin
  perform resolve_due_battles();
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

  select x, y, owner_id, claim_locked_by, battle_locked_by, is_home
  into target_x, target_y, target_owner, target_claim_locked_by, target_battle_locked_by, target_is_home
  from territories where id = target_territory_id;
  if not found then
    raise exception 'target territory is not available to attack';
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

  if target_owner = caller or target_claim_locked_by = caller then
    raise exception 'caller cannot attack their own owned/claimed territory';
  end if;
  if target_battle_locked_by is not null then
    raise exception 'target territory already has a battle in progress';
  end if;

  if not target_is_home then
    select count(*) into effective_count
    from territories where owner_id = caller or claim_locked_by = caller;
    if effective_count >= 32 then
      raise exception 'territory ownership cap (32) reached';
    end if;
  end if;

  distance := greatest(abs(target_x - origin_x), abs(target_y - origin_y));
  transfer_hrs := greatest(0.25, distance * 0.3)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);

  select x, y, owner_id, claim_locked_by, battle_locked_by, is_home
  into target_x, target_y, target_owner, target_claim_locked_by, target_battle_locked_by, target_is_home
  from territories
  where id = target_territory_id
  for update;
  if not found then
    raise exception 'target territory is not available to attack';
  end if;
  if target_owner = caller or target_claim_locked_by = caller then
    raise exception 'caller cannot attack their own owned/claimed territory';
  end if;
  if target_battle_locked_by is not null then
    raise exception 'target territory already has a battle in progress';
  end if;

  if not target_is_home then
    select count(*) into effective_count
    from territories where owner_id = caller or claim_locked_by = caller;
    if effective_count >= 32 then
      raise exception 'territory ownership cap (32) reached';
    end if;
  end if;

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
  values (caller, 'attack', origin_territory_id, target_territory_id, arrives_at)
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);

  update territories
  set battle_locked_by = caller
  where id = target_territory_id;

  return movement_id;
end;
$$;

-- start_transfer intentionally needs no battle_locked_by amendment: reinforcing an owned territory under attack remains allowed per spec §3.6.

-- NOTE: start_claim's canonical body lives further down in this file
-- (Task 9 section), where it's refactored to share its occupation-timer
-- math with resolve_due_movements()'s "now truly empty" fallback via the
-- _claim_occupation_hours() helper. Only one `create or replace function
-- start_claim` definition exists in this migration; see there for the
-- amendments Task 8 requires (resolve_due_battles() first-step call, NPC
-- garrison + battle_locked_by destination-availability checks).

create or replace function cancel_claim(territory_id integer)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  origin_id integer;
  movement_id uuid;
begin
  perform resolve_due_battles();
  perform resolve_due_movements();

  if exists (
    select 1
    from battles
    where battles.territory_id = territory_id
      and defender_id = caller
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'cannot cancel a claim while defending an active battle on this territory';
  end if;

  perform id from territories where id = territory_id and claim_locked_by = caller;
  if not found then
    raise exception 'caller is not the current claimant of this territory';
  end if;

  select tm.id, tm.origin_territory_id into movement_id, origin_id
  from troop_movements tm
  where tm.destination_territory_id = territory_id
    and tm.kind = 'claim'
    and tm.status in ('in_transit', 'occupying')
  order by tm.started_at desc
  limit 1;
  if movement_id is null then
    raise exception 'no active claim movement found for this territory';
  end if;

  update troop_movements
  set status = 'cancelled', cancelled_at = now()
  where id = movement_id;

  update card_instances
  set status = 'stationed', stationed_territory_id = origin_id
  where instance_id in (
    select tmu.card_instance_id from troop_movement_units tmu where tmu.movement_id = movement_id
  );

  update territories
  set claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null
  where id = territory_id;
end;
$$;

create or replace function build_structure(territory_id integer, card_instance_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  tmpl_category text;
  tmpl_rank text;
  existing_rank text;
begin
  perform resolve_due_battles();
  perform resolve_due_movements();

  if exists (
    select 1 from territories where id = territory_id and battle_locked_by is not null
  ) then
    raise exception 'territory is currently battle-locked';
  end if;

  perform id from territories where id = territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own this territory';
  end if;

  select ct.category, ct.rank into tmpl_category, tmpl_rank
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = card_instance_id and ci.owner_id = caller;
  if not found then
    raise exception 'caller does not own this card instance';
  end if;
  if tmpl_category not in ('castle', 'village') then
    raise exception 'card instance is not a Castle/Village structure card';
  end if;

  if tmpl_category = 'castle' then
    select castle_rank into existing_rank from territories where id = territory_id;
  else
    select village_rank into existing_rank from territories where id = territory_id;
  end if;
  if existing_rank is not null then
    raise exception 'territory already has a % structure', tmpl_category;
  end if;

  if tmpl_category = 'castle' then
    update territories set castle_rank = tmpl_rank where id = territory_id;
  else
    update territories set village_rank = tmpl_rank where id = territory_id;
  end if;

  delete from card_instances where instance_id = card_instance_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Task 9 — attack-arrival handling in resolve_due_movements(), plus
--    shared claim occupation timing reused by start_claim().
-- ---------------------------------------------------------------------
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
          now() + interval '10 days'
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
          now() + interval '10 days'
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
          now() + interval '10 days',
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
  -- and complete the corresponding troop_movements row.
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

create or replace function _claim_occupation_hours(
  claimant_id uuid,
  destination_territory_id integer,
  card_instance_ids uuid[]
)
returns numeric
language plpgsql
security definer
as $$
declare
  claimant_nation nation_id;
  dest_difficulty smallint;
  power numeric;
  difficulty_mult numeric;
begin
  select nation into claimant_nation from players where id = claimant_id;
  select difficulty into dest_difficulty from territories where id = destination_territory_id;

  power := _army_power(card_instance_ids);
  difficulty_mult := case dest_difficulty
    when 1 then 1.0 when 2 then 1.5 when 3 then 2.25 when 4 then 3.4 when 5 then 5.0 end;

  return greatest(10, (150 * difficulty_mult) / sqrt(power))
    * (case when claimant_nation = 'scandinavia' then 0.8 else 1.0 end);
end;
$$;

create or replace function start_claim(
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
  dest_difficulty smallint;
  dest_owner uuid; dest_locked_by uuid; dest_battle_locked_by uuid;
  distance numeric;
  power numeric;
  difficulty_mult numeric;
  transfer_hrs numeric;
  occupation_hrs numeric;
  effective_count integer;
  matching_count integer;
  arrives_at timestamptz;
  occupies_at timestamptz;
  movement_id uuid;
begin
  perform resolve_due_battles();
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

  select x, y, difficulty, owner_id, claim_locked_by, battle_locked_by
  into dest_x, dest_y, dest_difficulty, dest_owner, dest_locked_by, dest_battle_locked_by
  from territories where id = destination_territory_id;
  if dest_owner is not null or dest_locked_by is not null or dest_battle_locked_by is not null then
    raise exception 'destination territory is not available to claim';
  end if;
  if exists (
    select 1
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = destination_territory_id
      and ci.owner_id is null
      and ct.category = 'unit'
  ) then
    raise exception 'destination territory is not available to claim';
  end if;

  select count(*) into effective_count
  from territories where owner_id = caller or claim_locked_by = caller;
  if effective_count >= 32 then
    raise exception 'territory ownership cap (32) reached';
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
  occupation_hrs := _claim_occupation_hours(caller, destination_territory_id, card_instance_ids);

  -- Row-lock the destination and re-verify immediately before writing.
  perform id from territories
  where id = destination_territory_id
    and owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = destination_territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
    )
  for update;
  if not found then
    raise exception 'destination territory is not available to claim';
  end if;

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
  occupies_at := arrives_at + (occupation_hrs || ' hours')::interval;

  update territories
  set claim_locked_by = caller,
      claim_started_at = now(),
      claim_transfer_arrives_at = arrives_at,
      claim_occupation_completes_at = occupies_at
  where id = destination_territory_id;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (caller, 'claim', origin_territory_id, destination_territory_id, arrives_at)
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);
end;
$$;

-- ===========================================================================
-- Chunk 5: resolve_due_battles() — the core lazy-resolution engine
-- (Tasks 10-12). Combat-stat computation and NPC AI are ported directly
-- from lib/battles/effectiveStats.ts, lib/cards/combat.ts, and
-- lib/battles/npcAi.ts (see lib/battles/effectiveStats.parity.test.ts for
-- the parity safety net between the TS and SQL implementations).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- _compute_effective_stats(base_stats, rank, nation, is_defender,
--   castle_rank, village_rank): mirrors computeEffectiveStats exactly —
-- 1) rank scaling (rounded immediately, like applyRank), 2) structure
-- bonus (defender side only), 3) nation perk, 4) a single final rounding.
-- p_nation may be null (NPC candidate, no nation perk).
-- ---------------------------------------------------------------------------
create or replace function _compute_effective_stats(
  p_base_stats jsonb,
  p_rank text,
  p_nation nation_id,
  p_is_defender boolean,
  p_castle_rank text,
  p_village_rank text
) returns table (hp integer, str integer, lng integer, def integer)
language plpgsql
security definer
as $$
declare
  v_mult numeric;
  v_hp numeric; v_str numeric; v_lng numeric; v_def numeric;
  v_def_bonus_pct numeric := 0;
  v_atk_bonus_pct numeric := 0;
begin
  v_mult := case p_rank
    when 'common' then 1.0 when 'uncommon' then 1.15
    when 'rare' then 1.35 when 'epic' then 1.6 when 'legend' then 2.0 end;

  -- Step 1: rank scaling, rounded immediately (mirrors applyRank).
  v_hp := greatest(0, round((p_base_stats->>'hp')::numeric * v_mult));
  v_str := greatest(0, round((p_base_stats->>'str')::numeric * v_mult));
  v_lng := greatest(0, round((p_base_stats->>'lng')::numeric * v_mult));
  v_def := greatest(0, round((p_base_stats->>'def')::numeric * v_mult));

  -- Step 2: structure bonus, defender side only (unrounded intermediate).
  if p_is_defender then
    v_def_bonus_pct := coalesce(case p_village_rank
        when 'common' then 10 when 'uncommon' then 20 when 'rare' then 35
        when 'epic' then 55 when 'legend' then 80 else 0 end, 0)
      + coalesce(case p_castle_rank
        when 'common' then 20 when 'uncommon' then 35 when 'rare' then 55
        when 'epic' then 80 when 'legend' then 120 else 0 end, 0);

    if p_castle_rank is not null then
      v_atk_bonus_pct := case p_castle_rank
        when 'common' then 10 when 'uncommon' then 20 when 'rare' then 35
        when 'epic' then 55 when 'legend' then 80 else 0 end;
      v_str := v_str * (1 + v_atk_bonus_pct / 100.0);
      v_lng := v_lng * (1 + v_atk_bonus_pct / 100.0);
    end if;

    v_def := v_def * (1 + v_def_bonus_pct / 100.0);
  end if;

  -- Step 3: nation perk (unrounded intermediate). Null nation (NPC) = no perk.
  case p_nation
    when 'england' then v_lng := v_lng * 1.15;
    when 'francia' then v_str := v_str * 1.15;
    when 'hre' then v_def := v_def * 1.15;
    when 'byzantium' then v_hp := v_hp * 1.15;
    else null; -- mongol_horde, scandinavia, or null (NPC): no combat perk
  end case;

  -- Step 4: single final rounding.
  return query select
    greatest(0, round(v_hp))::integer,
    greatest(0, round(v_str))::integer,
    greatest(0, round(v_lng))::integer,
    greatest(0, round(v_def))::integer;
end;
$$;

-- ---------------------------------------------------------------------------
-- _finalize_battle(battle_id, winner_side): shared capture/blocked
-- finalization logic used both by Task 10's ready-timeout outcomes and
-- Task 12's win-condition outcomes (spec §2/§3.6's uniform rule: "send
-- home whatever the loser side currently owns at the territory").
-- winner_side is 'attacker' | 'defender' | null (null = expired, neither
-- side ever readied).
-- ---------------------------------------------------------------------------
create or replace function _finalize_battle(
  p_battle_id uuid,
  p_winner_side text
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_origin_territory_id integer;
  v_capture boolean := false;
  v_owned_count integer;
  v_defender_home_id integer;
  v_mover_nation nation_id;
  v_moving_ids uuid[];
  v_from_x smallint; v_from_y smallint;
  v_to_x smallint; v_to_y smallint;
  v_distance numeric;
  v_transfer_hrs numeric;
  v_arrives_at timestamptz;
  v_movement_id uuid;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  select origin_territory_id into v_origin_territory_id
  from troop_movements where id = v_battle.movement_id;

  if p_winner_side = 'attacker' then
    select count(*) into v_owned_count
    from territories where owner_id = v_battle.attacker_id or claim_locked_by = v_battle.attacker_id;
    v_capture := (not v_battle.is_home_target) and v_owned_count < 32;
  end if;

  if v_capture then
    update territories
    set owner_id = v_battle.attacker_id,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null,
        battle_locked_by = null
    where id = v_battle.territory_id;

    -- Send home any lingering defender-owned cards still stationed there.
    -- Only relevant for a no-combat outright win (Task 10) — a combat win
    -- (Task 12) guarantees the defender/NPC has zero cards left there, so
    -- this is a harmless no-op in that case. NPC defender_id is null and
    -- NPC battles never reach this no-combat path, so this is PvP-only.
    if v_battle.defender_id is not null then
      select array_agg(instance_id) into v_moving_ids
      from card_instances
      where owner_id = v_battle.defender_id
        and stationed_territory_id = v_battle.territory_id;

      if v_moving_ids is not null and array_length(v_moving_ids, 1) > 0 then
        select id into v_defender_home_id
        from territories where owner_id = v_battle.defender_id and is_home;

        select nation into v_mover_nation from players where id = v_battle.defender_id;
        select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;
        select x, y into v_to_x, v_to_y from territories where id = v_defender_home_id;
        v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
        v_transfer_hrs := greatest(0.25, v_distance * 0.3)
          * (case when v_mover_nation = 'mongol_horde' then 0.75 else 1.0 end);
        v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

        insert into troop_movements
          (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
        values (v_battle.defender_id, 'transfer', v_battle.territory_id, v_defender_home_id, v_arrives_at)
        returning id into v_movement_id;

        insert into troop_movement_units (movement_id, card_instance_id)
        select v_movement_id, unnest(v_moving_ids);

        update card_instances set status = 'in_transit'
        where instance_id = any(v_moving_ids);
      end if;
    end if;
  else
    -- Not captured (defender/expired win, or is_home_target/cap-blocked
    -- attacker win): territory ownership is unchanged, only the lock clears.
    update territories set battle_locked_by = null where id = v_battle.territory_id;

    -- Send home whatever the attacker currently owns at the territory —
    -- the whole untouched roster for a no-combat outcome, or roster
    -- survivors plus any mid-battle captures for a combat outcome.
    select array_agg(instance_id) into v_moving_ids
    from card_instances
    where owner_id = v_battle.attacker_id
      and stationed_territory_id = v_battle.territory_id;

    if v_moving_ids is not null and array_length(v_moving_ids, 1) > 0 then
      select nation into v_mover_nation from players where id = v_battle.attacker_id;
      select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;
      select x, y into v_to_x, v_to_y from territories where id = v_origin_territory_id;
      v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
      v_transfer_hrs := greatest(0.25, v_distance * 0.3)
        * (case when v_mover_nation = 'mongol_horde' then 0.75 else 1.0 end);
      v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

      insert into troop_movements
        (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
      values (v_battle.attacker_id, 'transfer', v_battle.territory_id, v_origin_territory_id, v_arrives_at)
      returning id into v_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id)
      select v_movement_id, unnest(v_moving_ids);

      update card_instances set status = 'in_transit'
      where instance_id = any(v_moving_ids);
    end if;
  end if;

  update battles
  set status = case when p_winner_side is null then 'expired' else 'resolved' end,
      winner_side = p_winner_side,
      resolved_at = now()
  where id = p_battle_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- _pick_npc_defender_card(battle_id, attacker_card, current_round):
-- ports npcAi.ts's pickNpcDefenderCard exactly — first candidate that
-- would beat the attacker's card (resolveDuel === 'defender'), else a
-- random candidate. Raises if called with zero candidates (mirrors the
-- TS function's contract); callers (`_start_next_round`) must only call
-- this when at least one NPC card is available.
-- ---------------------------------------------------------------------------
create or replace function _pick_npc_defender_card(
  p_battle_id uuid,
  p_attacker_card uuid,
  p_current_round integer
) returns uuid
language plpgsql
security definer
as $$
declare
  v_territory_id integer;
  v_castle_rank text;
  v_village_rank text;
  v_atk_rank text; v_atk_base jsonb; v_atk_owner uuid; v_atk_nation nation_id;
  v_atk_eff record;
  v_candidate record;
  v_cand_eff record;
  v_atk_dmg numeric; v_def_dmg numeric;
  v_ttk_a numeric; v_ttk_d numeric;
  v_first uuid;
  v_winner uuid;
  v_candidates uuid[];
begin
  select territory_id into v_territory_id from battles where id = p_battle_id;
  select castle_rank, village_rank into v_castle_rank, v_village_rank
  from territories where id = v_territory_id;

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select * into v_atk_eff from _compute_effective_stats(
    v_atk_base, v_atk_rank, v_atk_nation, false, null, null);

  for v_candidate in
    select ci.instance_id, ct.rank, ct.base_stats
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_territory_id
      and ci.owner_id is null and ct.category = 'unit'
      and not exists (
        select 1 from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
          and bur.resting_until_round >= p_current_round
      )
    order by ci.instance_id
  loop
    if v_first is null then
      v_first := v_candidate.instance_id;
    end if;

    select * into v_cand_eff from _compute_effective_stats(
      v_candidate.base_stats, v_candidate.rank, null, true, v_castle_rank, v_village_rank);

    v_atk_dmg := greatest(0, greatest(v_atk_eff.str, v_atk_eff.lng) - v_cand_eff.def);
    v_def_dmg := greatest(0, greatest(v_cand_eff.str, v_cand_eff.lng) - v_atk_eff.def);
    v_ttk_a := case when v_atk_dmg > 0 then v_cand_eff.hp::numeric / v_atk_dmg else 'infinity'::numeric end;
    v_ttk_d := case when v_def_dmg > 0 then v_atk_eff.hp::numeric / v_def_dmg else 'infinity'::numeric end;

    -- Candidate (defender) wins the duel iff NOT (attacker strictly faster).
    if not (v_ttk_a < v_ttk_d) then
      v_winner := v_candidate.instance_id;
      exit;
    end if;
  end loop;

  if v_winner is not null then
    return v_winner;
  end if;

  if v_first is null then
    raise exception 'pick_npc_defender_card requires at least one candidate';
  end if;

  select array_agg(ci.instance_id) into v_candidates
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.stationed_territory_id = v_territory_id
    and ci.owner_id is null and ct.category = 'unit'
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and bur.resting_until_round >= p_current_round
    );
  return v_candidates[1 + floor(random() * array_length(v_candidates, 1))::int];
end;
$$;

-- ---------------------------------------------------------------------------
-- _resolve_round(battle_id, attacker_card, defender_card, auto_picked):
-- Resolves the currently-pending round (inserted by _start_next_round with
-- attacker_card_instance_id set, defender_card_instance_id still null).
-- CRITICAL ORDERING: increments battles.current_round FIRST, then computes
-- resting_until_round from the now-incremented value (current_round + 2) —
-- a card fighting in round 1 must end up resting_until_round = 3, matching
-- lib/battles/restCooldown.ts's nextRestingUntilRound(1) === 3.
-- ---------------------------------------------------------------------------
create or replace function _resolve_round(
  p_battle_id uuid,
  p_attacker_card uuid,
  p_defender_card uuid,
  p_auto_picked boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_round record;
  v_next_round integer;
  v_atk_rank text; v_atk_base jsonb; v_atk_owner uuid; v_atk_nation nation_id;
  v_def_rank text; v_def_base jsonb; v_def_owner uuid; v_def_nation nation_id;
  v_castle_rank text; v_village_rank text;
  v_atk_eff record;
  v_def_eff record;
  v_atk_dmg numeric; v_def_dmg numeric;
  v_ttk_attacker_wins numeric; v_ttk_defender_wins numeric;
  v_winner_card uuid; v_loser_card uuid; v_winner_owner uuid;
  v_resting_until integer;
begin
  -- Row-lock the battle first (mirrors start_claim's convention).
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  v_next_round := v_battle.current_round + 1;

  -- Row-lock and re-check the pending round immediately after acquiring
  -- the battle lock — closes the race where a concurrent auto-pick and an
  -- explicit pick could both try to resolve the same round.
  select * into v_round
  from battle_rounds
  where battle_id = p_battle_id and round_number = v_next_round
  for update;
  if not found then
    raise exception 'no pending round % for battle %', v_next_round, p_battle_id;
  end if;
  if v_round.defender_card_instance_id is not null or v_round.skipped then
    -- Already resolved by a concurrent caller; nothing more to do.
    return;
  end if;

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select ct.rank, ct.base_stats, ci.owner_id into v_def_rank, v_def_base, v_def_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_defender_card;
  select nation into v_def_nation from players where id = v_def_owner; -- null for NPC (v_def_owner null)

  select castle_rank, village_rank into v_castle_rank, v_village_rank
  from territories where id = v_battle.territory_id;

  select * into v_atk_eff from _compute_effective_stats(
    v_atk_base, v_atk_rank, v_atk_nation, false, null, null);
  select * into v_def_eff from _compute_effective_stats(
    v_def_base, v_def_rank, v_def_nation, true, v_castle_rank, v_village_rank);

  v_atk_dmg := greatest(0, greatest(v_atk_eff.str, v_atk_eff.lng) - v_def_eff.def);
  v_def_dmg := greatest(0, greatest(v_def_eff.str, v_def_eff.lng) - v_atk_eff.def);

  v_ttk_attacker_wins := case when v_atk_dmg > 0 then v_def_eff.hp::numeric / v_atk_dmg else 'infinity'::numeric end;
  v_ttk_defender_wins := case when v_def_dmg > 0 then v_atk_eff.hp::numeric / v_def_dmg else 'infinity'::numeric end;

  if v_ttk_attacker_wins < v_ttk_defender_wins then
    v_winner_card := p_attacker_card;
    v_loser_card := p_defender_card;
  else
    v_winner_card := p_defender_card;
    v_loser_card := p_attacker_card;
  end if;

  select owner_id into v_winner_owner from card_instances where instance_id = v_winner_card;

  -- Card capture: the loser's card flips ownership to the winner's
  -- current owner immediately (spec §2). If the winner is an NPC card,
  -- v_winner_owner is null, so the captured card becomes ownerless (an
  -- NPC-garrison card) too.
  update card_instances set owner_id = v_winner_owner where instance_id = v_loser_card;

  update battle_rounds
  set defender_card_instance_id = p_defender_card,
      winner_card_instance_id = v_winner_card,
      auto_picked = p_auto_picked,
      resolved_at = now()
  where battle_id = p_battle_id and round_number = v_next_round;

  -- CRITICAL: increment current_round BEFORE computing resting_until_round.
  update battles set current_round = v_next_round where id = p_battle_id;
  v_resting_until := v_next_round + 2;

  insert into battle_unit_rest (battle_id, card_instance_id, resting_until_round)
  values (p_battle_id, p_attacker_card, v_resting_until),
         (p_battle_id, p_defender_card, v_resting_until)
  on conflict (battle_id, card_instance_id)
  do update set resting_until_round = excluded.resting_until_round;
end;
$$;

-- ---------------------------------------------------------------------------
-- _start_next_round(battle_id): picks a random available attacker card,
-- checks defender-side availability symmetrically for PvP and NPC battles
-- BEFORE ever calling the NPC AI helper (an NPC battle with zero available
-- defenders must skip the round, not crash on _pick_npc_defender_card's
-- empty-candidate guard), plays out NPC battles synchronously to their win
-- condition, and sets a 120s decision window for PvP battles.
-- ---------------------------------------------------------------------------
create or replace function _start_next_round(p_battle_id uuid) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_next_round integer;
  v_is_npc boolean;
  v_attacker_total integer;
  v_defender_total integer;
  v_attacker_avail integer;
  v_defender_avail integer;
  v_attacker_card uuid;
  v_defender_card uuid;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  v_next_round := v_battle.current_round + 1;
  v_is_npc := v_battle.defender_id is null;

  -- Win condition (Task 12): checked irrespective of resting status.
  select count(*) into v_attacker_total
  from battle_attacker_roster bar
  join card_instances ci on ci.instance_id = bar.card_instance_id
  where bar.battle_id = p_battle_id and ci.owner_id = v_battle.attacker_id;

  if v_is_npc then
    select count(*) into v_defender_total
    from card_instances ci join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id is null and ct.category = 'unit';
  else
    select count(*) into v_defender_total
    from card_instances ci join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id = v_battle.defender_id and ct.category = 'unit';
  end if;

  if v_attacker_total = 0 then
    perform _finalize_battle(p_battle_id, 'defender');
    return;
  end if;
  if v_defender_total = 0 then
    perform _finalize_battle(p_battle_id, 'attacker');
    return;
  end if;

  -- Per-round availability (rest excluded), checked symmetrically for
  -- both PvP and NPC before ever invoking the NPC AI helper.
  select count(*) into v_attacker_avail
  from battle_attacker_roster bar
  join card_instances ci on ci.instance_id = bar.card_instance_id
  where bar.battle_id = p_battle_id and ci.owner_id = v_battle.attacker_id
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and bur.resting_until_round >= v_next_round
    );

  if v_is_npc then
    select count(*) into v_defender_avail
    from card_instances ci join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id is null and ct.category = 'unit'
      and not exists (
        select 1 from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
          and bur.resting_until_round >= v_next_round
      );
  else
    select count(*) into v_defender_avail
    from card_instances ci join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id = v_battle.defender_id and ct.category = 'unit'
      and not exists (
        select 1 from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
          and bur.resting_until_round >= v_next_round
      );
  end if;

  if v_attacker_avail = 0 or v_defender_avail = 0 then
    -- Skip round: no eligible card on one (or both) sides this round, but
    -- the battle isn't over (win condition above already ruled that out).
    -- Rest counters still tick down on a skipped round.
    insert into battle_rounds (battle_id, round_number, skipped, resolved_at)
    values (p_battle_id, v_next_round, true, now());
    update battles set current_round = v_next_round where id = p_battle_id;
    perform _start_next_round(p_battle_id);
    return;
  end if;

  select ci.instance_id into v_attacker_card
  from battle_attacker_roster bar
  join card_instances ci on ci.instance_id = bar.card_instance_id
  where bar.battle_id = p_battle_id and ci.owner_id = v_battle.attacker_id
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and bur.resting_until_round >= v_next_round
    )
  order by random() limit 1;

  -- Insert the pending round row up front (both NPC and PvP paths); the
  -- NPC path fills in the defender pick immediately below, the PvP path
  -- leaves it null for pick_defender_card (Task 13) or the auto-pick
  -- branch of resolve_due_battles (Task 12).
  insert into battle_rounds (battle_id, round_number, attacker_card_instance_id)
  values (p_battle_id, v_next_round, v_attacker_card);

  if v_is_npc then
    v_defender_card := _pick_npc_defender_card(p_battle_id, v_attacker_card, v_next_round);
    perform _resolve_round(p_battle_id, v_attacker_card, v_defender_card, false);
    -- Recurse: NPC battles resolve every round automatically and
    -- immediately (spec §4), all the way to the win condition, in the
    -- same call/transaction.
    perform _start_next_round(p_battle_id);
  else
    update battles set round_deadline = now() + interval '120 seconds'
    where id = p_battle_id;
    -- Return control to the caller; awaiting pick_defender_card (Task 13)
    -- or a future resolve_due_battles() auto-pick (Task 12).
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_due_battles(): the core lazy-resolution engine (Tasks 10 + 12).
-- Called at the top of every RPC in this chunk and chunk 6.
-- ---------------------------------------------------------------------------
create or replace function resolve_due_battles() returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_round record;
  v_defender_card uuid;
begin
  -- Task 10: awaiting_ready battles past their ready_deadline.
  for v_battle in
    select * from battles
    where status = 'awaiting_ready' and ready_deadline <= now()
    for update
  loop
    if v_battle.attacker_ready_at is null and v_battle.defender_ready_at is null then
      perform _finalize_battle(v_battle.id, null);
    elsif v_battle.attacker_ready_at is null and v_battle.defender_ready_at is not null then
      perform _finalize_battle(v_battle.id, 'defender');
    else
      -- Only attacker ever readied, or both readied but never overlapped
      -- in time (mark_ready, Task 13, is the only writer of *_ready_at
      -- and already re-checks live online-overlap at call time — trust
      -- it rather than re-deriving overlap here against stale state).
      perform _finalize_battle(v_battle.id, 'attacker');
    end if;
  end loop;

  -- Task 12: active battles whose pending round's defender pick has
  -- timed out (round_deadline elapsed with no defender_card_instance_id
  -- yet set on the current pending round).
  for v_battle in
    select * from battles
    where status = 'active' and round_deadline is not null and round_deadline <= now()
    for update
  loop
    select * into v_round
    from battle_rounds
    where battle_id = v_battle.id and round_number = v_battle.current_round + 1
    for update;

    if found and v_round.defender_card_instance_id is null and not v_round.skipped
      and v_battle.defender_id is not null then
      select ci.instance_id into v_defender_card
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = v_battle.territory_id
        and ci.owner_id = v_battle.defender_id and ct.category = 'unit'
        and not exists (
          select 1 from battle_unit_rest bur
          where bur.battle_id = v_battle.id and bur.card_instance_id = ci.instance_id
            and bur.resting_until_round >= v_battle.current_round + 1
        )
      order by random() limit 1;

      if v_defender_card is not null then
        update battles set round_deadline = null where id = v_battle.id;
        perform _resolve_round(v_battle.id, v_round.attacker_card_instance_id, v_defender_card, true);
        -- Re-evaluate the win condition and start the next round if not met.
        perform _start_next_round(v_battle.id);
      end if;
      -- If genuinely no defender card is available, _start_next_round's
      -- own availability check already would have taken the skip-round
      -- path instead of setting round_deadline in the first place — this
      -- branch is a defensive no-op, retried on the next lazy-resolution
      -- call, should that invariant ever be violated.
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_ready(battle_id) (Task 13): idempotent, re-callable any number of
-- times by either participant. Sets the caller's own *_ready_at = now()
-- every call, then re-evaluates the joint "both online right now" check
-- fresh each time (per spec: not just on first call).
-- ---------------------------------------------------------------------------
create or replace function mark_ready(p_battle_id uuid) returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_battle record;
  v_attacker_last_seen timestamptz;
  v_defender_last_seen timestamptz;
begin
  perform resolve_due_battles();

  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;
  if caller <> v_battle.attacker_id and caller <> v_battle.defender_id then
    raise exception 'caller is not a participant in this battle';
  end if;
  if v_battle.status <> 'awaiting_ready' then
    raise exception 'battle is not awaiting_ready';
  end if;

  if caller = v_battle.attacker_id then
    update battles set attacker_ready_at = now() where id = p_battle_id;
  else
    update battles set defender_ready_at = now() where id = p_battle_id;
  end if;

  -- Re-read the just-written timestamp(s) fresh for the joint check.
  select attacker_ready_at, defender_ready_at into v_battle.attacker_ready_at, v_battle.defender_ready_at
  from battles where id = p_battle_id;

  if v_battle.attacker_ready_at is null or v_battle.defender_ready_at is null then
    -- Other side hasn't readied yet (or NPC battles never reach this RPC
    -- at all, since they resolve synchronously in Task 9's arrival path).
    return;
  end if;

  select last_seen_at into v_attacker_last_seen from players where id = v_battle.attacker_id;
  select last_seen_at into v_defender_last_seen from players where id = v_battle.defender_id;

  if v_attacker_last_seen >= now() - interval '2 minutes'
     and v_defender_last_seen >= now() - interval '2 minutes' then
    update battles set status = 'active' where id = p_battle_id;
    perform _start_next_round(p_battle_id);
  end if;
  -- Otherwise: both have marked ready but didn't overlap online just now
  -- — no state change. Either side can call mark_ready again later to
  -- re-run this same joint check against fresh last_seen_at values,
  -- until it succeeds or ready_deadline passes (Task 10's timeout).
end;
$$;

-- ---------------------------------------------------------------------------
-- pick_defender_card(battle_id, card_instance_id) (Task 14): the
-- defender's explicit, human-driven response to the pending round.
-- ---------------------------------------------------------------------------
create or replace function pick_defender_card(
  p_battle_id uuid,
  p_card_instance_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_battle record;
  v_round record;
  v_card record;
begin
  perform resolve_due_battles();

  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;
  if v_battle.defender_id is null or caller <> v_battle.defender_id then
    raise exception 'caller is not the defender of this battle';
  end if;
  if v_battle.status <> 'active' then
    raise exception 'battle is not active';
  end if;

  select * into v_round
  from battle_rounds
  where battle_id = p_battle_id and round_number = v_battle.current_round + 1
  for update;
  if not found then
    raise exception 'no pending round for this battle';
  end if;
  if v_round.defender_card_instance_id is not null or v_round.skipped then
    raise exception 'this round already has a defender pick';
  end if;

  select ci.instance_id, ci.status, ci.stationed_territory_id, ct.category
  into v_card
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_card_instance_id and ci.owner_id = caller
  for update;
  if not found
     or v_card.status <> 'stationed'
     or v_card.stationed_territory_id <> v_battle.territory_id
     or v_card.category <> 'unit' then
    raise exception 'card is not an eligible defender for this battle';
  end if;
  if exists (
    select 1 from battle_unit_rest bur
    where bur.battle_id = p_battle_id and bur.card_instance_id = p_card_instance_id
      and bur.resting_until_round >= v_battle.current_round + 1
  ) then
    raise exception 'card is currently resting';
  end if;

  update battles set round_deadline = null where id = p_battle_id;
  perform _resolve_round(p_battle_id, v_round.attacker_card_instance_id, p_card_instance_id, false);
  perform _start_next_round(p_battle_id);
end;
$$;

-- =============================================================================
-- CHUNK 7: realtime wiring, get_battle read RPC, and map battle-visibility
-- (Tasks 15, 16, 20's SQL portion)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Task 15: enable replication so the battle screen (120s round windows)
-- and the map ("under attack" indicator) push live instead of polling.
-- No prior migration in this project has added anything to
-- supabase_realtime yet (subsystem #3's map is polling-only today) — this
-- is genuinely new infrastructure, not an amendment to an existing one.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table battles;
alter publication supabase_realtime add table battle_rounds;
alter publication supabase_realtime add table territories;

-- ---------------------------------------------------------------------------
-- Task 16: get_battle(battle_id) — one round-trip for the whole battle
-- screen: the battles row, the attacker roster (with template/rank/
-- owner/is_resting), the defender's currently-available pool (recomputed
-- fresh every call per spec §3.4 — never a fixed snapshot), and the full
-- battle_rounds history. Calls resolve_due_battles() first (lazy
-- resolution convention), matching every other RPC/read function in this
-- migration and 0002_territories.sql's get_viewport/get_territory.
-- ---------------------------------------------------------------------------
create or replace function get_battle(p_battle_id uuid)
returns table (
  battle jsonb,
  attacker_roster jsonb,
  defender_pool jsonb,
  rounds jsonb
)
language plpgsql
security definer
as $$
declare
  v_battle record;
begin
  perform resolve_due_battles();

  select * into v_battle from battles where id = p_battle_id;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  return query
  select
    to_jsonb(b.*) as battle,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'instance_id', ci.instance_id,
        'owner_id', ci.owner_id,
        'status', ci.status,
        'template', to_jsonb(ct.*),
        'is_resting', exists (
          select 1 from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
            and bur.resting_until_round >= b.current_round + 1
        )
      ))
      from battle_attacker_roster bar
      join card_instances ci on ci.instance_id = bar.card_instance_id
      join card_templates ct on ct.id = ci.template_id
      where bar.battle_id = b.id
    ), '[]'::jsonb) as attacker_roster,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'instance_id', ci.instance_id,
        'owner_id', ci.owner_id,
        'status', ci.status,
        'template', to_jsonb(ct.*),
        'is_resting', exists (
          select 1 from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
            and bur.resting_until_round >= b.current_round + 1
        )
      ))
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = b.territory_id
        and ct.category = 'unit'
        and (
          (b.defender_id is not null and ci.owner_id = b.defender_id)
          or (b.defender_id is null and ci.owner_id is null)
        )
    ), '[]'::jsonb) as defender_pool,
    coalesce((
      select jsonb_agg(to_jsonb(br.*) order by br.round_number)
      from battle_rounds br
      where br.battle_id = b.id
    ), '[]'::jsonb) as rounds
  from battles b
  where b.id = p_battle_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Task 20 (SQL portion): battle_locked_by is already part of `territories`
-- (added at the top of this file) and `get_viewport`/`get_territory`
-- already `select * from territories`, so they return it automatically —
-- no change needed there. `get_minimap_overview` lists explicit columns,
-- so it needs battle_locked_by added. Both `get_viewport` and
-- `get_minimap_overview` also gain a `battle_id` scalar subquery (the
-- single in-progress, non-resolved/expired battle for that territory —
-- unique per territory by declare_attack's battle_locked_by
-- check-and-lock, not by any DB-level uniqueness constraint) so the
-- client can navigate straight to app/battles/[id] without a second
-- round-trip.
-- ---------------------------------------------------------------------------
drop function if exists get_viewport(smallint, smallint, smallint, smallint);

create or replace function get_viewport(x1 smallint, y1 smallint, x2 smallint, y2 smallint)
returns table (
  id integer,
  x smallint,
  y smallint,
  difficulty smallint,
  castle_rank text,
  village_rank text,
  owner_id uuid,
  is_home boolean,
  claim_locked_by uuid,
  claim_started_at timestamptz,
  claim_transfer_arrives_at timestamptz,
  claim_occupation_completes_at timestamptz,
  battle_locked_by uuid,
  battle_id uuid
)
language plpgsql
as $$
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  return query
    select
      t.id, t.x, t.y, t.difficulty, t.castle_rank, t.village_rank, t.owner_id,
      t.is_home, t.claim_locked_by, t.claim_started_at, t.claim_transfer_arrives_at,
      t.claim_occupation_completes_at, t.battle_locked_by,
      (select b.id from battles b
       where b.territory_id = t.id and b.status not in ('resolved', 'expired')
       limit 1) as battle_id
    from territories t
    where t.x between x1 and x2 and t.y between y1 and y2;
end;
$$;

drop function if exists get_minimap_overview();

create or replace function get_minimap_overview()
returns table (
  x smallint,
  y smallint,
  owner_id uuid,
  castle_rank text,
  village_rank text,
  claim_locked_by uuid,
  battle_locked_by uuid,
  battle_id uuid
)
language plpgsql
as $$
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  return query
    select
      t.x, t.y, t.owner_id, t.castle_rank, t.village_rank, t.claim_locked_by,
      t.battle_locked_by,
      (select b.id from battles b
       where b.territory_id = t.id and b.status not in ('resolved', 'expired')
       limit 1) as battle_id
    from territories t
    where t.owner_id is not null or t.castle_rank is not null
       or t.village_rank is not null or t.claim_locked_by is not null
       or t.battle_locked_by is not null;
end;
$$;
