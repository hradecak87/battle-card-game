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
