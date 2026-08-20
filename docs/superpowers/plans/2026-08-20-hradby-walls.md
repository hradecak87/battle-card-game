# Hradby (Walls) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third structure card, Hradby (Walls), that is mutually exclusive with Castle+Village on a territory and grants a combined defense + ranged-defense bonus (half of Village's rank scale), with matching map/collection art and acquisition via existing reward channels (not the starter kit).

**Architecture:** Mirror the existing Castle/Village pattern end-to-end: a new `wall_rank` column on `territories`, new `wall-<rank>` rows in `card_templates`, extended CHECK constraints enforcing mutual exclusivity, an extended `build_structure()` RPC, and a new rank-based bonus table threaded through both the TypeScript combat engine (`lib/battles/effectiveStats.ts` / `lib/territories/structureBonus.ts`) and its hand-maintained SQL mirror (`_compute_effective_stats()` and its callers). Frontend surfaces the new state via a new `WallIcon`, updated territory panels/modals, and a new illustrated collection tile.

**Tech Stack:** Next.js 14, TypeScript, Tailwind, Jest, Supabase/Postgres (raw SQL migrations, no migration-tracking table — applied live via a scratch Node script using `pg` and `SUPABASE_DB_URL` from `.env.local`).

**Spec:** `docs/superpowers/specs/2026-08-20-hradby-walls-design.md` — read this first for full rationale and all approved decisions.

---

## Chunk 1: Combat math (TypeScript) + card model types

### Task 1: `structureBonus.ts` — add Wall bonus table

**Files:**
- Modify: `lib/territories/structureBonus.ts`
- Test: `lib/territories/structureBonus.test.ts` (check if it exists; if not, create it — check first via `Get-ChildItem lib/territories/*.test.ts`)

- [ ] **Step 1:** Read the current file and its existing tests (if any) to confirm current export shapes and how `combinedDefenseBonusPct(castleRank, villageRank)` is called elsewhere (`grep -rn "combinedDefenseBonusPct\|castleAttackBonusPct" --include=*.ts lib components`). Note every call site — every one must be updated to pass a third `wallRank` argument (or explicitly `null` where a wall can never apply, e.g. attacker-side computations).

- [ ] **Step 2: Write failing tests** for the new behavior:

```ts
describe('wallRangedBonusPct', () => {
  it('returns 0 for null rank', () => {
    expect(wallRangedBonusPct(null)).toBe(0)
  })
  it('returns the rank-scaled bonus', () => {
    expect(wallRangedBonusPct('common')).toBe(5)
    expect(wallRangedBonusPct('uncommon')).toBe(10)
    expect(wallRangedBonusPct('rare')).toBe(17)
    expect(wallRangedBonusPct('epic')).toBe(27)
    expect(wallRangedBonusPct('legend')).toBe(40)
  })
})

describe('combinedDefenseBonusPct with wallRank', () => {
  it('adds the wall bonus when provided', () => {
    expect(combinedDefenseBonusPct(null, null, 'rare')).toBe(17)
  })
  it('defaults wallRank to null (existing 2-arg call sites unaffected)', () => {
    expect(combinedDefenseBonusPct('common', 'common')).toBe(20 + 10)
  })
})
```

- [ ] **Step 2b:** Run the new tests, confirm they fail (function/table don't exist yet).

- [ ] **Step 3: Implement.** Add:

```ts
const WALL_BONUS_PCT: Record<Rank, number> = {
  common: 5,
  uncommon: 10,
  rare: 17,
  epic: 27,
  legend: 40,
}

export function wallRangedBonusPct(wallRank: Rank | null): number {
  return wallRank !== null ? WALL_BONUS_PCT[wallRank] : 0
}
```

Update `combinedDefenseBonusPct` signature to `(castleRank: Rank | null, villageRank: Rank | null, wallRank: Rank | null = null)` and add `+ (wallRank !== null ? WALL_BONUS_PCT[wallRank] : 0)` to the return sum. Keep `WALL_BONUS_PCT` exported if other modules need it directly (check step 1's grep results), otherwise keep private like the other two tables.

- [ ] **Step 4:** Run tests, confirm pass.

- [ ] **Step 5: Commit.** `git add lib/territories/structureBonus.ts lib/territories/structureBonus.test.ts && git commit -m "feat: add wall bonus table to structureBonus"`

---

### Task 2: `effectiveStats.ts` — apply wall bonus in combat calc

**Files:**
- Modify: `lib/battles/effectiveStats.ts`
- Test: `lib/battles/effectiveStats.parity.test.ts` (extend, do NOT break existing 8 cases)

- [ ] **Step 1:** Add `wallRank: Rank | null` to `EffectiveStatsInput`.

- [ ] **Step 2: Write failing test cases** appended to `effectiveStats.parity.test.ts`'s `testCases` array — at minimum:
  - A defender with `wallRank: 'rare'`, no castle/village → expect `def` and `str`/`lng` both boosted by 17% (hand-trace exactly like the existing 8 cases do, following the same `sqlTrace` comment convention).
  - A defender with `wallRank: 'legend'`, `castleRank: null`, `villageRank: null`, combined with a nation perk, to confirm ordering (wall bonus applies in the same "structure bonus" step as castle/village, before the nation perk multiplier).
  - An attacker (`isDefendingThisRound: false`) with `wallRank: 'legend'` set → expect NO bonus applied (walls only help the defender, exactly like castle/village today).

- [ ] **Step 2b:** Run `npx jest lib/battles/effectiveStats.parity.test.ts`, confirm the new cases fail.

- [ ] **Step 3: Implement** in `computeEffectiveStats`:

```ts
if (input.isDefendingThisRound) {
  const defenseMultiplier =
    1 + combinedDefenseBonusPct(input.castleRank, input.villageRank, input.wallRank) / 100
  effective = { ...effective, def: effective.def * defenseMultiplier }

  const rangedAttackBonusPct = castleAttackBonusPct(input.castleRank) + wallRangedBonusPct(input.wallRank)
  if (rangedAttackBonusPct > 0) {
    const attackMultiplier = 1 + rangedAttackBonusPct / 100
    effective = { ...effective, str: effective.str * attackMultiplier, lng: effective.lng * attackMultiplier }
  }
}
```

Import `wallRangedBonusPct` alongside the existing imports. Note: castle and wall can never both be non-null (mutual exclusivity), so `castleAttackBonusPct(...) + wallRangedBonusPct(...)` is safe/equivalent to an if/else — this is simpler to read and matches how `combinedDefenseBonusPct` already sums independent contributors.

- [ ] **Step 4:** Run the full parity test file, confirm all cases (old 8 + new) pass.

- [ ] **Step 5:** Find every other call site that constructs an `EffectiveStatsInput` (`grep -rn "computeEffectiveStats(" lib components`) and add `wallRank` to each (pull the value from wherever `castleRank`/`villageRank` are already being read — they come from the same `Territory` row in every case).

- [ ] **Step 6: Commit.** `git add lib/battles/effectiveStats.ts lib/battles/effectiveStats.parity.test.ts && git commit -m "feat: apply wall bonus in computeEffectiveStats"`

---

### Task 3: `lib/cards/types.ts` and `lib/territories/api.ts` — type updates

**Files:**
- Modify: `lib/cards/types.ts`
- Modify: `lib/territories/api.ts`

- [ ] **Step 1:** In `lib/cards/types.ts`, widen `StructureCardTemplate`'s `category` union from `'castle' | 'village'` to `'castle' | 'village' | 'wall'`. Check whether `attackBonusPct`/`defenseBonusPct` are already both optional/nullable on the shared type (they must be, since Village has no attack bonus) — if so no further type change is needed there, since Wall populates both like Castle does.

- [ ] **Step 2:** In `lib/territories/api.ts`, add `wall_rank: Rank | null` to the `Territory` type, next to `castle_rank`/`village_rank`.

- [ ] **Step 3:** Run `npx tsc --noEmit` — fix any resulting type errors at call sites that destructure `Territory` or construct one in tests/fixtures (grep for `castle_rank:` in `.test.ts`/`.test.tsx` fixtures and add `wall_rank: null` alongside each).

- [ ] **Step 4: Commit.** `git add lib/cards/types.ts lib/territories/api.ts && git commit -m "feat: add wall_rank/category types"`

---

## Chunk 2: Database migration (schema + combat SQL mirror)

### Task 4: Migration `0047_wall_structure_card.sql` — schema, templates, constraints

**Files:**
- Create: `supabase/migrations/0047_wall_structure_card.sql`
- Create: `supabase/migrations/0047_wall_structure_card.verification.sql`

Next free migration number is `0047` (last used: `0046_diplomacy_rpcs`). Follow the existing repo convention: a `begin; ... rollback;` self-contained verification script that can safely run against production (see any recent `*.verification.sql` for the pattern), asserting each new behavior with `raise exception` on failure.

- [ ] **Step 1:** Write the schema section:

```sql
alter table territories
  add column if not exists wall_rank text
    check (wall_rank in ('common','uncommon','rare','epic','legend'));
```

- [ ] **Step 2:** Insert the 5 new `card_templates` rows (mirror the exact row shape used by `castle-<rank>`/`village-<rank>` rows — check `scripts/seed-card-templates.ts` and the original `0002_territories.sql`/`0003_battles.sql` insert statements for the full column list, e.g. `id, category, rank, name, defense_bonus_pct, attack_bonus_pct, ...`):

  | rank | id | defense_bonus_pct | attack_bonus_pct |
  |---|---|---|---|
  | common | `wall-common` | 5 | 5 |
  | uncommon | `wall-uncommon` | 10 | 10 |
  | rare | `wall-rare` | 17 | 17 |
  | epic | `wall-epic` | 27 | 27 |
  | legend | `wall-legend` | 40 | 40 |

- [ ] **Step 3:** Rewrite the `card_templates` CHECK constraints (same drop-all-and-recreate pattern as `0026_boost_cards.sql` lines 20-70 — drop every constraint on `card_templates` via the `pg_constraint` loop, then re-add all of them):
  - `card_templates_category_check`: add `'wall'` to the `in (...)` list.
  - `card_templates_structure_bonus_shape_check`: add `'wall'` to `category in ('castle', 'village')`.
  - `card_templates_structure_bonus_required_check`: add `'wall'` to `category not in ('castle', 'village')`.
  - New `card_templates_wall_attack_required_check`: `check (category <> 'wall' or attack_bonus_pct is not null)` (Wall requires both bonuses, like Castle).
  - Re-add every other existing constraint unchanged (copy them verbatim from `0026_boost_cards.sql`).

- [ ] **Step 4:** Add the mutual-exclusivity constraint on `territories`:

```sql
alter table territories
  add constraint territories_wall_exclusive_check
    check (wall_rank is null or (castle_rank is null and village_rank is null));
```

(This single constraint is sufficient — it's violated by any row that has `wall_rank` set alongside either `castle_rank` or `village_rank`, which covers both directions of the exclusivity rule.)

- [ ] **Step 5:** Write the verification script asserting: (a) `wall-common`..`wall-legend` exist in `card_templates` with the right category/percentages, (b) inserting/updating a territory row with both `wall_rank` and `castle_rank` set raises an error, (c) a row with only `wall_rank` set succeeds. Wrap in `begin; ... rollback;`.

- [ ] **Step 6:** Do NOT apply yet — later tasks add more to this same migration file (build_structure, combat SQL, rewards). Apply once at the end of Chunk 2 (Task 8).

---

### Task 5: `build_structure()` — allow `'wall'` category + exclusivity check

**Files:**
- Modify: `supabase/migrations/0047_wall_structure_card.sql` (append)

The latest `build_structure()` definition lives in `supabase/migrations/0003_battles.sql` (search `create or replace function build_structure`) — it has never been redefined since. Append a full `create or replace function build_structure(...)` in the new migration, copying that body and applying these changes:

- [ ] **Step 1:** Change `if tmpl_category not in ('castle', 'village') then` to `if tmpl_category not in ('castle', 'village', 'wall') then`.

- [ ] **Step 2:** Extend the existing-rank lookup / conflict check to a 3-way branch:

```sql
if tmpl_category = 'castle' then
  select castle_rank into existing_rank from territories where id = territory_id;
elsif tmpl_category = 'village' then
  select village_rank into existing_rank from territories where id = territory_id;
else
  select wall_rank into existing_rank from territories where id = territory_id;
end if;
if existing_rank is not null then
  raise exception 'territory already has a % structure', tmpl_category;
end if;

-- Mutual exclusivity: wall vs castle/village.
if tmpl_category = 'wall' then
  if exists (select 1 from territories where id = territory_id and (castle_rank is not null or village_rank is not null)) then
    raise exception 'territory already has a Castle or Village; cannot build Walls';
  end if;
else
  if exists (select 1 from territories where id = territory_id and wall_rank is not null) then
    raise exception 'territory already has Walls; cannot build Castle/Village';
  end if;
end if;

if tmpl_category = 'castle' then
  update territories set castle_rank = tmpl_rank where id = territory_id;
elsif tmpl_category = 'village' then
  update territories set village_rank = tmpl_rank where id = territory_id;
else
  update territories set wall_rank = tmpl_rank where id = territory_id;
end if;
```

- [ ] **Step 3:** Add verification-script assertions: building Wall on a territory with an existing Castle raises; building Castle on a territory with existing Walls raises; building Wall on a clean territory succeeds and sets `wall_rank`.

---

### Task 6: SQL combat mirror — `_compute_effective_stats()` and its 3 live callers

**Files:**
- Modify: `supabase/migrations/0047_wall_structure_card.sql` (append)

The authoritative combat function is `_compute_effective_stats()`, last (and only) defined in `0003_battles.sql`. Its only three **currently-live callers** (the last `create or replace function <name>` occurrence of each, confirmed by searching every migration file) are:
- `_resolve_round` — latest version in `0030_wire_card_limit.sql`
- `_territory_effective_unit_power` — only defined in `0027_npc_kingdoms.sql`
- `_pick_npc_defender_card` — latest version in `0027_npc_kingdoms.sql`

Before writing code, re-run `grep -n "^create or replace function _resolve_round\|^create or replace function _territory_effective_unit_power\|^create or replace function _pick_npc_defender_card\|^create or replace function _compute_effective_stats" supabase/migrations/*.sql` yourself to double check no later migration (after this plan was written) has redefined any of them — always modify the LAST occurrence of each function name.

- [ ] **Step 1:** Append a `create or replace function _compute_effective_stats(...)` that adds one new trailing parameter `p_wall_rank text default null` (return type and existing params unchanged, so `create or replace` works without dropping). Inside, add a `WALL_BONUS_PCT`-equivalent inline `case` (mirror the existing inline castle/village case statements at lines ~810-820 of `0003_battles.sql`):

```sql
v_def_bonus_pct := coalesce(case p_village_rank
    when 'common' then 10 when 'uncommon' then 20 when 'rare' then 35
    when 'epic' then 55 when 'legend' then 80 else 0 end, 0)
  + coalesce(case p_castle_rank
    when 'common' then 20 when 'uncommon' then 35 when 'rare' then 55
    when 'epic' then 80 when 'legend' then 120 else 0 end, 0)
  + coalesce(case p_wall_rank
    when 'common' then 5 when 'uncommon' then 10 when 'rare' then 17
    when 'epic' then 27 when 'legend' then 40 else 0 end, 0);

v_atk_bonus_pct := coalesce(case p_castle_rank
    when 'common' then 10 when 'uncommon' then 20 when 'rare' then 35
    when 'epic' then 55 when 'legend' then 80 else 0 end, 0)
  + coalesce(case p_wall_rank
    when 'common' then 5 when 'uncommon' then 10 when 'rare' then 17
    when 'epic' then 27 when 'legend' then 40 else 0 end, 0);

if v_atk_bonus_pct > 0 then
  v_str := v_str * (1 + v_atk_bonus_pct / 100.0);
  v_lng := v_lng * (1 + v_atk_bonus_pct / 100.0);
end if;

v_def := v_def * (1 + v_def_bonus_pct / 100.0);
```

(This replaces the old `if p_castle_rank is not null then ... end if;` ranged-bonus branch with the always-safe `if v_atk_bonus_pct > 0` check, since wall can now also contribute independently of castle.)

- [ ] **Step 2:** Append `create or replace function _resolve_round(...)` copying the full current body from `0030_wire_card_limit.sql` verbatim, with these changes: every `select castle_rank, village_rank into v_castle_rank, v_village_rank from territories where id = ...` becomes `select castle_rank, village_rank, wall_rank into v_castle_rank, v_village_rank, v_wall_rank from territories where id = ...` (add `v_wall_rank text;` to the `declare` block), and every call to `_compute_effective_stats(..., v_castle_rank, v_village_rank)` becomes `_compute_effective_stats(..., v_castle_rank, v_village_rank, v_wall_rank)`.

- [ ] **Step 3:** Same treatment for `_territory_effective_unit_power` (copy from `0027_npc_kingdoms.sql`) and `_pick_npc_defender_card` (copy latest from `0027_npc_kingdoms.sql`) — add `wall_rank`/`v_wall_rank` fetch and threading wherever they currently fetch/thread `castle_rank`/`village_rank`.

- [ ] **Step 4:** Add verification-script assertions: call `_compute_effective_stats` directly with a wall rank and defender=true, assert the def/atk bonus matches the TS parity test's hand-traced numbers for at least one case (e.g. `wall_rank => 'rare'` should give the same 17%/17% as the TS test in Task 2).

---

### Task 7: Reward functions — 1/3 split instead of 50/50

**Files:**
- Modify: `supabase/migrations/0047_wall_structure_card.sql` (append)

Two live functions currently do `case when random() < 0.5 then 'castle' else 'village' end` to pick a structure-card reward:
- `_award_xp` — latest in `0035_wire_world_events.sql` (level-milestone reward, every 5 levels)
- `_finalize_battle_base_0025` — latest in `0030_wire_card_limit.sql` (1% post-battle-win bonus roll)

- [ ] **Step 1:** For each, append a `create or replace function` copying the current full body verbatim, changing only the category pick to a 3-way random split:

```sql
v_structure_category := case
  when random() < 1.0/3 then 'castle'
  when random() < 0.5 then 'village'  -- 0.5 of the *remaining* 2/3 = 1/3 overall
  else 'wall'
end;
```

- [ ] **Step 2:** Do NOT touch the starter-kit grant in `_complete_kingdom_onboarding_core`/`complete_kingdom_onboarding` (latest in `0027_npc_kingdoms.sql`) — per the approved design, Walls are excluded from the starter kit.

- [ ] **Step 3:** Add verification-script assertions (statistical smoke test is unnecessary — just assert the function bodies reference `'wall'` via `pg_get_functiondef`, or manually invoke each function in a loop of ~50 rolls inside the verification script and assert all 3 categories appear at least once — acceptable flakiness risk given a `begin/rollback` test harness).

---

### Task 8: Home-territory candidate filter + `get_viewport()`/read RPCs — expose `wall_rank`

**Files:**
- Modify: `supabase/migrations/0047_wall_structure_card.sql` (append)

- [ ] **Step 1:** Find the latest occurrence of the home-candidate filter `t.castle_rank is null and t.village_rank is null` (search across migrations, use the LAST one — likely inside `_complete_kingdom_onboarding_core` in `0027_npc_kingdoms.sql`) and extend it to also exclude `t.wall_rank is null` — i.e. a home candidate must have no structures of any kind.

- [ ] **Step 2:** `get_viewport()` — latest defined in `0043_target_owner_visibility.sql`. Append a `create or replace function get_viewport(...)` copying that body, adding `wall_rank` to both the returned `table (...)` column list and the `select` list (next to `castle_rank`/`village_rank`). Since this changes the return type, you must `drop function get_viewport(smallint, smallint, smallint, smallint);` before the `create or replace` (Postgres requires identical return signature for `create or replace`).

- [ ] **Step 3:** Check `get_minimap_overview()` (latest in `0027_npc_kingdoms.sql`) and any other read RPC returning `castle_rank`/`village_rank` (grep `castle_rank` across all migrations once more to be sure nothing was missed) — extend each analogously, using `drop function` + `create or replace` where the return type changes.

- [ ] **Step 4:** Add verification-script assertions calling `get_viewport(0::smallint, 0::smallint, 5::smallint, 5::smallint)` and confirming the new `wall_rank` column is present and null by default.

---

### Task 9: Apply migration live and run full verification

**Files:** none (execution only)

- [ ] **Step 1:** Write a temporary Node script (delete after use) using the `pg` npm package, reading `SUPABASE_DB_URL` from `.env.local` (strip trailing `\r`), to run `0047_wall_structure_card.sql` against the live database, matching the pattern used for every prior migration this session (see git history / `PROGRESS.md` for the exact snippet shape).

- [ ] **Step 2:** Run `0047_wall_structure_card.verification.sql` the same way — it's self-contained `begin; ... rollback;`, safe against production.

- [ ] **Step 3:** Delete the scratch script.

- [ ] **Step 4: Commit.** `git add supabase/migrations/0047_wall_structure_card.sql supabase/migrations/0047_wall_structure_card.verification.sql && git commit -m "feat: add Hradby (walls) structure card — schema, combat math, rewards"`

---

## Chunk 3: Frontend — map icon, panels, modals, collection

### Task 10: `WallIcon` in `StructureIcons.tsx` + asset

**Files:**
- Modify: `components/territories/icons/StructureIcons.tsx`
- Create: `public/icons/structures/wall.png`

- [ ] **Step 1:** Locate the user-provided `hradby.png` (check project root, same place `domov.png` was found previously). Resize it to 512×512 to match every other structure icon (reuse the same Python/PIL one-liner used for `home.png` earlier this session), save as `public/icons/structures/wall.png`, and remove any root-level copy.

- [ ] **Step 2:** Add a `WallIcon` component built on the existing `StructureImg` component, following the exact pattern of the recently-added `HomeIcon` (fixed `variant="wall"`, no `pickVariant` needed — single design, no rank-variant art).

- [ ] **Step 3:** Export `WallIcon` alongside `CastleIcon`/`VillageIcon`/`HomeIcon`.

- [ ] **Step 4: Commit.** `git add public/icons/structures/wall.png components/territories/icons/StructureIcons.tsx && git commit -m "feat: add WallIcon structure icon"`

---

### Task 11: `MapViewport.tsx` — render `WallIcon`

**Files:**
- Modify: `components/territories/MapViewport.tsx`
- Test: `components/territories/MapViewport.test.tsx`

- [ ] **Step 1:** Find where `CastleIcon`/`VillageIcon` are conditionally rendered based on `territory.castle_rank`/`territory.village_rank`. Add an analogous branch rendering `WallIcon` when `territory.wall_rank` is set (mutually exclusive with the castle/village branch by construction — no extra guard needed, but write it as an independent `if wall_rank` check for clarity, matching how `HomeIcon`/`CastleIcon`/`VillageIcon` are already independently gated).

- [ ] **Step 2: Write failing test** — a territory fixture with `wall_rank: 'rare'` (and `castle_rank`/`village_rank: null`) renders the wall icon; confirm it does NOT also render castle/village icons.

- [ ] **Step 3:** Run, confirm fail, implement, run again, confirm pass.

- [ ] **Step 4: Commit.**

---

### Task 12: `GarrisonModal.tsx` — display + build-button gating

**Files:**
- Modify: `components/territories/GarrisonModal.tsx`
- Test: `components/territories/GarrisonModal.test.tsx`

- [ ] **Step 1:** Add a `{territory.wall_rank && <p>Hradby: {territory.wall_rank}</p>}` line next to the existing `Hrad:`/`Vesnice:` lines (around line 525-526).

- [ ] **Step 2:** Update the build-button-visibility condition (around line 422, currently `canTransfer && (!territory.castle_rank || !territory.village_rank)`) so:
  - The "Postavit Hradby" button/section only shows when `!territory.castle_rank && !territory.village_rank && !territory.wall_rank`.
  - The "Postavit Hrad"/"Postavit Vesnici" sections (currently gated on `!territory.castle_rank` / `!territory.village_rank` individually around lines 424/472) additionally require `!territory.wall_rank`.

- [ ] **Step 3:** Write/extend tests covering: territory with `wall_rank` set shows no castle/village build buttons and shows the "Hradby: <rank>" line; territory with no structures shows all three build options including Hradby; territory with a castle shows no Hradby build option.

- [ ] **Step 4:** Run tests (fail → implement → pass).

- [ ] **Step 5: Commit.**

---

### Task 13: `TerritoryDetailPanel.tsx` — display line

**Files:**
- Modify: `components/territories/TerritoryDetailPanel.tsx`
- Test: `components/territories/TerritoryDetailPanel.test.tsx`

- [ ] **Step 1:** Add `{territory.wall_rank && <p className="text-sm text-zinc-400">Hradby: {territory.wall_rank}</p>}` next to the existing Hrad/Vesnice lines (around line 92-93). Check the `npc-garrisoned` classification helper (line 39, currently `territory.castle_rank || territory.village_rank`) — extend it to `|| territory.wall_rank` too, so a wall-only NPC territory is still classified/styled consistently.

- [ ] **Step 2:** Write/extend a test asserting the new line renders for a wall-garrisoned territory fixture.

- [ ] **Step 3:** Run, implement, run, pass. Commit.

---

### Task 14: `DeclareAttackModal.tsx` — bonus preview

**Files:**
- Modify: `components/territories/DeclareAttackModal.tsx`
- Test: `components/territories/DeclareAttackModal.test.tsx`

- [ ] **Step 1:** Around lines 92-97, add:

```ts
const wallRank = territory.wall_rank as Rank | null
const wallDefenseBonus = wallRank ? combinedDefenseBonusPct(null, null, wallRank) : 0
const wallRangedBonus = wallRangedBonusPct(wallRank)
```

Update `totalDefenseBonus` to `combinedDefenseBonusPct(castleRank, villageRank, wallRank)`. Import `wallRangedBonusPct` alongside the existing `structureBonus` imports.

- [ ] **Step 2:** Find where `castleDefenseBonus`/`castleAttackBonus`/`villageDefenseBonus` are rendered as preview text/lines and add an analogous `Hradby: +N % defense, +N % dálkový útok` line, shown only when `wallRank` is set.

- [ ] **Step 3:** Write/extend tests: a territory with `wall_rank: 'epic'` shows the correct "+27%"-style preview text and no castle/village bonus lines.

- [ ] **Step 4:** Run, implement, run, pass. Commit.

---

### Task 15: `/collection` page — illustrated Wall card tile

**Files:**
- Modify: `app/collection/page.tsx`
- Test: `app/collection/page.test.tsx`
- Create (if it doesn't already exist as a reusable piece): a small `StructureCardTile`-style component, or inline JSX directly in the `'wall'` branch of the existing category switch/fallback (around lines 300-400) — follow whichever pattern keeps `app/collection/page.tsx` from growing further; if it's already large, extracting a small new component file is reasonable (see Writing Plans skill guidance on file size).

- [ ] **Step 1:** Locate the current generic fallback tile rendering for `category === 'castle' | 'village'` (plain text tile, no image). Add a new branch specifically for `category === 'wall'` that renders `hradby.png`-style artwork (reuse `/icons/structures/wall.png`, or a distinct higher-res asset if the user's `hradby.png` differs from the map icon — check the actual asset the user provides and ask if unclear, though per the approved design this can reuse the same file) inside a card frame consistent with `TradingCard`'s rank-colored border treatment. Leave Castle/Village tiles completely unchanged.

- [ ] **Step 2:** Write/extend a test asserting a `wall` category card instance in the collection fixture renders an `<img>` with the wall asset, while a `castle`/`village` fixture still renders the old plain tile unchanged.

- [ ] **Step 3:** Run, implement, run, pass. Commit.

---

### Task 16: `scripts/seed-card-templates.ts` — documentation parity (non-functional)

**Files:**
- Modify: `scripts/seed-card-templates.ts`

This script is NOT re-run in production (the live catalog is seeded once; new templates are added via migration `insert` statements, per established project convention — see `0026_boost_cards.sql`'s boost-card rows). Update it anyway for documentation/local-dev parity, matching the `castle`/`village` block shape:

- [ ] **Step 1:** Add a `wallDef: number` field to `STRUCTURE_BONUS_TABLE` per rank (5/10/17/27/40), and a `wall-<rank>` template generation block mirroring `castle-<rank>`/`village-<rank>` (category `'wall'`, `defense_bonus_pct` and `attack_bonus_pct` both set to `wallDef`).

- [ ] **Step 2:** Run any existing test for this script if one exists (`Get-ChildItem scripts/*.test.ts`); otherwise just confirm the file still runs/compiles (`npx tsc --noEmit`).

- [ ] **Step 3: Commit.**

---

## Chunk 4: Final verification

### Task 17: Full suite, typecheck, build

**Files:** none (verification only)

- [ ] **Step 1:** Run the full Jest suite (`npm test -- --ci` or the project's usual full-suite command) — confirm all suites pass, note the new total test count.

- [ ] **Step 2:** Run `npx tsc --noEmit` — confirm clean.

- [ ] **Step 3:** Run `npm run build` — confirm it succeeds; spot-check the `/collection` and map routes are still listed.

- [ ] **Step 4:** Update `docs/superpowers/PROGRESS.md` with a dated entry summarizing the Hradby feature (schema, combat math change, reward-split change, new UI surfaces) — follow the project's established PROGRESS.md convention.

- [ ] **Step 5: Final commit** (if anything outstanding): `git add docs/superpowers/PROGRESS.md && git commit -m "docs: update PROGRESS.md for Hradby (walls) feature"`.

---

## Notes for the implementing agent

- This plan touches **live production SQL functions** with real player data. Every `create or replace function` in Chunk 2 must be a byte-for-byte copy of the current live body plus only the documented diff — do not "clean up" or refactor unrelated logic while you're in there.
- Before writing each SQL task, re-verify with `grep` that no migration numbered higher than what's referenced here has since redefined that function (this plan was written against the migration set ending at `0046_diplomacy_rpcs`).
- If you hit a migration-number collision with other in-flight work when this plan is executed, follow the established renumbering procedure documented in `docs/superpowers/PROGRESS.md` (rename via `git mv`, fix self-referencing filename comments, re-run tests, no live-DB re-application needed unless names collide).
- Mutual exclusivity (wall XOR castle/village) is enforced at 3 layers intentionally: the DB CHECK constraint (belt), `build_structure()`'s explicit checks (suspenders), and implicitly in the frontend button-gating (UX — prevents the error from ever being hit in normal play). Keep all 3.
