# Progress Notes — Card Collection & Combat Core (subsystem #1)

Status snapshot written just before a context compaction, so implementation
can resume smoothly. Read this file first if context was lost.

## Where things live

- **Project root**: `C:\Users\z0040m9d\Documents\Projects\Battle card game V2`
  (this is also the git repo root — `git init` was run directly here).
- **Spec** (approved, reviewed, committed):
  `docs/superpowers/specs/2026-08-15-card-collection-combat-core-design.md`
- **Implementation plan** (committed):
  `docs/superpowers/plans/2026-08-15-card-collection-combat-core-plan.md`
- **Session todos**: tracked in the SQL `todos`/`todo_deps` tables (session DB,
  not in the repo). Query ready-to-work todos with the standard dependency
  join (see plan file for the 9-step breakdown: scaffold-project,
  card-types, combat-logic, unit-type-baselines, catalog-content,
  catalog-loader, collection-page, arena-page, final-verify).

## What's done so far

1. ✅ **scaffold-project** — Next.js 14 (App Router) + TypeScript + Tailwind
   scaffolded via `create-next-app` into a temp dir (because the folder name
   "Battle card game V2" has spaces/capitals, invalid for npm package names)
   then moved into the project root; `package.json` "name" manually fixed to
   `battle-card-game-v2`. Jest + `ts-jest`-free `next/jest` config added
   (`jest.config.js`, `jest.setup.ts` with `@testing-library/jest-dom`).
   `npm run build` and `npm test` (no tests yet) both verified working.
   Committed (3 commits: scaffold, package name/jest fixes, then untracking
   `.superpowers/` brainstorming artifacts from git — added to `.gitignore`).

2. ✅ **card-types** — `lib/cards/types.ts` written: `UnitType`, `Rank`,
   `CardTemplate`, `CardInstance`, `EffectiveCard`, `RawStats`, plus exported
   constants `UNIT_TYPES`, `RANKS`, `VARIANTS_PER_RANK` (10/8/6/4/3),
   `SUPPLY_RANGE` (rare 20-50, epic 5-15, legend 1-5). Verified with
   `npx tsc --noEmit` (no errors). **Not yet committed to git** — do this
   before/with the next commit.

3. ✅ **combat-logic** — `lib/cards/combat.ts` written and **verified**: all
   12 Jest tests in `combat.test.ts` pass (`npm test -- combat`), and
   `npx tsc --noEmit` is clean project-wide. Details:
   - `RANK_MULTIPLIER` table (common 1.0, uncommon 1.15, rare 1.35, epic 1.6,
     legend 2.0)
   - `applyRank(baseStats, rank): EffectiveCard` — multiplies, rounds to
     nearest int, clamps to min 0
   - `resolveDuel(attacker, defender): 'attacker'|'defender'` and
     `resolveDuelWithBreakdown(...)` implementing the TTK formula from spec
     §7 (atk = max(str,lng); dmg = max(0, atk - def); ttk = hp/dmg or
     Infinity; lower ttk wins; ties/mutual-infinite → defender wins)
   - `lib/cards/combat.test.ts` written with test cases: rank scaling for all
     5 ranks, negative-clamp defensive case, attacker decisive win, defender
     decisive win, an "archer vs fragile spearman" scenario demonstrating the
     intended archer-wins-before-melee dynamic, zero-damage/infinite-TTK
     cases (both sides infinite, one side infinite), and exact-tie TTK.
   - `lib/cards/combat.test.ts` written and passing (12/12 tests): rank
     scaling for all 5 ranks, negative-clamp defensive case, attacker
     decisive win, defender decisive win, an "archer vs fragile spearman"
     scenario demonstrating the intended archer-wins-before-melee dynamic,
     zero-damage/infinite-TTK cases (both sides infinite, one side
     infinite), and exact-tie TTK.
   - **Committed together with `unit-types.ts` and `types.ts`** in the next
     commit after this file was written (see git log for exact commit).

4. ✅ **unit-type-baselines** — `lib/cards/unit-types.ts` written and
   type-checked. `UNIT_TYPE_BASELINES` record mapping each of the 8
   `UnitType`s to `{ stats: RawStats; role: string }` per the spec §5 table
   (archers, crossbowmen, spearmen, swordsmen, halberdiers, knights,
   lightCavalry, siegeEngines with their str/lng/def/hp/role).

5. ✅ **project-instructions** — `.github/copilot-instructions.md` created,
   pointing at this file as the authoritative state snapshot to read first
   and update continuously.

## Immediate next steps (in order)

1. Move to **catalog-content**: author `lib/cards/catalog-data.json` — 248
   card templates (8 unit types × 31 variants: 10 common, 8 uncommon, 6 rare,
   4 epic, 3 legend), following spec §6 naming pattern (common folk →
   legendary named individuals), ±10% flavor variance baked into
   `baseStats` per variant, `totalSupply` null for common/uncommon and a
   fixed number in-range for rare/epic/legend, unique `id`
   (`{unitType}-{rank}-{2-digit index}`) and unique `name`, short flavor text.
   Example names already given in the spec for Archers — extend the same
   pattern to the other 7 types.
6. **catalog-loader**: `lib/cards/catalog.ts` — loads + validates
   `catalog-data.json` at import time (throws synchronously on: wrong total
   count, wrong per-rank/per-type counts, duplicate ids/names, invalid
   totalSupply, negative baseStats), exposes `getAllTemplates()`,
   `getTemplatesByType()`, `getTemplateById()`. Tests in
   `lib/cards/catalog.test.ts` (real data validates; malformed fixtures throw
   per violation type).
7. **collection-page**: `app/collection/` — list/filter by unit type + rank,
   shows effective stats (via `applyRank`) + flavor text + totalSupply.
8. **arena-page**: `app/arena/` — pick 2 cards, run
   `resolveDuelWithBreakdown`, show step-by-step atk/dmg/ttk breakdown and
   winner.
9. **final-verify**: `npm run build`, `npm test`, manual `npm run dev` smoke
   test of `/collection` and `/arena`.

## Key decisions/conventions to remember

- No backend/DB/auth in this subsystem — pure logic + `localStorage` only,
  consistent with the previous Napoleonic card game project's MVP approach.
- Card supply/minting is data-model-only here (`totalSupply` on
  `CardTemplate`); actual admin minting UI and reward-distribution triggers
  are explicitly out of scope (future Players/Battle specs).
- Git commit trailer required on every commit:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- User approved starting implementation ("začni") on 2026-08-15; do not need
  to re-ask for permission to continue this same plan, but per the custom
  instructions, still do NOT commit anything until a meaningfully-sized,
  tested unit is ready and the user has reviewed/approved it in this
  session's flow (the brainstorming/planning-approved commits so far were
  docs-only and scaffold/config, which is a lighter bar; use judgment before
  committing actual game-logic code — probably fine once combat.ts tests
  pass, since that's a coherent, tested unit, but flag it to the user in the
  next message rather than silently committing without mention).
- `.superpowers/brainstorm/...` visual companion server was started earlier
  (session-only, ephemeral) but never actually used for anything visual —
  it's fine if it's no longer running after compaction; no need to restart it
  unless a visual question comes up later.
