-- Territory Map — schema migration (design spec §2)
--
-- NOT YET APPLIED: no live Supabase project has this migration applied yet.
-- Once the user gives explicit go-ahead, apply with `supabase db push` (or
-- paste into the SQL editor) after 0001_players.sql. This file is written
-- and reviewed now so the data model is locked in and version-controlled
-- ahead of time. See supabase/migrations/0002_territories.verification.sql
-- for the manual smoke-test checklist to run immediately after applying.

-- ---------------------------------------------------------------------
-- 1. card_templates (§2.1) — first real persistence for subsystem #1's
--    catalog, plus new Castle/Village structure templates (§7).
-- ---------------------------------------------------------------------
create table card_templates (
  id text primary key,               -- e.g. 'archers-common-03', 'castle-rare'
  category text not null check (category in ('unit', 'castle', 'village')),
  unit_type text,                    -- unit only, null otherwise
  rank text not null check (rank in ('common','uncommon','rare','epic','legend')),
  name text not null,
  flavor_text text not null,
  base_stats jsonb,                  -- {str,lng,def,hp} — unit only, null otherwise
  defense_bonus_pct numeric,         -- castle/village only, null for unit (§7)
  attack_bonus_pct numeric,          -- castle only, null otherwise
  total_supply integer,              -- null = uncapped
  minted_count integer not null default 0,
  check (category != 'unit' or (unit_type is not null and base_stats is not null)),
  check (category = 'unit' or unit_type is null),
  check (category = 'unit' or defense_bonus_pct is not null),
  check (category != 'village' or attack_bonus_pct is null)
);

-- ---------------------------------------------------------------------
-- 2. territories (§2.3) — the 256×256 grid, pregenerated once. Declared
--    before card_instances/troop_movements because both reference it.
-- ---------------------------------------------------------------------
create table territories (
  id serial primary key,
  x smallint not null,
  y smallint not null,
  difficulty smallint not null check (difficulty between 1 and 5),
  castle_rank text check (castle_rank in ('common','uncommon','rare','epic','legend')),
  village_rank text check (village_rank in ('common','uncommon','rare','epic','legend')),
  owner_id uuid references players(id),
  is_home boolean not null default false,
  claim_locked_by uuid references players(id),
  claim_started_at timestamptz,
  claim_transfer_arrives_at timestamptz,
  claim_occupation_completes_at timestamptz,
  unique (x, y)
);
create index territories_xy_idx on territories (x, y);
create index territories_owner_idx on territories (owner_id) where owner_id is not null;
create index territories_interesting_idx on territories (id)
  where owner_id is not null or castle_rank is not null or village_rank is not null
     or claim_locked_by is not null;
create unique index territories_home_unique_idx on territories (owner_id) where is_home;
create index territories_occupation_due_idx on territories (claim_occupation_completes_at)
  where claim_locked_by is not null;

-- ---------------------------------------------------------------------
-- 3. card_instances (§2.2) — replaces the in-memory-only type from
--    subsystem #1's demo. owner_id null + stationed_territory_id set is
--    an NPC garrison; both null is the plain unclaimed pool.
-- ---------------------------------------------------------------------
create table card_instances (
  instance_id uuid primary key default gen_random_uuid(),
  template_id text not null references card_templates(id),
  owner_id uuid references players(id),
  stationed_territory_id integer references territories(id),
  status text not null default 'stationed'
    check (status in ('stationed', 'in_transit')),
  minted_at timestamptz not null default now(),
  minted_by text not null default 'admin' check (minted_by = 'admin')
);

-- ---------------------------------------------------------------------
-- 4. troop_movements / troop_movement_units (§2.4) — transfers and claims.
--    claim_occupation_completes_at lives on territories, not here, since
--    it's tile lock state, not movement state (§2.4).
-- ---------------------------------------------------------------------
create table troop_movements (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id),
  kind text not null check (kind in ('transfer', 'claim')),
  origin_territory_id integer not null references territories(id),
  destination_territory_id integer not null references territories(id),
  started_at timestamptz not null default now(),
  transfer_arrives_at timestamptz not null,
  status text not null default 'in_transit'
    check (status in ('in_transit', 'occupying', 'completed', 'cancelled')),
  cancelled_at timestamptz
);

create table troop_movement_units (
  movement_id uuid not null references troop_movements(id) on delete cascade,
  card_instance_id uuid not null references card_instances(id),
  primary key (movement_id, card_instance_id)
);

create index troop_movements_due_idx on troop_movements (transfer_arrives_at)
  where status = 'in_transit';

-- ---------------------------------------------------------------------
-- 5. Row-Level Security (§2.5) — same convention as players: public
--    read-all, no direct write policies. All mutation goes through
--    `security definer` RPCs (§3, §5-§7) that independently re-check
--    auth.uid() and every invariant.
-- ---------------------------------------------------------------------
alter table card_templates enable row level security;
alter table card_instances enable row level security;
alter table territories enable row level security;
alter table troop_movements enable row level security;
alter table troop_movement_units enable row level security;

create policy card_templates_select_all on card_templates for select using (true);
create policy card_instances_select_all on card_instances for select using (true);
create policy territories_select_all on territories for select using (true);
create policy troop_movements_select_all on troop_movements for select using (true);
create policy troop_movement_units_select_all on troop_movement_units for select using (true);

-- ---------------------------------------------------------------------
-- 6. resolve_due_movements() — lazy resolution (§3). Called at the top of
--    every RPC below, both reads and mutations, so no cron job is needed.
-- ---------------------------------------------------------------------
create or replace function resolve_due_movements()
returns void
language plpgsql
security definer
as $$
begin
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

-- ---------------------------------------------------------------------
-- 7. Read RPCs (§3, §9.2). Plain reads gated by the RLS read-all policies
--    above — not `security definer` themselves, but they call
--    resolve_due_movements(), which is.
-- ---------------------------------------------------------------------
create or replace function get_viewport(x1 smallint, y1 smallint, x2 smallint, y2 smallint)
returns setof territories
language plpgsql
as $$
begin
  perform resolve_due_movements();
  return query
    select * from territories
    where x between x1 and x2 and y between y1 and y2;
end;
$$;

create or replace function get_minimap_overview()
returns table (
  x smallint,
  y smallint,
  owner_id uuid,
  castle_rank text,
  village_rank text,
  claim_locked_by uuid
)
language plpgsql
as $$
begin
  perform resolve_due_movements();
  return query
    select t.x, t.y, t.owner_id, t.castle_rank, t.village_rank, t.claim_locked_by
    from territories t
    where t.owner_id is not null or t.castle_rank is not null
       or t.village_rank is not null or t.claim_locked_by is not null;
end;
$$;

create or replace function get_territory(territory_id integer)
returns setof territories
language plpgsql
as $$
begin
  perform resolve_due_movements();
  return query select * from territories where id = territory_id;
end;
$$;

create or replace function get_my_movements()
returns setof troop_movements
language plpgsql
as $$
begin
  perform resolve_due_movements();
  return query
    select * from troop_movements
    where player_id = auth.uid()
      and status in ('in_transit', 'occupying');
end;
$$;

-- ---------------------------------------------------------------------
-- 8. army_power() helper — sums rank-scaled str+lng+def+hp for a set of
--    card_instances, mirroring lib/cards/combat.ts's applyRank/
--    RANK_MULTIPLIER exactly (spec §9.1). Internal helper for the
--    mutating RPCs below, not itself exposed as public API.
-- ---------------------------------------------------------------------
create or replace function _army_power(instance_ids uuid[])
returns numeric
language sql
security definer
as $$
  select coalesce(sum(
    greatest(0, round((ct.base_stats->>'str')::numeric *
      case ct.rank when 'common' then 1.0 when 'uncommon' then 1.15
        when 'rare' then 1.35 when 'epic' then 1.6 when 'legend' then 2.0 end)) +
    greatest(0, round((ct.base_stats->>'lng')::numeric *
      case ct.rank when 'common' then 1.0 when 'uncommon' then 1.15
        when 'rare' then 1.35 when 'epic' then 1.6 when 'legend' then 2.0 end)) +
    greatest(0, round((ct.base_stats->>'def')::numeric *
      case ct.rank when 'common' then 1.0 when 'uncommon' then 1.15
        when 'rare' then 1.35 when 'epic' then 1.6 when 'legend' then 2.0 end)) +
    greatest(0, round((ct.base_stats->>'hp')::numeric *
      case ct.rank when 'common' then 1.0 when 'uncommon' then 1.15
        when 'rare' then 1.35 when 'epic' then 1.6 when 'legend' then 2.0 end))
  ), 0)
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = any(instance_ids);
$$;

-- ---------------------------------------------------------------------
-- 9. Mutating RPCs (§6, §7, §8, §11). Each calls resolve_due_movements()
--    first (§3), then re-checks every invariant server-side.
-- ---------------------------------------------------------------------
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
  dest_owner uuid; dest_locked_by uuid;
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

  select x, y, difficulty, owner_id, claim_locked_by
  into dest_x, dest_y, dest_difficulty, dest_owner, dest_locked_by
  from territories where id = destination_territory_id;
  if dest_owner is not null or dest_locked_by is not null then
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
  power := _army_power(card_instance_ids);
  difficulty_mult := case dest_difficulty
    when 1 then 1.0 when 2 then 1.5 when 3 then 2.25 when 4 then 3.4 when 5 then 5.0 end;

  transfer_hrs := greatest(0.25, distance * 0.3)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);
  occupation_hrs := greatest(10, (150 * difficulty_mult) / sqrt(power))
    * (case when caller_nation = 'scandinavia' then 0.8 else 1.0 end);

  -- Row-lock the destination and re-verify immediately before writing.
  perform id from territories
  where id = destination_territory_id and owner_id is null and claim_locked_by is null
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
  perform resolve_due_movements();

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
  perform resolve_due_movements();

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
