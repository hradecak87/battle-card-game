# Card Collection & Combat Core — Implementation Plan

Implements the design in
`docs/superpowers/specs/2026-08-15-card-collection-combat-core-design.md`.

Note: the `writing-plans` skill was unavailable in this environment, so this
plan was authored directly following the same principles (small verifiable
steps, tests before/alongside code, explicit verification commands).

## Step 1 — Project scaffold

- `npx create-next-app@14` (App Router, TypeScript, Tailwind, `src/` off,
  ESLint on) in the current empty project directory.
- Add Jest + React Testing Library (`jest`, `ts-jest` or `next/jest`,
  `@testing-library/react`, `@testing-library/jest-dom`).
- Verify: `npm run build` succeeds on the scaffolded starter; `npm test`
  runs (even with 0 tests).

## Step 2 — Card types

- `lib/cards/types.ts`: `UnitType`, `Rank`, `CardTemplate`, `CardInstance`
  (per spec §2, §5).
- No tests needed (types only); verify with `tsc --noEmit`.

## Step 3 — Combat logic (`lib/cards/combat.ts`)

- `applyRank(baseStats, rank): EffectiveCard` — multiplies by the rank
  multiplier table (§3), rounds each attribute to nearest integer, clamps to
  minimum 0.
- `resolveDuel(attacker: EffectiveCard, defender: EffectiveCard): 'attacker' | 'defender'`
  per the exact algorithm in spec §7.
- Jest tests (`lib/cards/combat.test.ts`):
  - `applyRank`: all 5 ranks scale all 4 attributes correctly; rounding;
    clamps negative results to 0.
  - `resolveDuel`: attacker decisive win, defender decisive win, the
    archer-vs-spearman scenario from the spec explicitly, zero-damage/
    infinite-TTK case, exact-tie case (defender wins), mutual-infinite case
    (defender wins).
- Verify: `npm test -- combat`.

## Step 4 — Unit type baseline data

- `lib/cards/unit-types.ts`: the 8 unit types' baseline stats + descriptive
  role text (spec §5 table), as a typed constant — this is the reference
  baseline the catalog data's variants are authored against, not consumed
  directly by combat/UI code.

## Step 5 — Catalog content authoring (`lib/cards/catalog-data.json`)

- Author all 248 card templates (8 unit types × 31 variants: 10 common, 8
  uncommon, 6 rare, 4 epic, 3 legend) following spec §6: honorific naming
  progression, ±10% flavor variance baked into `baseStats`, `totalSupply`
  (null for common/uncommon; a fixed number within 20-50/5-15/1-5 for
  rare/epic/legend), unique `id` (`{unitType}-{rank}-{2-digit index}`) and
  unique `name` per template, short flavor text per template.
- This is content-authoring work (can be done in one pass, e.g. LLM-assisted,
  following the naming examples already given for Archers in the spec) —
  not algorithmic generation.

## Step 6 — Catalog loader (`lib/cards/catalog.ts`)

- Loads `catalog-data.json`, validates it at import time against the
  structural rules (throws synchronously on failure, per spec §9):
  exactly 248 templates; correct per-rank counts per unit type; unique
  IDs/names; `totalSupply` correct (null vs. in-range positive number);
  no negative `baseStats` values.
- Exposes typed accessors: `getAllTemplates()`, `getTemplatesByType(unitType)`,
  `getTemplateById(id)`.
- Jest tests (`lib/cards/catalog.test.ts`): validation passes on the real
  data file; a temporary malformed fixture (wrong count / duplicate id /
  out-of-range supply / negative stat) throws for each violation type.
- Verify: `npm test -- catalog`.

## Step 7 — Collection browser page (`app/collection/`)

- Lists all 248 templates from `catalog.ts`.
- Filters: unit type (8 options) and rank (5 options).
- Each card shows: name, unit type, rank, effective stats (via `applyRank`),
  flavor text, and `totalSupply` (or "unlimited").
- Light component test: filter narrows the visible list correctly for a
  unit-type filter and a rank filter.

## Step 8 — Duel arena page (`app/arena/`)

- Two card pickers (any two templates from the catalog, including picking
  the same template twice).
- On "Fight": runs `resolveDuel` and displays a step-by-step breakdown —
  each side's `atk`, `dmg`, `ttk`, and the final winner — so the reasoning is
  visible (per spec §8).
- Light component test: selecting two cards and fighting shows a winner and
  the breakdown values match what `resolveDuel`'s inputs would produce.

## Step 9 — Final verification

- `npm run build` (production build succeeds, no type errors).
- `npm test` (full suite green).
- Manual smoke check: run `npm run dev`, open `/collection` and `/arena` in
  a browser, confirm filtering and a duel both work end-to-end.

## Out of scope (unchanged from spec §11)

No accounts, no map, no multi-army battles, no trading, no admin minting
UI, no notifications — those are future specs.
