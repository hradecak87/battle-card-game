# Territory Map — Design Spec

## 1. Overview

This is subsystem #3 of the medieval card-battle web game (Battle Card Game V2),
built on top of subsystem #1 (Card Collection & Combat Core) and subsystem #2
(Players & Accounts), both already implemented and deployed.

This spec covers **only**:

- A statically pregenerated 256×256 grid of territories (difficulty, initial
  castle/village placement, NPC garrisons).
- Persisting card instances to the database for the first time (subsystem #1
  only defined the `CardInstance` type; nothing was ever stored in Supabase).
- Ownership, the 32-territory-per-player cap, and the player's un-losable
  home territory.
- Claiming empty land (two-phase: transfer, then occupation) and cancelling
  an in-progress claim.
- Transferring troops between a player's own territories.
- Castle/Village structure cards: their data model, ranks, stat bonuses, and
  how a player "burns" one to build on an owned territory.
- The map UI: viewport panning, coordinate jump, minimap.

**Out of scope** (deferred to subsystem #4 — Real-Time Battle):

- Any combat resolution — attacking an NPC-garrisoned or player-owned
  territory, round structure, rest-area cooldowns, battle timeouts.
- Card acquisition via combat loot (including Castle/Village drops).
- Contested empty-land claims / counter-attacks during a claim (explicitly
  simplified away in this subsystem — see §6).

## 2. Data Model

### 2.1 `card_templates` (new table — first real persistence for subsystem #1's catalog)

Migrates the 248 hand-authored templates from `lib/cards/catalog-data.json`
into the database, plus new Castle/Village structure templates (§7).

```sql
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
```

A one-time migration script seeds this table from `catalog-data.json` plus
10 new hand-authored Castle/Village templates (5 ranks × 2 categories, §7).

**`lib/cards/types.ts` becomes a discriminated union** (subsystem #1 only
ever modeled unit cards):

```ts
interface UnitCardTemplate {
  id: string
  category: 'unit'
  unitType: UnitType
  rank: Rank
  name: string
  flavorText: string
  baseStats: RawStats
  totalSupply: number | null
}
interface StructureCardTemplate {
  id: string
  category: 'castle' | 'village'
  rank: Rank
  name: string
  flavorText: string
  defenseBonusPct: number
  attackBonusPct: number | null   // castle only
  totalSupply: number | null
}
type CardTemplate = UnitCardTemplate | StructureCardTemplate
```

`applyRank`/`resolveDuel` (subsystem #1) only ever accept `UnitCardTemplate`'s
`baseStats` — unchanged, no signature change needed since callers already
only pass unit cards. Every RPC in this spec that lets a player *select
troops* (`start_claim`, `start_transfer`) must filter to
`card_instances` whose template `category = 'unit'`; `build_structure`
(§7) requires the opposite (`category in ('castle','village')`). This is
enforced server-side in each RPC, not just the UI.

**Supply/scarcity for structure cards**: same convention as rare/epic/legend
unit cards (subsystem #1 §4) — `total_supply` is a fixed cap chosen at
authoring time per rank (common: 30-60, uncommon: 15-30, rare: 6-15, epic:
2-6, legend: 1-2 — tighter than unit cards, reflecting "velmi ojedinělé"),
and `minted_count` is a **lifetime mint counter that only ever increases**,
regardless of instances later being burned by `build_structure` (§7) — it
answers "how many have ever been minted," not "how many currently exist,"
consistent with how subsystem #1 already treats `minted_count` for capped
unit ranks.

**Exception to subsystem #1's "cards are never destroyed" rule**: unit
`card_instances` are still never destroyed (only change owner/location, per
subsystem #1). Structure cards are a deliberate, explicit exception —
`build_structure` (§7) permanently deletes the instance row. This is
intentional (the user confirmed structure cards are "spálí se" / burned on
use) and only applies to `category in ('castle','village')`.

### 2.2 `card_instances` (new table — replaces the in-memory-only type)

```sql
create table card_instances (
  instance_id uuid primary key default gen_random_uuid(),
  template_id text not null references card_templates(id),
  owner_id uuid references players(id),          -- null = unclaimed pool OR NPC garrison
  stationed_territory_id integer references territories(id),
  status text not null default 'stationed'
    check (status in ('stationed', 'in_transit')),
  minted_at timestamptz not null default now(),
  minted_by text not null default 'admin' check (minted_by = 'admin')
);
```

`owner_id IS NULL AND stationed_territory_id IS NOT NULL` denotes an **NPC
garrison** instance (reuses the existing "unowned" meaning from subsystem #1
without inventing a fake player account). `owner_id IS NULL AND
stationed_territory_id IS NULL` is the plain unclaimed pool, as before.

**Canonical meaning of `stationed_territory_id` while `status = 'in_transit'`**:
it still holds the **origin** territory (where the instance departed from,
not yet the destination) for the entire duration of the trip. It only flips
to the destination the moment the resolver (§3) completes the transfer leg —
at which point `status` also flips back to `'stationed'` in the same update.
This means an in-transit instance is not counted as defending *either* tile
in between (consistent with it being "on the road," not present anywhere) —
a detail subsystem #4 will rely on when it later reads "which instances can
defend this territory right now" (`status = 'stationed' AND
stationed_territory_id = <tile>`).

### 2.3 `territories` (new table — the 256×256 grid, pregenerated once)

```sql
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
```

Full table, 65,536 rows — trivial for Postgres (as decided earlier in
brainstorming). The `territories_interesting_idx` partial index backs the
minimap query (§9.2) so it never scans all 65k rows.
`territories_home_unique_idx` is a **unique** partial index — it is the
schema-level guarantee that a player can have at most one `is_home = true`
row (enforced by Postgres, not just application code), addressing §5's
atomicity requirement. `territories_occupation_due_idx` backs the resolver's
occupation-completion lookup (§3).

### 2.4 `troop_movements` (new table — transfers and claims)

```sql
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
```

`claim_occupation_completes_at` lives on `territories` (not
`troop_movements`) because it's a property of the *tile's* lock state, which
must be checked/resolved independently of which movement created it (e.g. if
cancelled, the lock clears immediately without waiting on a movement row).
Both `claim_transfer_arrives_at` and `claim_occupation_completes_at` are
computed **once, upfront, at claim-start** (§6) — the resolver in §3 never
recomputes durations, it only checks whether `now()` has passed each
precomputed timestamp. `troop_movements_due_idx` backs the resolver's
transfer-arrival lookup (§3).

### 2.5 Row-Level Security

All five new tables get RLS enabled with the same convention as
subsystem #2's `players` table: **public/authenticated read-all, no direct
write policies** — every mutation goes exclusively through `security definer`
RPCs that independently re-check `auth.uid()` and every invariant (§6, §7,
§11). Read-all is required here (not just "own data") because the game's
core premise is that territory ownership, in-progress claims, and garrison
presence must be visible to *other* players on the map (per the original
brief: "pokud bude útočit... bude to v mapě viditelné pro ostatní").

```sql
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
```

No `insert`/`update`/`delete` policy on any of the five tables — mirroring
`players`' pattern exactly, this is what makes it impossible for a client to
directly rewrite ownership, mint cards, or fabricate a completed movement.

## 3. Lazy Resolution (matches the existing `heartbeat` pattern)

No cron/scheduled job. A `resolve_due_movements()` SQL function performs the
two steps below inside one transaction. It is called at the top of **every**
RPC that reads or writes territory/movement/army data — the four read RPCs
(`get_viewport(x1, y1, x2, y2)`, `get_minimap_overview()`, `get_territory(id)`,
`get_my_movements()`) **and** every mutating RPC in this spec
(`start_claim`, `cancel_claim`, `start_transfer`, `build_structure`, the
extended `complete_kingdom_onboarding`). Calling it first inside a mutating
RPC matters just as much as in a read: without it, e.g. `cancel_claim` could
act on a claim whose occupation timer already elapsed but hasn't been
resolved by any read yet, cancelling a claim that (by wall-clock time)
already succeeded. Client code never queries `territories`/`troop_movements`
with a raw `select` — always through one of the RPCs above — precisely so
the lazy-resolution step can never be skipped. (The four read RPCs are
plain, non-`security definer` reads gated only by the RLS read-all policies
in §2.5; they call `resolve_due_movements()`, which *is* `security definer`
since it writes. The mutating RPCs are already `security definer`
themselves, §11.)

1. Finds `troop_movements` where `status = 'in_transit'` and
   `transfer_arrives_at <= now()` (via `troop_movements_due_idx`). For
   `kind = 'transfer'`: moves the associated `card_instances`'
   `stationed_territory_id` to the destination, sets their
   `status = 'stationed'`, marks the movement `completed`. For
   `kind = 'claim'`: same instance update, but sets the movement to
   `occupying` (its `claim_occupation_completes_at` was already precomputed
   at claim-start, §6 — nothing further to compute here).
2. Finds `territories` where `claim_occupation_completes_at <= now()` and
   `claim_locked_by is not null` (via `territories_occupation_due_idx`): sets
   `owner_id = claim_locked_by`, clears all four `claim_*` columns, and marks
   the corresponding `troop_movements` row (the one with matching
   `destination_territory_id`, `kind = 'claim'`, `status = 'occupying'`)
   `completed`.

This mirrors subsystem #2's `heartbeat` — no new infrastructure, consistent
with the project's established pattern, and acceptable because occupation
timers are hours/days, not something needing sub-minute accuracy.

## 4. World Generation (one-time, at game launch)

A one-time script/migration populates all 65,536 `territories` rows:

- `difficulty`: 1–5, randomly distributed but weighted so difficulty 1–2
  ("easy"/"medium") make up ~60% of the map (giving new/low-level players
  somewhere reasonable to expand into), tapering to ~5% for difficulty 5.
- Castle/village placement: a small fixed percentage of tiles (e.g. ~2% get
  a village, ~0.5% get a castle, some overlap allowed) are pre-seeded with a
  structure at world-gen — these represent long-standing fortified/settled
  locations, not built by players. Same `castle_rank`/`village_rank` columns
  as player-built ones; no mechanical distinction (per prior discussion,
  these are "the same structures, just pre-existing").
- Every pre-seeded castle/village tile gets an **NPC garrison**: a handful of
  `card_instances` (owner_id null, stationed at that tile) minted from
  common/uncommon templates, roughly scaled to the tile's difficulty. Plain
  empty tiles get no garrison at all (confirmed earlier: Q4).

## 5. Home Territory Assignment

**Folded directly into `complete_kingdom_onboarding`** (subsystem #2's
existing RPC, modified here) rather than a separate follow-up call — this is
what makes it atomic: a player can never end up with `onboarding_completed =
true` and no home territory, because both happen in the same transaction, in
the same `security definer` function. If the territory-assignment step
raises (e.g. no candidate tile found — practically impossible with 65k
tiles, but defensively checked), the whole function rolls back, including
the kingdom-name/coat-of-arms update, and the player can retry onboarding.

Steps appended to `complete_kingdom_onboarding`, after the existing
kingdom-name/coat-of-arms update succeeds:

1. Candidate pool: tiles where `owner_id is null`, `claim_locked_by is null`
   (not currently being claimed by anyone else either — an onboarding player
   must never be handed a tile someone else's in-flight claim could still
   resolve onto), `castle_rank is null`, `village_rank is null`,
   `difficulty <= 2`.
2. Score each candidate by distance (Chebyshev) to the nearest existing
   `is_home = true` tile — prefer farther from other players' homes.
3. Pick randomly among the top-scoring ~20 candidates (avoids every player
   landing in exactly the mathematical optimum, keeps starting spots varied).
4. Re-check the chosen tile with `select ... for update` (row-locked inside
   the same transaction) immediately before writing — re-verifying
   `owner_id is null and claim_locked_by is null` — then set `owner_id =
   player`, `is_home = true`. This closes the race where two players'
   onboarding calls pick the same candidate concurrently: whichever
   transaction's `for update` lock loses re-checks after acquiring the lock,
   finds the tile no longer free, and falls back to step 1-3 (re-pick from
   the candidate pool) rather than overwriting the winner. The unique
   partial index `territories_home_unique_idx` (§2.3) separately guarantees
   no player ever ends up with two `is_home` rows, even under a
   retried/duplicate call.
5. Admin-mint a small **starter army** (e.g. 6 common-rank units, a spread of
   unit types) as `card_instances` owned by the player, stationed at their
   new home tile — otherwise a brand-new player would own a home territory
   but have zero cards to defend it, which breaks subsystem #4 later.

The home territory can never be lost (enforced later in subsystem #4's
combat rules — this spec only needs to guarantee `is_home` tiles are excluded
from any capture path, which is naturally true since subsystem #3 has no
combat at all yet).

## 6. Claiming Empty Land & Transferring Troops

### 6.1 `start_claim(origin_territory_id, destination_territory_id, card_instance_ids[])`

Two-phase, both timers **precomputed upfront** (not recomputed by the
resolver, §3):

1. Validates: `card_instance_ids` is **non-empty** (a claim/transfer with
   zero units is meaningless and would make `army_power`, §9.1, undefined —
   rejected outright); caller owns `origin_territory_id`;
   `destination_territory_id` has `owner_id is null` and `claim_locked_by is
   null` (not already being claimed by anyone — no contested claims in this
   subsystem, confirmed earlier); caller's **effective territory count** —
   current `owner_id` rows **plus** territories where `claim_locked_by =
   caller` (i.e. the caller's own pending claims, so far unresolved) — is
   under 32 (§8, this is what prevents starting several parallel claims
   that would jointly overflow the cap once they resolve); every id in
   `card_instance_ids` is owned by the caller, has `stationed_territory_id =
   origin_territory_id`, `status = 'stationed'`, and its template's
   `category = 'unit'` (structure cards can't be sent as troops, §2.1).
2. Computes `transfer_hours` and `occupation_hours` (§9.1) once, using the
   selected instances' effective stats and the destination's `difficulty`.
3. Row-locks the selected `card_instances` (`select ... for update`) and
   re-verifies each is still `status = 'stationed'` at `origin_territory_id`
   and owned by the caller — closing the analogous race where two concurrent
   `start_claim`/`start_transfer` calls select the same instances (e.g. two
   browser tabs); whichever call's lock loses the re-check is rejected with
   the same "instance not available" error as step 1, just caught slightly
   later. Row-locks the destination territory (`select ... for update`) and
   re-verifies `owner_id is null and claim_locked_by is null` immediately
   before writing — closing the equivalent race where two players' calls
   target the same free tile concurrently. Then, in the same transaction:
   sets on `territories` — `claim_locked_by = caller`, `claim_started_at =
   now()`, `claim_transfer_arrives_at = now() + transfer_hours`,
   `claim_occupation_completes_at = claim_transfer_arrives_at +
   occupation_hours` (both timestamps set **immediately**, at claim-start —
   this is what makes step 1 of the resolver in §3 a pure "has this
   timestamp passed" check, no recomputation). Creates a `troop_movements`
   row (`kind = 'claim'`, `status = 'in_transit'`, `transfer_arrives_at =
   claim_transfer_arrives_at`)
   plus its `troop_movement_units` rows. Sets the selected instances'
   `status = 'in_transit'`.

The lock (`claim_locked_by`/`claim_started_at`) is set at claim-*start*, not
at arrival — this is what makes the tile visibly "being claimed" to other
players immediately (§10).

### 6.2 `start_transfer(origin_territory_id, destination_territory_id, card_instance_ids[])`

For moving troops between **two territories the caller already owns** (no
occupation phase — the destination is already theirs). Validates:
`card_instance_ids` is non-empty (same reasoning as §6.1); caller
owns both `origin_territory_id` and `destination_territory_id`; instances
are owned by the caller, `stationed_territory_id = origin_territory_id`,
`status = 'stationed'`, `category = 'unit'`. Row-locks the selected
`card_instances` (`select ... for update`) and re-verifies the same
conditions immediately before writing, exactly as in §6.1 step 3 — closing
the identical race between two concurrent calls selecting the same
instances. Creates a `troop_movements` row
(`kind = 'transfer'`, `status = 'in_transit'`, `transfer_arrives_at = now() +
transfer_hours` computed from §9.1, no occupation component at all). Sets
instances' `status = 'in_transit'`. Resolved by §3 step 1 exactly like the
transfer phase of a claim.

### 6.3 Cancellation — `cancel_claim(territory_id)`

The claiming player may cancel at **any point** before ownership flips
(i.e. while the movement's `status` is `in_transit` **or** `occupying` —
both are cancellable, since the tile isn't owned yet either way). To keep
the state machine simple and avoid modeling partial-transit positions,
cancellation is **instantaneous, not a second timed trip**: in one
transaction, the associated `troop_movements` row is marked `cancelled`, its
instances are set back to `status = 'stationed'` with
`stationed_territory_id = origin_territory_id` (immediately available at
the origin again), and all four `claim_*` columns on `territories` are
cleared (the tile is immediately free for anyone else to claim). This is a
deliberate simplification — "cancelling gets your troops back," with no
return-trip delay — flagged explicitly here so an implementer doesn't need
to guess or invent a second movement type.

## 7. Castle / Village Structure Cards


10 new `card_templates` (5 ranks × 2 categories), each with a
`defense_bonus_pct` (both categories) and `attack_bonus_pct` (castle only,
null for village):

| Rank | Village DEF | Castle DEF | Castle ATK |
|---|---|---|---|
| Common | +10% | +20% | +10% |
| Uncommon | +20% | +35% | +20% |
| Rare | +35% | +55% | +35% |
| Epic | +55% | +80% | +55% |
| Legend | +80% | +120% | +80% |

A tile may have **both** a castle and a village simultaneously; their
`defense_bonus_pct` values **add** (e.g. rare village + rare castle = +90%
DEF for defenders on that tile). These percentages are stored as data now
but only take mechanical effect once subsystem #4 applies them during combat
— this spec is only responsible for the schema and the "build" action.

**Building** (new RPC `build_structure(territory_id, card_instance_id)`):
validates the player owns both the territory and the card instance, that the
instance's template `category` is `castle` or `village`, and that the target
territory doesn't already have that category (`castle_rank`/`village_rank`
must currently be null for that category). On success: sets
`territories.castle_rank`/`village_rank` to the card's rank, then **deletes**
the `card_instances` row (burned — permanently consumed, matches the
confirmed "spálí se" rule). Any owned territory qualifies, including the
home tile.

Since subsystem #4 (the only source of combat-loot Castle/Village cards)
doesn't exist yet, these instances can only be admin-minted for now — same
mechanism as regular unit cards (confirmed earlier).

## 8. Ownership Cap

Hard block at 32 territories (confirmed: Q9). `start_claim` must count the
player's **effective territory count** — owned (`owner_id = player`) rows
plus rows the player currently has locked via a pending claim
(`claim_locked_by = player`) — and reject with a clear error if that count is
already at 32 (§6.1). Counting pending claims, not just settled ownership, is
what prevents a player from starting several parallel claims that
individually pass a naive "under 32 owned" check but would jointly overflow
the cap once they all resolve. (Later, in subsystem #4, any capture action
will need the same effective-count check.) Enforced in the RPC, not just the
UI, since this is a security-relevant invariant.

## 9. Formulas


### 9.1 Transfer & Occupation Duration

```
distance = chebyshev(origin.x, origin.y, destination.x, destination.y)
base_transfer_hours = max(0.25, distance * 0.3)
transfer_hours = base_transfer_hours * (player.nation === 'mongol_horde' ? 0.75 : 1.0)

army_power = sum of (str + lng + def + hp) over all effective stats of
             the selected card_instances (rank-scaled, per subsystem #1's
             applyRank)
difficulty_multiplier = { 1: 1.0, 2: 1.5, 3: 2.25, 4: 3.4, 5: 5.0 }[difficulty]
base_occupation_hours = max(10, (150 * difficulty_multiplier) / sqrt(army_power))
occupation_hours = base_occupation_hours * (player.nation === 'scandinavia' ? 0.8 : 1.0)
```

Both the −25% transfer-time (Mongol Horde) and −20% occupation-time
(Scandinavia) perks are defined as *data* in subsystem #2 but explicitly left
unapplied there, deferred to "whichever subsystem owns the mechanic" (§3.1 of
that spec) — transfers and occupation are owned by this subsystem, so they
are applied here; the other four nations' combat-stat perks (STR/LNG/DEF/HP)
remain deferred to subsystem #4, which owns combat. The multiplier is
applied **after** the floor comparison for occupation (i.e. the 10-hour floor
is checked first on the un-modified value, then Scandinavia's discount is
applied on top) — so a Viking player's real floor is effectively 8 hours, not
10; this is intentional (a design perk should meaningfully beat the baseline
floor, not be swallowed by it).

Rationale, with worked examples: transfer time scales gently with distance
(adjacent tile = 0.3h/18min, opposite corner of the 256×256 map, Chebyshev
distance 255 ≈ 76.5h/3.2 days) so nearby reinforcement feels responsive
while cross-map logistics still take real time. Occupation time rewards a
stronger army: a modest starter-sized army (`army_power ≈ 120`, e.g. six
common-rank units) takes `150×1.0/√120 ≈ 13.7h` on an easy tile but
`150×5.0/√120 ≈ 68.5h` (~2.9 days) on an extreme one; a large, well-developed
army (`army_power ≈ 1000`) reaches close to the 10-hour floor even on an easy
tile (`150/√1000 ≈ 4.7h`, clamped to 10h) and still takes a meaningful
`150×5/√1000 ≈ 23.7h` on an extreme tile. The floor is reachable by a
realistic mid-to-large army, not only a theoretical maximum — retuned from an
earlier draft (constant 500 → 150) specifically so the floor isn't a
practically-unreachable edge case. Both formulas live in one constants
module (`lib/territories/formulas.ts`) so they're trivially tunable after
playtesting without touching call sites.

### 9.2 Map Queries

- **Viewport** (e.g. a 25×25 window centered on the player's current pan
  position): `select * from territories where x between $1 and $2 and y
  between $3 and $4` — served by the `territories_xy_idx` composite index.
- **Minimap** (whole-map overview): `select x, y, owner_id, castle_rank,
  village_rank, claim_locked_by from territories where owner_id is not null
  or castle_rank is not null or village_rank is not null or claim_locked_by
  is not null` — served by the `territories_interesting_idx` partial index,
  so it only returns "interesting" tiles (a small, slow-growing set early in
  the game) instead of scanning all 65,536 rows.

## 10. Map UI

- **Viewport**: a pannable grid (arrow buttons + click-drag), each tile
  colored by difficulty, with small icons for castle/village/owner-flag/
  claim-in-progress. Clicking a tile opens a detail panel (owner, difficulty,
  structures, garrison size if visible, action buttons: Claim / Send Troops /
  Cancel Claim / Build Structure, each shown only when applicable).
- **Coordinate jump**: a small `(x, y)` input that recenters the viewport.
- **Minimap**: a small canvas/grid overview rendered from the sparse query
  above, each dot colored by owning player (or grey for NPC-garrisoned
  castle/village, or a pulsing marker for an in-progress claim); clicking it
  recenters the main viewport there.
- All new pages get a "← Domů" back-link from the start (fixing the gap
  found in subsystem #2).

## 11. Error Handling

All mutating RPCs (`start_claim`, `cancel_claim`, `start_transfer`,
`build_structure`, plus the extended `complete_kingdom_onboarding`, §5) are
`security definer` functions that independently re-check every invariant
server-side (never trust client-side validation alone), consistent with
subsystem #2's pattern:

- Claim on an already-locked or already-owned tile → rejected.
- Claim while at the 32-territory cap → rejected.
- Sending instances that are already `in_transit`, not owned by the caller,
  not stationed at the stated origin, or whose template `category != 'unit'`
  → rejected (in both `start_claim` and `start_transfer`).
- `start_transfer` where the caller doesn't own the destination (that's a
  claim, not a transfer — use `start_claim` instead) → rejected.
- `cancel_claim` on a territory the caller isn't the current `claim_locked_by`
  for → rejected.
- `build_structure` on a territory not owned by the caller, or already
  having that structure category, or with a non-structure card → rejected.
- Each rejection raises a clear Postgres exception message, surfaced as a
  user-facing error in the UI (matching subsystem #2's RPC error pattern).

## 12. Testing Strategy

- **Unit tests** (`lib/territories/`): `transfer_hours`/`occupation_hours`
  formulas (boundary cases: distance 0/1/max, floor enforcement including the
  Scandinavia-discount-after-floor ordering, difficulty multiplier table,
  Mongol/Scandinavia perk multipliers); Chebyshev distance helper;
  castle+village bonus-stacking math.
- **SQL/integration tests**: world-gen script produces exactly 65,536 rows
  with valid difficulty distribution; `resolve_due_movements` correctly
  transitions transfer → occupying → completed and flips ownership;
  `territories_home_unique_idx` actually rejects a second `is_home` row for
  the same player; 32-cap enforcement; `cancel_claim` unlocks the tile and
  restores instances to the origin instantly, from both the `in_transit` and
  `occupying` states; `build_structure` burns the instance (row deleted) and
  sets the correct rank column, while `minted_count` is unaffected by the
  burn; RLS policies verified to block direct client writes to all five new
  tables (only the RPCs can mutate them).
- **Component tests**: viewport pan/coordinate-jump, minimap render from a
  mocked sparse dataset, territory detail panel showing the correct action
  buttons per state (empty/lockable/owned-by-me/owned-by-other/NPC-garrison).

## 13. Out of Scope (deferred to subsystem #4)

- All combat resolution (NPC and player-vs-player), round structure,
  rest-area cooldowns, battle timeouts and their territory-ownership
  consequences.
- Castle/village bonus percentages actually being *applied* during a battle
  (the data exists here; the application logic doesn't yet).
- Card acquisition via combat loot, including Castle/Village drops.
- Contested empty-land claims / counter-attack mechanics (simplified out of
  this subsystem entirely — a locked tile cannot be contested by anyone but
  the original claimant).
