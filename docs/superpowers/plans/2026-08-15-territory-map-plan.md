# Territory Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build subsystem #3 (Territory Map) per
`docs/superpowers/specs/2026-08-15-territory-map-design.md`: real DB
persistence for cards (first time ever), the 256×256 territory grid, world
generation, claim/transfer/cancel/build-structure RPCs, the pure formula
module, and the map UI (viewport, minimap, coordinate jump).

**Architecture:** One new SQL migration (`0002_territories.sql`) holds every
table, index, RLS policy, and RPC from the spec, following the exact
conventions of `0001_players.sql` (security-definer RPCs, public-select RLS,
no direct-write policies). `lib/cards/types.ts` gets the discriminated-union
update. A new `lib/territories/` folder (mirrors `lib/players/`,
`lib/cards/`) holds the pure, Jest-testable formula/distance code. A
one-time world-gen script populates the grid. Map UI lives under `app/map/`,
composed of a viewport grid, minimap, and detail-panel components under
`components/territories/`.

**Tech Stack:** TypeScript, Jest, Supabase (Postgres + RLS + RPC), Next.js
App Router, same stack as subsystems #1/#2. Consistent with those, this plan
keeps step granularity **moderate rather than maximally atomic** (per the
user's explicit request to keep this plan concise) — each task bundles
writing code + its test + running it + committing into fewer, denser steps,
instead of one step per micro-action.

---

## Chunk 1: Card persistence + pure logic (buildable/testable without a live DB)

### Task 1: `CardTemplate`/`CardInstance` discriminated union

**Files:**
- Modify: `lib/cards/types.ts`
- Modify: `lib/cards/catalog.ts` (loader must handle both variants)
- Test: `lib/cards/catalog.test.ts` (extend existing suite)

- [ ] Replace the single `CardTemplate` interface with the
  `UnitCardTemplate | StructureCardTemplate` union from spec §2.1: both
  variants share `id`, `rank`, `name`, `flavorText`, `totalSupply`, but each
  has its own literal discriminant — `category: 'unit'` (plus `unitType`,
  `baseStats`) vs. `category: 'castle' | 'village'` (plus `defenseBonusPct`,
  `attackBonusPct: number | null`) — exactly as written in spec §2.1's code
  block. Add `CardInstance.stationedTerritoryId: number | null` (matches
  `territories.id`, a Postgres `serial`/integer, **not** a uuid/string — do
  not reuse the `instanceId: string` pattern here) and `status: 'stationed'
  | 'in_transit'` (spec §2.2).
- [ ] Update `catalog.ts`'s validation/loader so it still only knows about
  unit cards (no behavior change — structure cards aren't in
  `catalog-data.json` and aren't loaded by this module; they're seeded
  directly into the DB in Task 8, so `applyRank`/`resolveDuel` never need to
  branch on category). Add a narrow type guard `isUnitTemplate(t):
  t is UnitCardTemplate` for future call sites (map UI, Task 12) that need
  to filter a mixed list.
- [ ] Run `npx tsc --noEmit` and `npx jest lib/cards` — expect PASS, no
  regressions in the existing 30 card tests.
- [ ] Commit: `refactor: split CardTemplate into unit/structure union`

### Task 2: Territory formulas (pure, unit-tested)

**Files:**
- Create: `lib/territories/formulas.ts`
- Test: `lib/territories/formulas.test.ts`

- [ ] Implement `chebyshevDistance(a, b)`, `transferHours(distance, nation)`,
  `occupationHours(armyPower, difficulty, nation)`, and
  `DIFFICULTY_MULTIPLIER` exactly per spec §9.1 (constants: transfer rate
  0.3h/tile, floor 0.25h; occupation constant 150, floor 10h; Mongol Horde
  ×0.75 transfer, Scandinavia ×0.8 occupation applied **after** the floor).
- [ ] Write tests for: distance 0/1/255; the three worked examples from
  spec §9.1 (army_power≈120 easy/extreme, army_power≈1000 easy/extreme);
  floor enforcement with and without the Scandinavia discount (confirm the
  "effective floor is 8h for Vikings" behavior); all 5 difficulty
  multipliers; Mongol Horde transfer discount.
- [ ] Run `npx jest lib/territories/formulas.test.ts` — expect PASS.
- [ ] Commit: `feat: add territory transfer/occupation formulas`

### Task 3: Castle/Village bonus stacking helper

**Files:**
- Create: `lib/territories/structureBonus.ts`
- Test: `lib/territories/structureBonus.test.ts`

- [ ] Implement `combinedDefenseBonusPct(castleRank, villageRank)` and
  `castleAttackBonusPct(castleRank)` reading the rank→percent table from
  spec §7 (both null → 0; both present → additive; only one present → just
  that one).
- [ ] Test all 5×5 rank combinations for defense (spot-check a few, not all
  25) plus both-null and one-null cases; castle-attack for each of the 5
  ranks plus null.
- [ ] Run `npx jest lib/territories/structureBonus.test.ts` — expect PASS.
- [ ] Commit: `feat: add castle/village bonus stacking helper`

---

## Chunk 2: Database schema, world-gen, RPCs

### Task 4: Schema migration — tables, indexes, RLS

**Files:**
- Create: `supabase/migrations/0002_territories.sql`

- [ ] Write the full migration: `card_templates`, `card_instances`,
  `territories`, `troop_movements`, `troop_movement_units` tables exactly as
  in spec §2.1-§2.4 (including all check constraints), every index from
  §2.3/§2.4 (`territories_xy_idx`, `territories_owner_idx`,
  `territories_interesting_idx`, `territories_home_unique_idx` (**unique**),
  `territories_occupation_due_idx`, `troop_movements_due_idx`), and the RLS
  block from §2.5 (enable RLS + public select-all + no write policy, all 5
  tables).
- [ ] Add a header comment matching `0001_players.sql`'s style ("NOT YET
  APPLIED... apply with `supabase db push`... once the user provisions
  it") — **do not attempt to apply this migration to the live project
  without the user's explicit go-ahead**, since it changes production
  schema.
- [ ] Commit: `feat: add territories/card_instances schema migration`

### Task 4a: SQL verification checklist (run manually, once applied)

**Files:**
- Create: `supabase/migrations/0002_territories.verification.sql` (a
  scratch file of `select`/`insert` smoke queries, **not** part of the
  applied migration itself — same role as a manual test script)

- [ ] Write queries an engineer can paste into the Supabase SQL editor
  *after* this migration is applied, to sanity-check schema-level
  invariants without needing the app running: inserting two rows with
  `is_home = true` for the same `owner_id` fails
  (`territories_home_unique_idx`); inserting a `card_templates` row with
  `category = 'village'` and a non-null `attack_bonus_pct` fails (check
  constraint); a plain `select` against `territories` as an anonymous role
  succeeds (RLS read-all) but a plain `update` fails (no write policy).
  This is the closest available substitute for spec §12's "SQL/integration
  tests" until a live Supabase project is provisioned and these RPCs can be
  exercised end-to-end (same constraint `0001_players.sql` was under).
- [ ] Commit: `test: add manual SQL verification checklist for territories schema`

### Task 5: `resolve_due_movements()` + read RPCs

**Files:**
- Modify: `supabase/migrations/0002_territories.sql` (append)

- [ ] Write `resolve_due_movements()` per spec §3 (two steps: transfer/claim
  arrival, then occupation completion), `security definer`.
- [ ] Write the four read RPCs — `get_viewport(x1,y1,x2,y2)`,
  `get_minimap_overview()`, `get_territory(id)`, `get_my_movements()` — each
  calling `resolve_due_movements()` first, per spec §3 and §9.2 (viewport
  uses `territories_xy_idx`, minimap uses `territories_interesting_idx`).
- [ ] Commit: `feat: add lazy-resolution function and map read RPCs`

### Task 6: Mutating RPCs — claim, transfer, cancel, build

**Files:**
- Modify: `supabase/migrations/0002_territories.sql` (append)

- [ ] Write `start_claim(origin_id, destination_id, card_instance_ids[])`
  per spec §6.1 verbatim: **calls `resolve_due_movements()` first** (spec
  §3 — every mutating RPC in this task must start with this call, not just
  `start_claim`), then non-empty selection check, ownership/status/
  category checks, effective-territory-count cap check (§8), row-locking
  (`select ... for update`) + re-check on both the destination territory and
  the selected instances, precomputed `claim_transfer_arrives_at`/
  `claim_occupation_completes_at`, `troop_movements`+`troop_movement_units`
  rows, instances → `in_transit`.
- [ ] Write `start_transfer(...)` per §6.2 (same shape, no occupation
  phase, both locks, non-empty check) — **also calls
  `resolve_due_movements()` first**.
- [ ] Write `cancel_claim(territory_id)` per §6.3 (instant return, no
  timer; caller must be the current `claim_locked_by`) — **also calls
  `resolve_due_movements()` first**, so a claim that already completed by
  wall-clock time can't be cancelled out from under its rightful new owner.
- [ ] Write `build_structure(territory_id, card_instance_id)` per §7
  (ownership checks, category check, no-existing-structure-of-that-category
  check, sets rank column, deletes the instance row — `minted_count` is
  never decremented) — **also calls `resolve_due_movements()` first**.
- [ ] Append to `0002_territories.verification.sql` (Task 4a): one query
  per RPC exercising its main rejection path (claim on a locked tile,
  transfer to a not-owned destination, cancel by a non-claimant, build on
  an already-structured territory) so each error message can be manually
  confirmed once a live project exists — this is the acceptance check for
  this task in lieu of an automated integration test (spec §12).
- [ ] Commit: `feat: add claim/transfer/cancel/build-structure RPCs`

### Task 7: Extend onboarding — atomic home-territory assignment

**Files:**
- Modify: `supabase/migrations/0002_territories.sql` (append; this
  redefines the function from `0001_players.sql`, so also add a short note
  in `0001_players.sql`'s header pointing forward to this migration)

- [ ] Redefine `complete_kingdom_onboarding` to **call
  `resolve_due_movements()` first** (spec §3 applies to this RPC too, since
  it now touches `territories`), then append, in the same transaction, spec
  §5's steps: candidate pool (`owner_id`/`claim_locked_by`
  both null, no structures, difficulty ≤2), Chebyshev-distance scoring,
  random pick among top ~20, row-lock + re-check before writing
  `owner_id`/`is_home`, then admin-mint a 6-unit starter army stationed at
  the new home tile.
- [ ] Commit: `feat: fold atomic home-territory assignment into onboarding`

### Task 8: Card + structure template seed data, world-gen script

**Files:**
- Create: `scripts/seed-card-templates.ts` (loads `catalog-data.json` into
  `card_templates`, plus 10 hand-authored Castle/Village rows per spec §7's
  table)
- Create: `scripts/generate-world.ts` (populates all 65,536 `territories`
  rows per spec §4: weighted difficulty distribution, ~2%/~0.5%
  village/castle placement, NPC garrisons on structure tiles)
- Test: `scripts/generate-world.test.ts` (pure logic only — difficulty
  weighting and placement-percentage helpers factored into testable
  functions; the actual DB insert is not unit-tested, mirrors how
  `0001_players.sql` itself has no Jest test)

- [ ] Write the difficulty-weighting and castle/village-placement
  percentage logic as small exported pure functions, with tests (e.g.
  "over 10,000 samples, difficulty 1-2 make up roughly 55-65%").
- [ ] Write the two scripts' DB-writing shell (batched inserts; safe to
  run only once — check `select count(*) from territories` is 0 first and
  abort with a clear message otherwise).
- [ ] Run `npx jest scripts/generate-world.test.ts` — expect PASS.
- [ ] Commit: `feat: add card template seed and world-gen scripts`
- [ ] **Do not run either script against the live Supabase project in this
  task** — that requires the migration (Task 4-7) to be applied first, which
  requires the user's explicit go-ahead (same policy as `0001_players.sql`).

---

## Chunk 3: Map UI

### Task 9: `lib/supabase` typed helpers for the new RPCs

**Files:**
- Create: `lib/territories/api.ts`

- [ ] Thin typed wrapper functions calling each RPC via the existing
  `lib/supabase/client.ts` singleton (`getViewport`, `getMinimapOverview`,
  `getTerritory`, `getMyMovements`, `startClaim`, `startTransfer`,
  `cancelClaim`, `buildStructure`) — mirrors how subsystem #2's pages call
  `complete_kingdom_onboarding`/`heartbeat` directly today; centralizing
  them here avoids repeating `.rpc(...)` calls across components.
- [ ] Commit: `feat: add typed territory RPC client wrappers`

### Task 10: Viewport + coordinate jump

**Files:**
- Create: `components/territories/MapViewport.tsx`
- Create: `app/map/page.tsx`
- Test: `app/map/page.test.tsx`

- [ ] Build a pannable grid component (arrow buttons **and** click-drag —
  both required per spec §10, not just buttons — plus a coordinate-jump
  input) that calls `getViewport` for the visible window, colors tiles by
  difficulty, and shows small icons for owner/castle/village/claim-lock.
- [ ] Wire it into `app/map/page.tsx` with a "← Domů" back-link (subsystem
  #2's known gap — get this right from the start, per spec §10).
- [ ] Test: renders a mocked viewport response, coordinate-jump input
  updates the requested window, back-link present.
- [ ] Run `npx jest app/map` — expect PASS.
- [ ] Commit: `feat: add map viewport with pan and coordinate jump`

### Task 11: Minimap

**Files:**
- Create: `components/territories/Minimap.tsx`
- Test: `components/territories/Minimap.test.tsx`

- [ ] Build a small canvas/grid overview from `getMinimapOverview`'s sparse
  result set, coloring dots by owner/NPC-structure/claim-in-progress;
  clicking recenters the parent viewport (callback prop).
- [ ] Test: renders a mocked sparse dataset, click invokes the recenter
  callback with the right coordinates.
- [ ] Run `npx jest components/territories/Minimap.test.tsx` — expect PASS.
- [ ] Commit: `feat: add minimap overview`

### Task 12: Territory detail panel — claim/transfer/cancel/build actions

**Files:**
- Create: `components/territories/TerritoryDetailPanel.tsx`
- Test: `components/territories/TerritoryDetailPanel.test.tsx`

- [ ] Build the click-through detail panel from spec §10: shows owner,
  difficulty, structures, garrison size (if visible), and only the action
  buttons that apply to the tile's current state (empty/lockable,
  owned-by-me, owned-by-other, NPC-garrisoned, claim-in-progress). Troop
  selection lists use `isUnitTemplate` (Task 1) to exclude structure cards
  from the claim/transfer picker, and separately lets the player pick a
  Castle/Village card for `buildStructure`.
- [ ] Test each state renders the correct action set; selecting troops and
  submitting calls the right `lib/territories/api.ts` function with the
  right args (mocked); a rejected RPC call (mocked failure) renders the
  Postgres exception message as a visible, user-facing error (spec §11) —
  not silently swallowed.
- [ ] Run `npx jest components/territories/TerritoryDetailPanel.test.tsx` —
  expect PASS.
- [ ] Commit: `feat: add territory detail panel with claim/transfer/build actions`

---

## Chunk 4: Wrap-up

### Task 13: Full verification + PROGRESS.md update

- [ ] Run `npx tsc --noEmit` (clean) and the full `npx jest` suite (no
  regressions from the 61 existing tests, plus all new suites passing).
- [ ] Note in `PROGRESS.md` that `0002_territories.verification.sql` (Tasks
  4a/6) still needs to be run manually against the live Supabase project
  once the migration itself is applied — neither has happened yet as of
  this plan, both require the user's explicit go-ahead first.
- [ ] Update `docs/superpowers/PROGRESS.md` §8 with implementation status
  (mirroring how §7/§7.1 documented subsystem #2), noting the migration is
  **written but not applied** until the user explicitly approves running it
  against the live Supabase project (same policy as `0001_players.sql`).
- [ ] **Do not commit or push** until the user has reviewed the working
  result and explicitly approves — per project policy, this is a hard gate
  even after all automated checks pass.

**Not covered by this plan** (explicitly out of scope, per spec §13): applying
castle/village bonuses in combat, any combat resolution, and combat-loot card
acquisition — all belong to subsystem #4.
