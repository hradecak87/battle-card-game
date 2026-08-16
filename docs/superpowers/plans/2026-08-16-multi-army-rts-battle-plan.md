# Multi-Army RTS Battle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build subsystem #4 (Multi-Army RTS Battle) per
`docs/superpowers/specs/2026-08-16-multi-army-rts-battle-design.md`: the
`declare_attack` → travel → `awaiting_ready` → round-by-round live duel
loop → territory-capture pipeline, its 4 new tables, the 6 amended/new
RPCs, structure/nation combat-bonus wiring, NPC smart-counter AI, realtime
delivery, and the battle-screen UI (desktop + mobile).

**Architecture:** One new SQL migration (`0003_battles.sql`) adds
`battles`, `battle_attacker_roster`, `battle_rounds`, `battle_unit_rest`,
plus the `territories.battle_locked_by` column, and every RPC from spec
§3.6 (`declare_attack`, `resolve_due_battles`, `mark_ready`,
`pick_defender_card`), following `0002_territories.sql`'s exact
conventions (security-definer RPCs, public-select RLS, `players(id)` FKs,
lazy resolution instead of cron). `resolve_due_movements()`,
`start_claim()`, `cancel_claim()`, and `build_structure()` (all in
`0002_territories.sql`) get amended in place via `create or replace
function` statements inside the new migration (Postgres allows redefining
functions across migration files; the table they touch doesn't change).
A new `lib/battles/` folder (mirrors `lib/territories/`, `lib/cards/`)
holds the pure, Jest-testable combat-stat-stacking and NPC-AI logic. The
battle-screen UI lives under `app/battles/[id]/`, composed of
duel/roster-strip/history components under `components/battles/`,
following the same component-per-responsibility pattern as
`components/territories/`.

**Tech Stack:** TypeScript, Jest, Supabase (Postgres + RLS + RPC + Realtime
`postgres_changes`), Next.js App Router — same stack as subsystems #1-#3.
Per this project's established convention (confirmed across all three
prior plans), this plan keeps step granularity **moderate rather than
maximally atomic**: each task bundles writing code + its test + running it
+ committing into fewer, denser steps.

---

## Chunk 1: Pure combat-stat and NPC-AI logic (buildable/testable without a live DB)

### Task 1: Nation combat-perk lookup

**Files:**
- Create: `lib/battles/nationCombatPerk.ts`
- Test: `lib/battles/nationCombatPerk.test.ts`

- [ ] Implement `applyNationCombatPerk(stats: EffectiveCard, nation:
  NationId): EffectiveCard` per spec §3.5: multiplies exactly one stat by
  1.15 for `england` (`lng`), `francia` (`str`), `hre` (`def`),
  `byzantium` (`hp`); returns `stats` unchanged (new object, but same
  values) for `mongol_horde`/`scandinavia` (their perks are
  transfer/occupation-only, already applied in subsystem #3). Do **not**
  round inside this function — return raw (possibly fractional)
  numbers; rounding happens once, at the end, in Task 2's
  `computeEffectiveStats`.
- [ ] Test all 6 nations: confirm exactly the right single stat is
  scaled by 1.15 (or unchanged for the two non-combat nations), and that
  the other 3 stats are untouched.
- [ ] Run `npx jest lib/battles/nationCombatPerk.test.ts` — expect PASS.
- [ ] Commit: `feat: add nation combat-perk stat multiplier`

### Task 2: Effective combat-stat computation (structure + nation bonuses, single rounding)

**Files:**
- Create: `lib/battles/effectiveStats.ts`
- Test: `lib/battles/effectiveStats.test.ts`

- [ ] Implement `computeEffectiveStats(input): EffectiveCard` exactly per
  spec §3.5's pipeline:
  ```ts
  export interface EffectiveStatsInput {
    baseStats: RawStats
    rank: Rank
    isDefendingThisRound: boolean
    castleRank: Rank | null
    villageRank: Rank | null
    ownerNation: NationId
  }
  ```
  1. `effective = applyRank(baseStats, rank)` (reuse `lib/cards/combat.ts`,
     already integer-rounded).
  2. If `isDefendingThisRound`: `def *= (1 + combinedDefenseBonusPct(castleRank,
     villageRank) / 100)`; if `castleRank !== null`, also `str *= (1 +
     castleAttackBonusPct(castleRank) / 100)` and `lng *= (1 + same/100)`
     (reuse `lib/territories/structureBonus.ts` as-is, no changes to that
     file).
  3. Apply `applyNationCombatPerk` from Task 1 (unrounded).
  4. Round **once**, at the very end, each of the 4 stats with
     `Math.max(0, Math.round(value))` — mirrors `applyRank`'s own
     convention; do not round after each individual multiplier (spec
     §3.5's explicit rationale: avoids compounding rounding error across
     up to 3 stacked multipliers).
- [ ] Write tests: (a) attacking side (no castle/structure bonus applied
  regardless of castle/village rank passed in, since `isDefendingThisRound
  = false`) with each of the 4 nation perks, confirming exactly the
  targeted stat reflects both rank-scaling and the perk; (b) defending
  side with village-only, castle-only, and both castle+village present,
  confirming additive stacking via `combinedDefenseBonusPct`; (c) a
  defending case combining a Castle (both def and atk bonus) with a
  nation perk on the *same* stat (e.g. HRE `def` perk + castle def bonus)
  to confirm sequential multiplication, single final rounding (assert the
  exact expected integer, not just "not NaN"); (d) `mongol_horde`/
  `scandinavia` pass through unaffected by the nation-perk step.
- [ ] Run `npx jest lib/battles/effectiveStats.test.ts` — expect PASS.
- [ ] Commit: `feat: add effective combat stat computation with structure/nation bonuses`

### Task 3: NPC smart-counter card selection

**Files:**
- Create: `lib/battles/npcAi.ts`
- Test: `lib/battles/npcAi.test.ts`

- [ ] Implement `pickNpcDefenderCard<T>(attackerEffective: EffectiveCard,
  candidates: { id: T; effective: EffectiveCard }[], rand: () => number):
  T` per spec §4: for each candidate, call `resolveDuel(attackerEffective,
  candidate.effective)` (reuse `lib/cards/combat.ts`, unchanged); return
  the id of any candidate whose simulated duel resolves `'defender'`
  (deterministic — first match is fine, since spec says "pick whichever
  NPC card wins", not "the best one"); if none would win, fall back to
  a uniformly random candidate using the injected `rand()` (same
  dependency-injection pattern likely already used elsewhere for
  testable randomness — check `scripts/generate-world.ts`'s `rand`
  parameter style and match it). Throw if `candidates` is empty (caller's
  responsibility to only call this when the NPC has at least one
  available card).
- [ ] Test: a candidate set with exactly one winning candidate is picked;
  a set with multiple winning candidates picks one of them (assert
  membership, not exact identity, since "any winner" is spec-correct);
  an all-losing set falls back to `rand()`-selected candidate (mock
  `rand` to return a fixed value, assert the corresponding candidate);
  single-candidate set returns it regardless of outcome; empty array
  throws.
- [ ] Run `npx jest lib/battles/npcAi.test.ts` — expect PASS.
- [ ] Commit: `feat: add NPC smart-counter defender AI`

### Task 4: Rest-cooldown pure helper

**Files:**
- Create: `lib/battles/restCooldown.ts`
- Test: `lib/battles/restCooldown.test.ts`

- [ ] Implement `isAvailable(restingUntilRound: number | undefined,
  currentRound: number): boolean` (spec §3.4: unavailable if
  `restingUntilRound !== undefined && currentRound < restingUntilRound`)
  and `nextRestingUntilRound(currentRound: number): number` (`currentRound
  + 2`, spec §2/§3.4 — both cards in every resolved round rest 2 rounds
  regardless of win/loss). Keep these as two tiny pure functions rather
  than one — they're independently reused: availability is checked every
  round for both attacker and defender pools; the "until round" write
  happens once per card per resolved round.
- [ ] Test boundary cases: `currentRound === restingUntilRound` is
  available again (rest has "ticked down" past); `currentRound ===
  restingUntilRound - 1` is not; `undefined` is always available;
  `nextRestingUntilRound(0) === 2`, `nextRestingUntilRound(5) === 7`.
- [ ] Run `npx jest lib/battles/restCooldown.test.ts` — expect PASS.
- [ ] Commit: `feat: add rest-cooldown availability helper`

---

## Chunk 2: Database schema — tables, column, RLS

### Task 5: Migration file header + `battle_locked_by` column + new tables

**Files:**
- Create: `supabase/migrations/0003_battles.sql`

- [ ] Start the file with the same "NOT YET APPLIED" header comment style
  as `0002_territories.sql` (apply via `supabase db push` only once the
  user gives explicit go-ahead; **do not** run this against the live
  project as part of this chunk).
- [ ] `alter table territories add column battle_locked_by uuid references
  players(id);` (spec §3.1's map-visibility paragraph — nullable, cleared
  on battle resolution/expiry/downgrade-to-claim).
- [ ] `alter table troop_movements drop constraint troop_movements_kind_check;
  alter table troop_movements add constraint troop_movements_kind_check
  check (kind in ('transfer', 'claim', 'attack'));` (spec §3.1 — widen the
  existing check constraint from `0002_territories.sql` line ~84 so
  `declare_attack` (Chunk 3) and the return-troop-movements written by
  `resolve_due_battles()` (Chunk 5) can insert `kind='attack'` rows;
  first confirm the exact constraint name Postgres auto-generated for
  `0002_territories.sql`'s inline `check` — if it wasn't given an
  explicit name, query `information_schema.check_constraints` on a
  scratch DB to find the generated name rather than guessing).
- [ ] Create `battles` exactly per spec §3.1's full `create table`
  block (all columns, all `check` constraints, `movement_id references
  troop_movements(id)`, no separate `winner_id` column — confirm the spec's
  explicit rationale comment is preserved as a SQL comment above the
  table for future readers).
- [ ] Create `battle_attacker_roster` per spec §3.2 (composite PK
  `(battle_id, card_instance_id)`).
- [ ] Create `battle_rounds` per spec §3.3 (all columns including
  `auto_picked`, `skipped`, `unique (battle_id, round_number)`).
- [ ] Create `battle_unit_rest` per spec §3.4 (composite PK `(battle_id,
  card_instance_id)`, `resting_until_round integer not null`).
- [ ] Add indexes needed for the lazy-resolution queries `resolve_due_battles()`
  will run: `battles_ready_deadline_idx` on `(ready_deadline) where status =
  'awaiting_ready'`, `battles_round_deadline_idx` on `(round_deadline) where
  status = 'active'`, `battles_territory_idx` on `(territory_id) where
  status not in ('resolved','expired')` (used by `declare_attack`'s
  already-a-battle-here check and by the map's `battle_locked_by` display
  logic).
- [ ] Enable RLS + add a public `select using (true)` policy on all 4 new
  tables (spec §3.6's RLS paragraph — matches every existing table in
  `0002_territories.sql`; no write policy on any of them, since all
  mutation goes through `security definer` RPCs).
- [ ] Commit: `feat: add battle tables, battle_locked_by column, and RLS`

### Task 6: Migration verification checklist (manual, run once applied — mirrors `0002_territories.verification.sql`)

**Files:**
- Create: `supabase/migrations/0003_battles.verification.sql` (a scratch
  file of `select`/`insert` smoke queries, **not** part of the applied
  migration itself — same role/naming convention as
  `0002_territories.verification.sql`, appended to by later tasks in this
  plan whenever a new RPC needs its own rejection-path check)

- [ ] Write the initial batch of smoke queries: confirm `\d battles`
  shows all check constraints; confirm inserting a `battles` row with an
  invalid `status` value raises the check-constraint error; confirm the
  public-select RLS policy lets an anonymous client read `battle_rounds`
  but not insert into it; confirm inserting a `troop_movements` row with
  `kind='attack'` now succeeds against the widened check constraint from
  Task 5.
- [ ] Commit: `test: add manual SQL verification checklist for battles schema`
- [ ] Note for later tasks (not a step to run now): this checklist can
  only actually be *executed* once a live/staging Supabase project
  exists to run it against — same caveat as
  `0002_territories.verification.sql`'s own Task 4a. Never run it against
  the live production project without an explicit user go-ahead and a
  targeted backup first (see `scripts/backfill-npc-garrisons.ts` for the
  backup pattern already used once this session).

---

## Chunk 3: `declare_attack` RPC + amendments to subsystem #3's RPCs

### Task 7: `declare_attack` RPC

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append)

- [ ] Write `declare_attack(origin_territory_id integer,
  target_territory_id integer, card_instance_ids uuid[]) returns uuid`
  (returns the new `troop_movements.id`) per spec §3.6:
  1. **Call `resolve_due_battles()` first** (Task 10/12's function,
     defined later in this same migration file — Postgres/plpgsql
     doesn't resolve a called function's existence until the calling
     function is actually *executed*, not when it's *created*, so this
     forward reference is safe as long as the whole migration file is
     applied — and therefore every function in it created — before the
     app ever calls `declare_attack` at runtime; do not reorder chunks to
     avoid this). This prevents a stale, logically-already-due
     `battles`/`battle_locked_by` row from incorrectly blocking a new
     attack (spec §3.6's intro sentence: "every RPC below calls
     `resolve_due_battles()` first").
  2. Resolve `caller := auth.uid()`.
  3. Validate `origin_territory_id` is owned by `caller` and every id in
     `card_instance_ids` is a `status='stationed'` unit-category
     `card_instances` row stationed there and owned by `caller` (copy
     `start_claim`'s existing validation query shape from
     `0002_territories.sql` lines ~315-340, adjusted for "unit-category"
     instead of whatever filter `start_claim` uses — confirm by reading
     that function body before writing this).
  4. Reject if `target_territory_id` is the caller's own owned/claimed
     territory, or if it has a non-`resolved`/`expired` `battles` row
     already targeting it (`exists (select 1 from battles where
     territory_id = target_territory_id and status not in ('resolved',
     'expired'))`) — this check is now reliable precisely because step 1
     already flushed any stale battle state.
  5. Best-effort 32-cap pre-check: if this attack is plausibly capturable
     (target isn't the caller's own home — always true here since step 3
     already excluded own territory) and the caller already owns 32
     territories (reuse whatever count query `start_claim` uses), raise
     the same `territory ownership cap (32) reached` error text
     `start_claim` raises (copy the exact error string for consistency).
  6. Insert a `troop_movements` row with `kind='attack'`,
     `transfer_arrives_at` computed via the existing `transferHours`
     logic already used by `start_transfer`/`start_claim` (same SQL
     expression/pattern — do not reintroduce `occupation_hrs`, this is
     explicitly transfer-only per spec §3.1).
  7. Insert into `troop_movement_units` for each `card_instance_ids`
     entry (same as `start_transfer` does).
  8. Flip those `card_instances.status = 'in_transit'`.
  9. Set `territories.battle_locked_by = caller` on `target_territory_id`.
- [ ] Append to `0003_battles.verification.sql` (Task 6): one query
  exercising `declare_attack`'s main rejection paths (attacking a
  territory that already has a non-resolved battle on it, attacking one's
  own territory, attacking with a non-owned/non-stationed card instance,
  attacking while at the 32-territory cap) — same manual-checklist
  acceptance pattern as `0002_territories.sql`'s Task 6.
- [ ] Commit: `feat: add declare_attack RPC`

### Task 8: Amend `start_claim`, `cancel_claim`, `build_structure`

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append)

- [ ] `create or replace function start_claim(...)` — copy the existing
  function body from `0002_territories.sql` verbatim, add a new first
  step calling `resolve_due_battles()` (so a stale `battle_locked_by`
  from an already-resolved/expired battle can't wrongly block a claim),
  and change the destination-availability `where` clause (currently
  `owner_id is null and claim_locked_by is null`, per
  `0002_territories.sql` line ~352) to additionally require: no
  unit-category `card_instances` row with `owner_id is null` stationed at
  the destination (NPC garrison check, closing the bugfix from spec §1),
  **and** `battle_locked_by is null` (spec §3.6's amendment). Everything
  else in the function body is unchanged.
- [ ] `create or replace function cancel_claim(territory_id integer)` —
  copy the existing body, add a new first step calling
  `resolve_due_battles()`, then one new early check: raise if `exists
  (select 1 from battles where battles.territory_id = territory_id and
  defender_id = caller and status not in ('resolved', 'expired'))` (spec
  §3.6 — can't cancel a claim currently being defended in a contested-claim
  battle).
- [ ] `create or replace function build_structure(territory_id integer,
  card_instance_id uuid)` — copy the existing body, add a new first step
  calling `resolve_due_battles()`, then one new early check: raise if
  `exists (select 1 from territories where id = territory_id and
  battle_locked_by is not null)` (spec §3.6).
- [ ] Explicitly confirm (comment in the migration, and verify by reading
  `0002_territories.sql`'s `start_transfer` body) that `start_transfer`
  needs **no** amendment — reinforcing an owned territory under attack is
  intentionally still allowed (spec §3.6's explicit carve-out).
- [ ] Append to `0003_battles.verification.sql` (Task 6): one query per
  amended RPC exercising its new rejection path (`start_claim` against an
  NPC-garrisoned tile, `start_claim` against a `battle_locked_by` tile,
  `cancel_claim` by the defender of an active contested-claim battle,
  `build_structure` on a `battle_locked_by` tile) — same manual-checklist
  acceptance pattern as Task 6/7.
- [ ] Commit: `feat: amend start_claim/cancel_claim/build_structure for battle_locked_by`

---

## Chunk 4: `resolve_due_movements()` extension (attack arrival + claim-downgrade)

### Task 9: Extend `resolve_due_movements()` with the `kind='attack'` branch

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append)

- [ ] `create or replace function resolve_due_movements()` — copy the
  existing body from `0002_territories.sql` (lines ~125-180) verbatim,
  and add a new branch for `kind = 'attack'` movements whose
  `transfer_arrives_at <= now()` and `status = 'in_transit'`, structured
  as its own `update ... returning` + follow-up block (matching the
  existing transfer/claim branches' style, not one giant combined query):
  1. Flip the moved `card_instances` to `status='stationed'` at the
     destination (identical SQL to the existing `transfer` branch).
  2. Mark the movement `completed`.
  3. For each such arrival, re-read the current state of
     `target_territory_id` fresh (this function runs lazily, so "now" is
     whenever a client next triggers it — never assume state hasn't
     changed since `declare_attack`) and classify per spec §2's
     "Contested empty-land claims" walkthrough / §3.6's
     `resolve_due_movements()` bullet:
     - **Occupied** (`owner_id is not null and owner_id != attacker`):
       insert `battles` (`defender_id = owner_id`, `is_home_target =
       target.is_home`).
     - **Contested claim** (`owner_id is null and claim_locked_by is not
       null and claim_locked_by != attacker`): insert `battles`
       (`defender_id = claim_locked_by`, `is_home_target = false`) —
       explicitly do **not** touch `claim_locked_by` or the original
       claimant's `troop_movements` row here (spec §2's walkthrough: no
       pausing, resolved entirely at battle-resolution time in Task 11).
     - **NPC-garrisoned** (`owner_id is null and claim_locked_by is null`
       and at least one unit-category `card_instances` row with
       `owner_id is null` stationed there): insert `battles` (`defender_id
       = null`).
     - **Now truly empty** (state changed during travel): clear
       `territories.battle_locked_by` (no battle exists for this
       arrival — the lock must not linger once the contested state that
       justified it has resolved), re-verify the 32-cap defensively, and
       fall back to exactly `start_claim`'s effect: set `claim_locked_by
       = attacker` and start a normal claim occupation (reuse whatever
       `start_claim` does for
       this — factor the shared logic into a small internal helper
       function if it's more than a couple of lines, to avoid duplicating
       `start_claim`'s occupation-timer math).
  4. For the three combat-classified cases: set `status='awaiting_ready'`
     and `ready_deadline = now() + interval '10 days'`, **unless**
     `defender_id is null` (NPC), in which case set `status='active'` and
     `round_deadline = now()` (already-due, not `+ interval '120
     seconds'` — an NPC battle should resolve in full the moment
     anything next calls `resolve_due_battles()`, not wait out a human
     decision window it has no human for), and populate
     `battle_attacker_roster` from the movement's `troop_movement_units`
     in every combat case.
  5. For a newly `active` NPC battle (`defender_id is null`)
     specifically, immediately call `resolve_due_battles()` (Task
     10/12's function, defined later in this same migration file — safe
     forward reference for the same reason explained in Task 7: plpgsql
     resolves called-function references at execution time, not creation
     time, and the whole migration is applied before the app ever calls
     any of these RPCs at runtime) so the entire round sequence plays out
     synchronously, in the same transaction, before `declare_attack`
     returns to its caller (spec §4: NPC battles "resolve every round
     automatically and immediately", no 120-second wait, no separate
     trigger needed). `battle_rounds` still gets a full replay trail for
     the client to animate afterward — only the *server-side* resolution
     is synchronous, the UI still paces its own replay.
- [ ] Commit: `feat: extend resolve_due_movements for attack arrivals`

---

## Chunk 5: `resolve_due_battles()` — the core lazy-resolution engine

### Task 10: `resolve_due_battles()` — ready-timeout tie-breaks (case 1 of spec §3.6)

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append)

- [ ] Write `create or replace function resolve_due_battles() returns
  void` (called at the top of every RPC in this chunk and chunk 6, same
  lazy-resolution convention as `resolve_due_movements()`). Start with
  the `awaiting_ready` branch — for every battle with `status =
  'awaiting_ready' and ready_deadline <= now()`, resolve per spec §2/§3.6
  exactly:
  - **Neither `*_ready_at` set**: `status='expired'`, `winner_side=null`,
    clear `battle_locked_by`, send the attacker's entire roster home via
    a new `troop_movements` row (`kind='transfer'`, `transferHours`
    formula, destination = the original `origin_territory_id`, looked up
    from the linked `troop_movements`/`movement_id`). Defender's own
    cards are untouched (no query needed — nothing about them changes).
  - **Only `defender_ready_at` set**: same cleanup as above, but
    `winner_side='defender'`.
  - **Only `attacker_ready_at` set, OR both set but not simultaneously
    "online"** (join against `players.last_seen_at` for both
    `attacker_id`/`defender_id`, checking both are within 2 minutes of
    `greatest(attacker_ready_at, defender_ready_at)` — spec §3.6's exact
    tie-break condition, matching `2026-08-15-players-accounts-design.md`
    §6's online definition): `winner_side='attacker'`. Then branch again
    on capture eligibility (not `is_home_target` and not at 32-cap):
    - **Captures**: `owner_id=attacker`, clear `claim_locked_by` and
      `battle_locked_by`; attacker's roster needs no movement (spec §2's
      uniform rule — it's already stationed there); defender's own cards
      (still defender-owned — no combat ran) go home to `(select id from
      territories where owner_id = defender_id and is_home)` via a return
      `troop_movements` row.
    - **Blocked** (`is_home_target` or capped): only clear
      `battle_locked_by`; send the attacker's entire roster home (spec
      §2's uniform rule again — no duels ran, so it's the whole roster,
      identical mechanically to the "neither ready" case).
  - In every sub-case: `resolved_at = now()`.
- [ ] Note on test coverage: spec §8 lists ready-deadline tie-break logic
  and the 32-cap check as testable behaviors, but per this project's
  established convention (no `lib/`-side duplication of DB-only business
  rules — see `2026-08-15-territory-map-plan.md`'s occupation-timer and
  cap-check logic, which are also SQL-only), this logic lives directly in
  `resolve_due_battles()`/`declare_attack` and is covered exclusively by
  this task's manual `.verification.sql` fixtures, not a `lib/battles/`
  pure-function unit test — unlike combat-stat stacking and NPC AI (Task
  2/3), which are extracted into pure functions specifically because
  their math is intricate enough to warrant fast, DB-free Jest iteration.
  The ready-timeout/cap checks are simple conditionals better verified
  directly against real rows.
- [ ] Append to `0003_battles.verification.sql` (Task 6): fixture-driven
  smoke queries for these 4 sub-cases — seed a `battles` row directly at
  various `ready_deadline`/`*_ready_at` combinations (including
  backdating `players.last_seen_at` to simulate offline/online), call
  `select resolve_due_battles();`, and assert the resulting
  `status`/`winner_side`/`territories.owner_id`/`battle_locked_by`/new
  return `troop_movements` rows match by hand-checking the query output —
  same manual-checklist acceptance pattern as Task 6/7/8 (this project
  has no automated RPC-level test harness yet, per
  `0002_territories.sql`'s own Task 4a/6 convention; do not invent a new
  Jest/pgTAP harness for this plan alone).
- [ ] Commit: `feat: add resolve_due_battles ready-timeout resolution`

### Task 11: A shared SQL round-resolution helper (combat math + NPC AI, ported from `lib/battles/`)

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append)
- Test: `lib/battles/effectiveStats.parity.test.ts` (new, small parity
  test — see below)

- [ ] Before wiring round resolution into `resolve_due_battles()`, write
  one internal SQL function, `_resolve_round(battle_id uuid, attacker_card
  uuid, defender_card uuid, auto_picked boolean) returns void`, that
  **directly reimplements** Task 2's `computeEffectiveStats` math and
  `resolveDuel`'s TTK comparison in PL/pgSQL (this is a firm decision, not
  an open question: combat resolution must happen inside the DB
  transaction so concurrent RPC calls can't race past each other, so a
  client-side-only implementation isn't an option; duplicating the ~15
  lines of arithmetic in SQL is simpler and more auditable than round-
  tripping to an edge function per round). It: looks up both cards'
  `card_templates`/`card_instances` rows, the territory's
  `castle_rank`/`village_rank`, and each card's *current owner's* nation;
  applies rank scaling, structure bonus (defender side only), nation perk,
  rounds once; compares TTK exactly as `resolveDuelWithBreakdown` does;
  writes the `battle_rounds` row (`winner_card_instance_id` = the losing
  card's new owner's card, i.e. the round's winning side's card instance);
  flips the loser's `card_instances.owner_id` to the winner's current
  owner; upserts `battle_unit_rest` for both cards
  (`resting_until_round = battles.current_round + 2`); increments
  `battles.current_round`.
- [ ] Write `lib/battles/effectiveStats.parity.test.ts`: a small,
  hand-picked table of ~8 sample inputs (varying rank, nation, presence of
  castle/village) run through `computeEffectiveStats` (TypeScript) with
  the exact same inputs also run once manually through `_resolve_round`'s
  SQL against a scratch DB (documented as a manual step in this test's
  comments, since Jest can't reach a live DB in CI here — assert the
  TypeScript side's outputs match a table of expected integers that were
  independently verified against the SQL function once, by hand, when
  this task is implemented). This is the parity safety net the spec's
  rounding rule (§3.5) depends on.
- [ ] For **starting** a round (as opposed to resolving one already in
  progress): write a second small internal helper, `_start_next_round(battle_id
  uuid) returns void`, called (a) immediately when a battle flips to
  `active` (from `mark_ready`, Task 12, or from an NPC arrival in Task 9),
  and (b) immediately after `_resolve_round` finishes and the win
  condition isn't yet met. It inserts the next `battle_rounds` row with
  `round_number = current_round + 1`: picks a random available (per Task
  4's rest logic) card from `battle_attacker_roster` still owned by the
  attacker for `attacker_card_instance_id`; for an NPC battle
  (`defender_id is null`), also immediately picks the defender's card via
  Task 3's `pickNpcDefenderCard` logic (ported into this same SQL helper —
  loop candidate NPC cards through the same TTK comparison `_resolve_round`
  uses, pick the first winner or fall back to `random()`) and calls
  `_resolve_round` synchronously in the same call, looping until the win
  condition is met; for a PvP battle, leaves `defender_card_instance_id
  null` and sets `battles.round_deadline = now() + interval '120
  seconds'`, then returns (waiting for `pick_defender_card` or a future
  `resolve_due_battles()` auto-pick). If no attacker card is available
  (all resting), or (for PvP) no defender card is available, marks the
  round `skipped=true` immediately, still increments `current_round`, and
  recurses into `_start_next_round` again for the following round (spec
  §2's skip rule — a skipped round still ticks rest counters down).
- [ ] Commit: `feat: add shared round-resolution and round-start SQL helpers`

### Task 12: `resolve_due_battles()` — round-timeout auto-pick + win-condition finalize (cases 2-3 of spec §3.6)

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append)

- [ ] Extend `resolve_due_battles()` with the `active`-battle branch,
  built on Task 11's two helpers:
  1. For every `status='active'` battle whose current round still has no
     `defender_card_instance_id` and `round_deadline <= now()`: auto-pick
     a random available defender card (Task 4's rest logic) and call
     `_resolve_round(..., auto_picked=true)`.
  2. After `_resolve_round` runs (from step 1 here, or from
     `pick_defender_card` in Task 13, or from Task 11's NPC loop),
     re-evaluate the win condition: attacker's roster
     (`battle_attacker_roster` join `card_instances`) has zero rows still
     `owner_id = attacker_id`, OR the defender/NPC has zero unit-category
     `card_instances` left `stationed` at `territory_id` (irrespective of
     resting status — only *this round's* eligibility check cares about
     resting, per spec §3.6). If met: finalize using the same
     capture/blocked branching as Task 10 (same territory-ownership and
     card-cleanup rules — this is the same uniform rule from spec §2;
     factor it into one shared internal helper, `_finalize_battle(battle_id
     uuid, winner_side text)`, used by both Task 10 and this task rather
     than duplicating the SQL). If not met, call `_start_next_round`
     (Task 11) to begin the next round, which itself handles the
     skip-round case (spec §2) internally.
- [ ] Append to `0003_battles.verification.sql` (Task 6): a full 3-round
  PvP battle fixture (seed `battle_attacker_roster`/available defender
  cards, call `select resolve_due_battles();` repeatedly with a
  backdated `round_deadline` to simulate timeouts, hand-check the final
  `status='resolved'`/`winner_side`/territory ownership/card ownership
  against a worked-by-hand expected outcome); an NPC battle fixture
  (single `declare_attack` against an NPC-garrisoned tile followed by one
  `select resolve_due_battles();` call resolves the entire battle); a
  skip-round fixture (attacker's roster fully resting for one round,
  confirm the round is logged `skipped=true` and rest counters still
  decrement) — same manual-checklist convention as every other RPC task
  in this plan.
- [ ] Commit: `feat: add resolve_due_battles round resolution and win-condition finalize`

---

## Chunk 6: `mark_ready` and `pick_defender_card` RPCs

### Task 13: `mark_ready` RPC

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append)
- Test: append to `0003_battles.verification.sql`

- [ ] Write `mark_ready(battle_id uuid) returns void`: call
  `resolve_due_battles()` first (lazy-resolution convention); raise if
  caller isn't `attacker_id` or `defender_id`; raise if `status !=
  'awaiting_ready'`; set the caller's own `*_ready_at = now()`
  **idempotently** (always overwrites, re-callable any number of times —
  needed because either side may call `mark_ready` multiple times before
  both are online simultaneously, per spec §3.6); then, if
  the other side's `*_ready_at` is already set and both players'
  `last_seen_at` are within 2 minutes of `now()`, flip
  `status='active'` and call Task 11's `_start_next_round` to create the
  first round — `_start_next_round` itself sets `round_deadline` (per
  Task 11: `now() + interval '120 seconds'` for a PvP defender pick), so
  `mark_ready` doesn't set that timestamp directly.
- [ ] Append to `0003_battles.verification.sql`: first caller sets their
  own timestamp, stays `awaiting_ready`; second caller (online) flips to
  `active` and a first `battle_rounds` row appears with
  `attacker_card_instance_id` set; second caller (offline — backdate
  `last_seen_at`) stays `awaiting_ready` with both timestamps now set; a
  third, later call to `mark_ready` by either side re-evaluates and *can*
  flip to `active` once both are simultaneously online (confirms
  re-callability, not just first-call evaluation); non-participant caller
  raises.
- [ ] Commit: `feat: add mark_ready RPC`

### Task 14: `pick_defender_card` RPC

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append)
- Test: append to `0003_battles.verification.sql`

- [ ] Write `pick_defender_card(battle_id uuid, card_instance_id uuid)
  returns void`: call `resolve_due_battles()` first; raise if caller
  isn't the battle's *current* `defender_id`; raise if `status !=
  'active'` or the current round already has a
  `defender_card_instance_id` assigned; validate `card_instance_id` is
  currently owned by the caller, `status='stationed'` at `territory_id`,
  unit-category, and not resting (Task 4's `isAvailable` logic, ported to
  SQL); then call Task 11's `_resolve_round` helper directly, passing
  `auto_picked=false`.
- [ ] Append to `0003_battles.verification.sql`: valid pick resolves the
  round and (if it's a win-condition round) finalizes the battle
  identically to Task 12's fixtures; picking a resting/foreign/non-unit
  card raises; picking after the round already has a pick raises;
  non-defender caller raises.
- [ ] Commit: `feat: add pick_defender_card RPC`

---

## Chunk 7: Realtime + UI

### Task 15: Realtime channel wiring (battle screen + map)

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append, or a short
  separate `alter publication` statement — check how
  `0002_territories.sql` enabled replication for `troop_movements`, if it
  did, and match that exact mechanism)
- Create: `lib/battles/useBattleChannel.ts` (or match whatever
  hook/subscription naming convention `components/territories/` already
  uses for realtime subscriptions, if one exists — check before naming
  this)
- Create: `lib/battles/useTerritoryBattleChannel.ts` (map-side
  subscription — separate hook from the battle-screen one above, since
  it has a different scope: many territories in a viewport, not one
  battle)

- [ ] Enable replication on `battles`, `battle_rounds`, and `territories`
  (spec §6 explicitly requires **both** the live 120-second round window
  *and* the map's "under attack" visibility to push without polling —
  this is new scope this spec adds on top of the map, not conditional on
  whether the map's existing `claim_locked_by` display already had
  realtime).
- [ ] `useBattleChannel(battleId)`: subscribes to `postgres_changes` on
  `battles` (filtered to one `battle_id`) and `battle_rounds` (insert
  events, filtered to one `battle_id`) — used by the battle screen (Task
  18).
- [ ] `useTerritoryBattleChannel(territoryIds)`: subscribes to
  `postgres_changes` `UPDATE` events on `territories` filtered to the
  currently-visible viewport's territory ids, specifically watching
  `battle_locked_by` transitions — used by the map (Task 20) so "under
  attack" flags appear/disappear live as battles are declared/resolved,
  without requiring the user to pan/zoom to trigger a refetch.
- [ ] Manual verification: two browser sessions against a live
  `awaiting_ready` battle, confirm marking ready in one session updates
  the other without a page refresh; separately, confirm a third session
  viewing the map sees the target tile's "under attack" indicator appear
  the moment `declare_attack` runs in another session, with no manual
  refresh.
- [ ] Commit: `feat: add battle realtime subscriptions for battle screen and map`

### Task 16: `get_battle` read RPC

**Files:**
- Modify: `supabase/migrations/0003_battles.sql` (append)
- Create: `lib/battles/getBattle.ts` (thin typed client wrapper, matching
  whatever pattern `lib/territories/` uses for wrapping `get_viewport`/
  `get_my_movements` — check that file before naming/shaping this)

- [ ] Write `get_battle(battle_id uuid) returns jsonb` (or a `returns
  table (...)` matching this project's existing read-RPC return-shape
  convention — check `get_viewport`'s exact return style in
  `0002_territories.sql` and match it, not `jsonb` if the convention is
  typed columns): **calls `resolve_due_battles()` first** (so a PvP
  battle's ready-timeout or round-timeout gets resolved lazily the moment
  the battle screen loads or polls, matching the existing project-wide
  lazy-resolution convention — NPC battles no longer depend on this call
  specifically, since Task 9 now resolves them synchronously already,
  inside `resolve_due_movements()` at the moment the attack *arrives*
  (whenever that function is next lazily triggered after the travel
  window elapses — not at the earlier `declare_attack` moment when the
  attack was first declared), but PvP battles still do), then returns
  everything the battle screen (Task 18) needs to render both roster
  strips and the duel stage in one round-trip:
  - the `battles` row itself (status, `current_round`, `round_deadline`,
    `ready_deadline`, `winner_side`, `attacker_id`/`defender_id`,
    `is_home_target`).
  - `battle_attacker_roster` joined with `card_instances`/
    `card_templates` (rank, base stats, current owner) and a computed
    `is_resting` flag per card (per Task 4's `isAvailable` logic, applied
    against `battle_unit_rest` and the battle's `current_round`) — this
    is the left `RosterStrip`'s data source.
  - the defender's *currently available* pool: unit-category
    `card_instances` stationed at `territory_id`, owned by the current
    `defender_id` (or `owner_id is null` for an NPC target), with the
    same computed `is_resting` flag — this is the right `RosterStrip`'s
    data source (spec §3.4: this pool is never fixed, recomputed fresh
    each call).
  - the full `battle_rounds` history (for `RoundHistory`).
- [ ] Append to `0003_battles.verification.sql`: calling `get_battle` on
  a PvP battle past its `ready_deadline` with no ready confirmations
  returns it already `status='expired'` (confirming the lazy trigger
  works end-to-end for the read path too, not just the mutating RPCs).
- [ ] Commit: `feat: add get_battle read RPC`

### Task 17: Declare-attack UI entry point

**Files:**
- Modify: `components/territories/TerritoryDetailPanel.tsx` (add an
  "Attack" action alongside whatever existing claim/transfer actions it
  already renders for a selected, non-owned territory — read this file
  first to match its existing action-button/modal pattern exactly)
- Create: `components/territories/DeclareAttackModal.tsx`

- [ ] Build a modal (opened from `TerritoryDetailPanel`'s new "Attack"
  button, shown only when the selected territory isn't the caller's own)
  that lets the caller pick one of their own owned territories as the
  origin (reuse whatever origin-picker UI `start_claim`/`start_transfer`'s
  existing modal already uses, if one exists — check before building a
  second one) and a subset of that origin's stationed unit-category cards
  (reuse `GarrisonModal.tsx`'s card-grid rendering, in a selectable-checkbox
  mode) via a "select cards to send" step, then calls `declare_attack`.
  On success (the RPC returns the new `troop_movements.id`, and — via
  Task 15's map realtime channel — the target tile's `battle_locked_by`
  will already reflect the attack), navigate the caller to
  `app/battles/[id]`. Since `declare_attack` itself only returns the
  `troop_movements.id`, not a `battles.id` (the `battles` row doesn't
  exist yet until arrival — spec §2/§3.6), this navigation target must
  instead be the territory detail view (already open) rather than the
  battle screen; the caller reaches the actual `app/battles/[id]` screen
  later via the click-through built in Task 20, once the attack has
  arrived and a `battles` row exists.
- [ ] Surface `declare_attack`'s rejection errors (32-cap, own territory,
  already-battling territory) as inline modal errors, not generic toasts
  — match whatever error-display convention `start_claim`'s existing
  modal (if any) uses.
- [ ] Component test(s) for the modal's card-selection and submit flow,
  following existing RTL conventions (mock the `declare_attack` RPC
  call).
- [ ] Commit: `feat: add declare-attack UI entry point`

### Task 18: Battle screen — desktop layout

**Files:**
- Create: `app/battles/[id]/page.tsx`
- Create: `components/battles/BattleScreen.tsx`
- Create: `components/battles/RosterStrip.tsx`
- Create: `components/battles/DuelStage.tsx`
- Create: `components/battles/RoundHistory.tsx`

- [ ] Build the approved layout A (spec §7 desktop): `RosterStrip`
  (attacker's roster, left, greyed-out resting cards) — `DuelStage`
  (center: two `TradingCard`s facing off, round countdown, running
  score) — `RosterStrip` (defender's currently-available cards, right,
  clickable during the defender's 120s window, calling
  `pick_defender_card`) — collapsible `RoundHistory` below, reading
  `battle_rounds` (reuse the existing `TradingCard` component from
  subsystem #1, same as `GarrisonModal.tsx` already does — do not build a
  new card-rendering component).
- [ ] Load initial state via Task 16's `get_battle` on mount, then wire
  `mark_ready`/`pick_defender_card` calls and Task 15's
  `useBattleChannel` hook so the screen updates live without polling
  after that.
- [ ] Component test(s) following existing RTL conventions used
  elsewhere in the project (check `components/territories/*.test.tsx`
  for the exact setup/mocking pattern before writing new ones).
- [ ] Commit: `feat: add desktop battle screen`

### Task 19: Battle screen — mobile layout

**Files:**
- Modify: `components/battles/BattleScreen.tsx` (or extract a
  `components/battles/BattleScreen.mobile.tsx` if the existing project
  convention for responsive components favors separate files — check how
  the map viewport component handles its own mobile variant first)

- [ ] Collapse both `RosterStrip` columns into horizontally-scrollable
  strips stacked above/below `DuelStage` on narrow viewports, matching
  the approved visual-companion mockup (`.superpowers/brainstorm/...`
  session, `battle-layout-mobile.html` — reference for exact breakpoint/
  layout behavior, not copied verbatim).
- [ ] Manual verification at a mobile portrait viewport width (dev tools
  device toolbar) — confirm no horizontal page overflow and both strips
  remain usable via scroll.
- [ ] Commit: `feat: add mobile battle screen layout`

### Task 20: Map integration — `battle_locked_by` visibility

**Files:**
- Modify: whichever component currently renders `claim_locked_by`'s
  "under claim" map indicator (check `components/territories/` for the
  exact file — likely the hover tooltip and/or tile-styling component
  built in this session's earlier "hover" work) and the `get_viewport`/
  `get_minimap_overview` client-side types

- [ ] Extend `get_viewport`/`get_minimap_overview` SQL functions (in
  `0003_battles.sql`) to also `select` and `return` **both**
  `battle_locked_by` (the attacker's player id, matching exactly how
  `claim_locked_by` is already returned, spec §3.1) **and** the
  in-progress `battles.id` for that territory (a scalar subquery — `id`
  from the same non-`resolved`/`expired` `battles` row `declare_attack`/
  `resolve_due_movements()` already guarantee is unique per territory,
  Task 5's `battles_territory_idx`) so the client has a concrete battle
  id to navigate to without a second round-trip.
- [ ] Wire Task 15's `useTerritoryBattleChannel` hook into the map
  viewport component so `battle_locked_by`/battle-id changes for
  currently-visible tiles push live, per spec §6 (this task's map
  changes and Task 15's channel are companion pieces — do not consider
  either done without the other).
- [ ] Add a distinct "under attack" visual treatment (spec doesn't
  mandate an exact style — reuse whatever visual language
  `claim_locked_by` already has, adjusted so the two states are
  distinguishable, e.g. a different border color/icon) to the hover
  tooltip and tile rendering.
- [ ] Add a click-through: clicking any `battle_locked_by`-flagged tile
  navigates to `app/battles/[id]`, for **any** viewer, not just its two
  participants — spec §3.6's RLS is explicitly public-read, and "no
  spectating" only means no *interference* (enforced at the RPC layer by
  `mark_ready`/`pick_defender_card`'s caller checks), not restricted
  *viewing*. Do not gate this navigation by participant identity.
- [ ] Component test(s) for the new hover-tooltip/tile-styling branch,
  following the existing test file's conventions.
- [ ] Commit: `feat: show battle_locked_by on the territory map`

---

## Chunk 8: Final integration pass

### Task 21: End-to-end smoke test + `tsc`/full suite

**Files:** none new — verification only

- [ ] Run `npx tsc --noEmit` — expect PASS, no type errors across the new
  `lib/battles/` modules and UI components.
- [ ] Run `npx jest` (full suite) — expect PASS, no regressions in the
  existing subsystem #1-#3 suites.
- [ ] Manual smoke test against a scratch/staging Supabase project (never
  live without explicit user go-ahead and a backup, per this session's
  established convention): declare an attack against an NPC-garrisoned
  tile end-to-end, confirm it resolves automatically; declare a PvP
  attack, have both test accounts mark ready, play a full round loop to
  a win condition, confirm territory/card ownership matches expectations
  and surviving cards return home correctly per the uniform cleanup rule.
- [ ] Update `docs/superpowers/PROGRESS.md` to mark subsystem #4 as
  implemented (per that file's own stated "update as you go" convention).
- [ ] **Hard gate, even after every automated check above passes:** do
  not commit or push any of this chunk's changes until the user has
  explicitly reviewed and approved the working feature end-to-end
  (mirrors `2026-08-15-territory-map-plan.md`'s equivalent final-task
  gate) — this project's standing convention requires explicit sign-off
  before any commit, not just green tests.
- [ ] Commit (only after the user's explicit approval above):
  `docs: mark subsystem #4 implemented in PROGRESS.md`
