# Progress & Source of Truth — Battle Card Game V2

**This file is the single source of truth for what to do and why.** It must
be self-sufficient: everything needed to resume work — full context, every
brainstorming decision, the full implementation plan, and exact current
status — lives here. Always read this file first when resuming work
(especially after a context compaction or in a new session), and always
update it as work progresses (not just at the end of a session).

---

## 1. Big picture: this is subsystem #1 of a much larger game

The user's full vision (from the original brainstorming conversation) is a
medieval web card game with: card collection & combat, player accounts with
"nation" classes and XP/levels, a 256×256 territory map with occupation and
castles/villages, real-time multi-army RTS battles between players, a card
trading exchange, and notifications. That whole vision was judged **too
large for one spec** and was explicitly decomposed into independent specs,
each with its own spec → plan → implementation cycle:

1. **Card Collection & Combat Core** ← **✅ FULLY IMPLEMENTED AND VERIFIED** (all 9 plan steps done, 30/30 tests pass, `npm run build` clean, viewable at `/`, `/collection`, `/arena`)
2. Players & Accounts (registration, nation classes/perks, XP/levels, matchmaking by level) ← **next up, not designed yet**
3. Territory Map (256×256 grid, occupation timers, castles/villages, troop transfers)
4. Multi-army RTS Battle (real-time, both players online, timeouts, rest-area cooldowns, reuses subsystem #1's `resolveDuel` as its per-duel building block)
5. Trading/Exchange (offer a card, others counter-offer with cards, accept/reject)
6. Notifications (attack alerts, trade offers — email and/or push, mechanism not yet decided)

Subsystems 2-6 are **not designed yet** — do not build anything for them.
Now that subsystem #1 is fully implemented and verified, the next step is to
run the `brainstorming` skill again for subsystem #2, following the same
process (explore → clarify → propose approaches → design → spec → review →
plan → implement).

## 2. Where things live

- **Project root**: `C:\Users\z0040m9d\Documents\Projects\Battle card game V2`
  — this is also the git repo root (`git init` was run directly here, no
  prior history).
- **Previous related project** (for reference/consistency, NOT part of this
  repo): `C:\Users\z0040m9d\Documents\Projects\Battle card game` — a simpler
  Napoleonic-themed Durak-like card game (Next.js 14 + TS + Tailwind + Jest,
  no backend). This V2 project intentionally reuses its tech stack and MVP
  philosophy (local logic first, backend added only when a later subsystem
  actually needs it).
- **Spec** (approved, reviewed by spec-document-reviewer subagent, committed):
  `docs/superpowers/specs/2026-08-15-card-collection-combat-core-design.md`
- **Implementation plan** (committed):
  `docs/superpowers/plans/2026-08-15-card-collection-combat-core-plan.md`
  (the `writing-plans` skill was unavailable in this environment, so the
  plan was authored directly following the same principles — small
  verifiable steps, tests alongside code, explicit verification commands)
- **Session todos**: tracked in the SQL `todos`/`todo_deps` tables (session
  DB, not in the repo — if a new session starts, these will be gone and
  must be inferred from the "Step-by-step plan & status" section below
  instead).
- **Git commit trailer** required on every commit:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

## 3. All brainstorming decisions for subsystem #1 (the "why" behind the spec)

These are the actual answers the user gave during brainstorming, preserved
here so nothing gets silently re-litigated or forgotten:

- **Scope decomposition approved as listed in section 1 above.**
- **Visual companion**: offered and enabled, but never actually used — all
  questions for this subsystem turned out to be conceptual/textual, not
  visual. The brainstorming visual-companion server was started once at
  `http://localhost:56949` (ephemeral, session-only, long since stopped —
  do not try to reuse it; start a fresh one if a genuinely visual question
  comes up in a future subsystem).
- **Number of unit types**: user chose **8-10** (not 15-20, not fewer) —
  landed on exactly 8.
- **Rank vs. unit type relationship**: user chose **"unique_per_rank"** —
  each rank tier of a unit type has its own uniquely-named cards (not just
  one archetype scaled up). Explicit requirement: cards must have "honosné"
  (honorific/grand) original names, e.g. common archer = "Práčata", legend
  archer = "Nejostřejší šípy". **Duplicates in battle allowed** — a player
  can own a Common and a Legend version of the same unit type
  simultaneously; they're independent cards.
- **Collector feel is a first-class requirement**: the user explicitly said
  the collection must satisfy the feeling of owning something legendary,
  and rarity must be visible (e.g. "how many of this named card exist in
  the game").
- **Rank multiplier scaling**: user chose **"mild"** — Common ×1.0,
  Uncommon ×1.15, Rare ×1.35, Epic ×1.6, Legend ×2.0. Rank is a bonus;
  which stats a unit type has (its archetype) matters more for outcomes
  than raw rarity.
- **Combat/duel resolution approach**: user was offered 3 options (A:
  phased ranged-then-melee simulation, B: single formula/no phases, C:
  phased with initiative/multiple volleys) and **chose B**. This led to the
  time-to-kill (TTK) "damage race" formula in the spec (§7) — a single
  closed-form calculation, no round-by-round simulation, that still
  naturally produces the desired archer-beats-fragile-melee-unit dynamic
  because the archer's TTK against a low-HP target is much lower than the
  melee unit's TTK against the archer.
- **Card instance/supply source**: user was offered 3 options for how new
  card copies enter the game (A: all pre-exist at world start held by NPCs,
  B: generated continuously as reward drops, C: hybrid) and **chose B, with
  an explicit amendment: new card instances must only be minted by an
  admin action**, not by any automatic algorithm. This produced the
  `CardInstance.mintedBy: 'admin'` field and the rule that reward systems
  (in later specs) draw from an already-minted, unclaimed pool — they never
  auto-generate new instances themselves.
- **Rarity/supply hybrid model confirmed**: Common/Uncommon = uncapped
  supply (never a bottleneck). Rare/Epic/Legend = fixed `totalSupply` cap
  per named card, chosen at content-authoring time within: Rare 20-50
  (inclusive), Epic 5-15 (inclusive), Legend 1-5 (inclusive).
- **Named variants per rank per unit type**: user was offered
  3-4/2-3/2/1-2/1 (common/uncommon/rare/epic/legend) and explicitly asked
  for **3× those numbers** "aby sbírka karet nebyla zas moc malá" (so the
  collection isn't too small) → landed on **10/8/6/4/3**, giving 31
  variants/type × 8 types = **248 unique card templates** total.
  Each variant within a rank gets a fixed **±10% flavor stat variance**
  baked in permanently at authoring time (not re-rolled per physical copy).
- **Demo output scope**: user was offered "logic + tests only" vs. "logic +
  a simple interactive demo UI" and **chose the demo UI** — a
  Next.js/Tailwind app with a collection browser and a duel arena, no
  accounts/backend, so balance/content can be validated visually before
  building anything else.
- User confirmed every section of the spec explicitly (data model, 8 unit
  types + stats table, naming/variant-count approach, the TTK formula, and
  the overall tech stack/demo summary) before it was written and
  spec-reviewed.
- Spec review loop: 4 iterations with the `spec-document-reviewer` subagent
  (issues found → fixed → re-reviewed) until **Approved** on iteration 4.
  Fixed issues included: clarifying `totalSupply` as a content-authored cap
  vs. runtime `mintedCount`, clarifying "rank" vs "rarity" were the same
  concept (removed duplicate terminology), defining the `EffectiveCard`
  type explicitly, changing "1-10 scale" wording to "0-10 scale" (Siege
  Engines has `str: 0`), and clarifying that unit-type "roles" (e.g.
  "anti-cavalry" for Spearmen) are flavor-only — there is no mechanical
  counter/bonus system, everything emerges from the raw 4 stats via the TTK
  formula.
- User approved the final spec as-is ("ne, je to dobré") and then said
  **"začni"** (start) to authorize beginning implementation — this
  authorization covers the current 9-step plan below; do not need to
  re-ask permission for each step of executing this already-approved plan,
  but DO surface/mention what was done, and still follow the repo's
  git commit policy (see section 5).
- User asked whether this can run on Vercel again: **yes** — plain
  Next.js on Vercel works the same as the previous project; a real
  backend/DB will only become relevant once subsystem #2+ needs persistent
  accounts/real-time state.
- User asked to **write this very progress file** proactively before a
  context compaction, then asked for confirmation that the new
  `.github/copilot-instructions.md` file was scoped to **this project
  only**, not global (confirmed: it is local to this repo, the global
  `~/.copilot/copilot-instructions.md` was not touched). User then asked to
  make this progress file comprehensive enough to be used **on its own** to
  know exactly what to do (including the full plan and every Q&A decision)
  — hence this full rewrite, done in anticipation of an imminent context
  compaction so nothing has to be re-asked or re-derived.

## 4. Full implementation plan (all 9 steps) — status inline

Each step below is from `docs/superpowers/plans/2026-08-15-card-collection-combat-core-plan.md`,
copied in full here (not just referenced) so this file alone is sufficient.

### Step 1 — Project scaffold — ✅ DONE

- `create-next-app@14` (App Router, TypeScript, Tailwind, no `src/`,
  ESLint) — scaffolded into a temp directory
  (`C:\Users\z0040m9d\Documents\Projects\battle-card-game-v2-scaffold`)
  because the target folder name "Battle card game V2" contains
  spaces/capitals, which `create-next-app`/npm reject as a package name.
  Files were then moved into the real project root and the temp dir
  deleted; `package.json`'s `"name"` field manually fixed to
  `battle-card-game-v2`.
- Jest + React Testing Library added: `jest`, `@types/jest`, `ts-node`,
  `jest-environment-jsdom`, `@testing-library/react`,
  `@testing-library/jest-dom`. Config: `jest.config.js` (uses `next/jest`,
  `testEnvironment: 'jest-environment-jsdom'`, `moduleNameMapper` for the
  `@/*` alias), `jest.setup.ts` (imports `@testing-library/jest-dom`).
  `package.json` `"test"` script added (`jest`).
- Verified: `npm run build` succeeds (static pages generated). `npm test`
  runs cleanly (was fixed after an initial config typo —
  `setupFilesAfterEach` should not have existed, only `setupFilesAfterEnv`).
- `.gitignore`: default Next.js ignores kept, plus `/.superpowers/` added
  (brainstorming skill artifacts — these got committed once by accident and
  were then `git rm --cached` to untrack them).
- Committed across a few small commits (scaffold; package name/jest config
  fix; untracking `.superpowers/`).

### Step 2 — Card types — ✅ DONE

- `lib/cards/types.ts`: `UnitType` (union of the 8 unit type string
  literals) + `UNIT_TYPES` array constant; `Rank` (5 literals) + `RANKS`
  array constant; `VARIANTS_PER_RANK` (`{common:10, uncommon:8, rare:6,
  epic:4, legend:3}`); `SUPPLY_RANGE` (`{rare:[20,50], epic:[5,15],
  legend:[1,5]}`); `RawStats` interface (`str, lng, def, hp`);
  `CardTemplate` interface (`id, unitType, rank, name, flavorText,
  baseStats, totalSupply: number|null`); `CardInstance` interface
  (`instanceId, templateId, ownerId: string|null, mintedAt, mintedBy:
  'admin'`) — defined for forward-compatibility with later specs, not used
  by this subsystem's demo UI; `EffectiveCard` interface (`str, lng, def,
  hp` — post-rank-scaling numbers used in combat).
- Verified: `npx tsc --noEmit` clean.
- Committed together with combat-logic and unit-type-baselines (see below).

### Step 3 — Combat logic — ✅ DONE

- `lib/cards/combat.ts`:
  - `RANK_MULTIPLIER: Record<Rank, number>` = `{common:1.0, uncommon:1.15,
    rare:1.35, epic:1.6, legend:2.0}`.
  - `applyRank(baseStats: RawStats, rank: Rank): EffectiveCard` — multiplies
    each of the 4 attributes by the rank multiplier, rounds to nearest
    integer (`Math.round`), clamps to a minimum of 0 (`Math.max(0, ...)`).
  - `resolveDuel(attacker: EffectiveCard, defender: EffectiveCard):
    'attacker' | 'defender'` and the more detailed
    `resolveDuelWithBreakdown(...)` which also returns `{atk, dmgDealt, ttk}`
    for each side. Exact algorithm (spec §7):
    1. `atkA = max(attacker.str, attacker.lng)`, `atkD = max(defender.str,
       defender.lng)` — each side attacks with its stronger stat.
    2. `dmgToDefender = max(0, atkA - defender.def)`, `dmgToAttacker =
       max(0, atkD - attacker.def)`.
    3. `ttkAttackerWins = dmgToDefender > 0 ? defender.hp / dmgToDefender :
       Infinity` (same pattern for `ttkDefenderWins`).
    4. Lower TTK wins. **Tie (including both-Infinity) → defender wins.**
- `lib/cards/combat.test.ts` — 12 tests, all passing:
  - `applyRank`: exact expected output for all 5 ranks against a fixed base
    stat object, plus a defensive negative-clamp case.
  - `resolveDuel`/`resolveDuelWithBreakdown`: attacker decisive win,
    defender decisive win, an explicit "archer vs. fragile spearman"
    scenario proving the intended dynamic (archer's high LNG punches
    through low DEF for large damage against low HP, giving a much lower
    TTK than the spearman achieves back), both-sides-zero-damage (mutual
    Infinite TTK → defender wins), one-side-zero-damage (attacker can't
    penetrate but neither can defender in that specific fixture → defender
    wins), and an exact-tie-TTK case (defender wins).
- Verified: `npm test -- combat` → 12/12 pass. `npx tsc --noEmit` clean.

### Step 4 — Unit type baseline data — ✅ DONE

- `lib/cards/unit-types.ts`: `UNIT_TYPE_BASELINES` — a `Record<UnitType,
  {stats: RawStats; role: string}>` with the exact spec §5 numbers:

  | Unit Type | str | lng | def | hp | role (flavor only, no mechanical effect) |
  |---|---|---|---|---|---|
  | archers | 1 | 8 | 2 | 4 | Glass-cannon ranged |
  | crossbowmen | 1 | 7 | 5 | 4 | Slower-firing but better shielded ranged |
  | spearmen | 4 | 1 | 7 | 5 | Anti-cavalry, strong defense |
  | swordsmen | 7 | 1 | 4 | 5 | Balanced melee striker |
  | halberdiers | 6 | 1 | 8 | 8 | Tank, holds the line |
  | knights | 8 | 1 | 5 | 7 | Heavy melee spearhead |
  | lightCavalry | 5 | 4 | 2 | 4 | Flexible hybrid, fragile |
  | siegeEngines | 0 | 10 | 1 | 3 | Extreme ranged, dies to anything in melee |

  This is the reference baseline that `scripts/generate-catalog-data.js`
  (step 5) varies ±10% per named variant — it is NOT consumed at runtime by
  combat/UI code, only by that generation script.
- Verified: `npx tsc --noEmit` clean.

### Step 5 — Catalog content authoring — ✅ DONE

- `scripts/generate-catalog-data.js` — a one-off, **not shipped with the
  app**, Node content-authoring script (run manually with
  `node scripts/generate-catalog-data.js`, writes
  `lib/cards/catalog-data.json`). Contains:
  - `NAMES`: hand-curated Czech honorific names per unit type × rank,
    following a "common folk → legendary named individuals" progression
    (exact arrays are in the script file itself — do not re-derive them,
    just read the script if the actual name list is needed). Counts match
    `VARIANTS_PER_RANK` exactly (10/8/6/4/3) for every one of the 8 types.
  - `TIER_FLAVOR`: 5 template functions (one per rank) producing a short
    Czech flavor sentence per card, personalized with the card's name and a
    Czech plural label for its unit type (e.g. "lučištníci", "rytíři").
  - `seededFactor(seed)`: a simple deterministic string-hash → `[0.9, 1.1]`
    mapping, used to generate a **reproducible** ±10% variance per stat per
    template (seeded by `"{id}:{statName}"`), so re-running the script
    produces byte-identical output.
  - `supplyForIndex(rank, index, count)`: spreads `totalSupply` values
    evenly across each capped rank's range (e.g. 6 rare variants spread
    across 20-50).
  - Output: exactly 248 `CardTemplate` objects written as pretty-printed
    JSON to `lib/cards/catalog-data.json`.
- **One bug found and fixed during authoring**: the name "Ocelový hrom" was
  originally used for both a knights-epic card and a siegeEngines-rare
  card (duplicate names are invalid per the catalog validator in step 6).
  Fixed by renaming the knights-epic one to "Hromobití kopyt". Verified
  with an ad-hoc Node one-liner that all 248 names in the generated JSON
  are unique before re-running the full test suite.
- Verified: manual duplicate-check script confirmed 248 total / 248 unique
  names after the fix; full catalog validation (step 6's `catalog.ts`)
  passes on this data.

### Step 6 — Catalog loader — ✅ DONE

- `lib/cards/catalog.ts`:
  - Imports `catalog-data.json` (via `resolveJsonModule`, already enabled
    in `tsconfig.json`), casts to `CardTemplate[]`.
  - `validateCatalog(templates)`: runs once at module import time (top level
    of the file, not inside a function called later) and **throws
    synchronously** if any of these fail: total count !== 248; duplicate
    `id`; duplicate `name`; any `baseStats` attribute is negative;
    `totalSupply` is not `null` for common/uncommon; `totalSupply` is
    missing or out of its rank's `[min,max]` range for rare/epic/legend;
    per-unit-type-per-rank counts don't match `VARIANTS_PER_RANK`.
  - Exported accessors: `getAllTemplates()`, `getTemplatesByType(unitType)`,
    `getTemplatesByRank(rank)`, `getTemplateById(id)`.
- `lib/cards/catalog.test.ts` — 12 tests, all passing:
  - Against the **real** `catalog-data.json`: exactly 248 templates;
    correct per-type-per-rank counts for every combination; unique
    ids/names across the whole catalog; `totalSupply` null-vs-in-range
    correctness; no negative `baseStats` anywhere; `getTemplatesByType`
    returns only matching templates (31 for archers); `getTemplatesByRank`
    returns only matching templates (24 for legend = 3×8 types);
    `getTemplateById` finds "archers-common-01" → "Práčata" and returns
    `undefined` for an unknown id.
  - Against **malformed in-memory fixtures** (using `jest.doMock` +
    `jest.resetModules()` + `require('./catalog')` fresh each time, then
    `jest.dontMock` to restore): wrong total count throws
    `/expected 248 templates/`; duplicate id throws `/duplicate id/`;
    out-of-range `totalSupply` on a legend card throws
    `/totalSupply must be within/`; negative `baseStats.str` throws
    `/negative baseStats/`.
- Verified: `npm test -- catalog` → 12/12 pass. Full suite (`npm test`) →
  24/24 pass across both test files. `npx tsc --noEmit` clean project-wide.

### Step 7 — Collection browser page — ✅ DONE

- `app/collection/page.tsx` — client component (`'use client'`):
  - Reads `getAllTemplates()` from `lib/cards/catalog.ts` once via
    `useMemo`.
  - Two `<select>` filters: unit type (8 options + "Vše"/all) and rank (5
    options + "Vše"/all) — exactly the two filter dimensions from the
    spec, no separate "rarity" filter (rank IS rarity).
  - Each card shows: name, unit-type label (Czech), rank badge (color
    per rank), flavor text, **effective stats** via
    `applyRank(t.baseStats, t.rank)` (STR/LNG/DEF/HP grid — NOT raw
    baseStats), and `totalSupply` as static text ("Neomezeno" for
    null/common/uncommon, "Existuje jen N×" otherwise). No live
    claimed-count (no persistence in this demo).
  - Header shows "`{filtered.length} z {allTemplates.length} karet`" —
    doubles as a simple filter-count sanity display and a test hook.
  - Dark theme (zinc/amber/blue/purple/emerald palette for rank badges),
    responsive grid (1/2/3/4 columns by breakpoint).
- `app/collection/page.test.tsx` — 4 RTL tests, all passing: shows all 248
  by default; filtering by unit type narrows to 31 (archers); filtering by
  rank narrows to 24 (legend); combining both filters narrows to 3
  (archers × legend).
- Added `@testing-library/user-event` as a new devDependency (was missing;
  needed for `userEvent.setup()` + `selectOptions` in the new tests).
- Verified: `npx jest app/collection` → 4/4 pass.

### Step 8 — Duel arena page — ✅ DONE

- `app/arena/page.tsx` — client component:
  - Two `<select>` card pickers ("Útočník"/"Obránce"), each listing all 248
    templates as `"{name} — {unitTypeLabel} ({rankLabel})"`; picking the
    same template on both sides is allowed (no restriction).
  - "Souboj!" button: applies `applyRank` to both picked templates'
    `baseStats`, then calls `resolveDuelWithBreakdown` from
    `lib/cards/combat.ts`.
  - Displays a two-column breakdown (`SideResult` sub-component): ATK / DMG
    / TTK for both attacker and defender, with the winning side highlighted
    (amber border/background + "VÍTĚZ" label). `TTK=Infinity` renders as
    "∞"; finite values are `.toFixed(2)`.
  - Changing either select clears the previous result (`setResult(null)`)
    so stale breakdown numbers are never shown for a different matchup.
- `app/arena/page.test.tsx` — 2 RTL tests, both passing: (1) picks
  `archers-common-01` ("Práčata", str=1/lng≈8.7→9/def≈2.2→2/hp=4) vs.
  `spearmen-common-01` ("Rolníci s kopím", str≈4.3→4/lng=1/def=7/hp≈4.7→5),
  clicks fight, and asserts the exact expected numbers (attacker atk=9,
  dmg=2, ttk=2.50; defender atk=4, dmg=2, ttk=2.00; **defender wins**
  since 2.00 < 2.50) — this doubles as a regression check on the
  `resolveDuelWithBreakdown` math itself, wired through real catalog data;
  (2) no "VÍTĚZ" text is present before fighting.
- Verified: `npx jest app/arena` → 2/2 pass.

### Step 9 — Final verification — ✅ DONE

- `npm test` (full suite): **30/30 pass** across 4 test files
  (`combat.test.ts`, `catalog.test.ts`, `app/collection/page.test.tsx`,
  `app/arena/page.test.tsx`).
- `npx tsc --noEmit`: clean, no errors.
- `npm run build`: initially **failed** on pre-existing ESLint errors
  surfaced by the Next.js build's lint step (not caused by the new pages):
  - `lib/cards/catalog.test.ts` had 4× `@typescript-eslint/no-require-imports`
    errors on the `require('./catalog')` fresh-reimport-after-
    `jest.resetModules()` pattern — fixed with targeted
    `// eslint-disable-next-line` comments (the pattern itself is correct
    and needed; only the lint rule needed a documented exception).
  - `lib/cards/combat.test.ts` had an unused `spearman` variable (dead
    leftover from an earlier edit where `fragileSpearman` replaced it as
    the actually-used fixture) — removed.
  - After both fixes: `npm run build` **succeeds cleanly** — 3 routes
    prerendered as static content (`/`, `/collection` @ 1.32 kB,
    `/arena` @ 1.52 kB), no lint/type errors.
- Manual smoke check: started `npm run dev` (detached background process),
  confirmed HTTP 200 from `/`, `/collection`, and `/arena` via
  `Invoke-WebRequest`. **This is the first point where the app is actually
  viewable in a browser** — `http://localhost:3000` (home page with links),
  `http://localhost:3000/collection`, `http://localhost:3000/arena`.
- Also rewrote `app/page.tsx` (previously the default create-next-app
  boilerplate) into an actual landing page: title, short description, and
  two buttons linking to `/collection` and `/arena`. Updated
  `app/layout.tsx` metadata (title/description) and forced a dark theme on
  `<body>` (`bg-zinc-950 text-zinc-100`) so it's visually consistent with
  the card-grid pages (which assume dark zinc/amber colors regardless of
  OS light/dark preference).

## 5. Process/policy reminders (from the custom project instructions, not spec-specific)

- **No implementation without explicit user instruction.** This plan's
  execution was explicitly authorized by the user's "začni" — continuing
  through this same already-approved plan does not require re-asking, but
  do not start subsystem #2 (or any new unapproved scope) without a fresh
  explicit go-ahead following its own brainstorming/spec/approval cycle.
- **Git commits**: only after a meaningfully-sized, tested functional unit
  is complete (not tiny/untested changes). So far every commit in this repo
  has been either docs-only, scaffold/config, or a tested code unit (types +
  combat logic + tests; catalog content + loader + tests) — keep following
  that granularity: commit after each completed, verified plan step, not
  mid-step.
- **Git push**: not done yet, and requires explicit user approval before
  ever pushing to a remote (none configured yet, in fact — this is a local
  git repo only so far).
- **Destructive operations**: never delete/modify anything outside this
  project directory or outside its git repo without explicit permission.
  (The only reference reads outside this directory so far were read-only
  views of the sibling `Battle card game` project for context, and of the
  global Copilot session-recall/skills files — no writes/deletes outside
  this project's folder have occurred.)
- `.github/copilot-instructions.md` in **this project only** (not global)
  tells future sessions to read and continuously update this very file.
