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
2. Players & Accounts (registration, nation classes/perks, XP/levels, matchmaking by level) ← **✅ FULLY IMPLEMENTED** — data/logic layer + Supabase migration applied to a live project + all pages (register/login/reset-password/onboarding/profile/leaderboard) built and tested (61/61 tests); manual browser verification with the user still pending (see §7 below)
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

## 6. Addendum: subsystem #1 visual polish (trading-card design) — ✅ DONE

After subsystem #1 was fully implemented and verified (section 4 above),
the user asked for a visual-design pass on top of it — not a new
subsystem, an enhancement to the existing `/collection` and `/arena` pages.
This was iterated live with the user via a temporary `/mockup` page and is
now finished and approved.

- **No image-generation tool is available** in this environment — checked
  via `tool_search_tool`, none found. All card art is therefore
  hand-authored SVG vector line-art (emblems: bow, crossbow, spear+shield,
  crossed swords, halberd, winged helm, horse+saber, trebuchet), not
  raster/painted illustration. User was told this and accepted it, and
  explicitly preferred the simple "symbol" emblem style over a more
  detailed full-character SVG figure that was also prototyped (only for
  archers, as a proof-of-concept, in `unit-art.tsx`'s unused
  `variant="figure"` path — kept in code but not used anywhere).
- **New files**:
  - `lib/cards/unit-art-theme.ts` — gradient + accent color per `UnitType`.
  - `components/cards/unit-art.tsx` — `UnitArt` component: CSS gradient
    background (as a plain `<div style>`, NOT inside the SVG — see bug
    note below) + a square-viewBox `<svg>` with the emblem line art on top.
  - `components/cards/TradingCard.tsx` — the reusable card component now
    used by both `/collection` (full mode) and `/arena` (`compact` mode,
    which hides flavor text and totalSupply to save space). Rank-colored
    border frame (common=gray, uncommon=blue, rare=green, epic=purple,
    legend=gold+glow), fixed `aspect-[5/7]` shape (2.5"×3.5" poker-card
    ratio — width alone determines height, independent of grid stretch
    behavior or how much text is inside).
  - `app/mockup/page.tsx` — **kept intentionally** (user's explicit choice,
    not deleted) as a permanent design-reference page showing: one unit
    type across all 5 ranks, a stat-alignment check (short vs. long name),
    a stress test with the catalog's single longest flavor text (94 chars)
    at the narrowest supported card width, and one example of each of the
    8 unit types cycling through all 5 ranks for variety.
- **Two real bugs hit and fixed during iteration** (useful if similar
  patterns recur):
  1. **SVG letterboxing**: a square `viewBox` SVG inside a non-square
     container, with default `preserveAspectRatio="xMidYMid meet"`, scales
     the *entire* SVG content (including any background `<rect>` drawn
     inside it) to fit and centers it — leaving visible empty gaps on the
     sides where the background rect doesn't reach. Fix: put the
     background as a plain CSS background on the parent `<div>` (which
     naturally fills its own box regardless of aspect ratio) and keep only
     the foreground artwork (no background) inside the letterboxed SVG.
  2. **Tailwind 3.4.19 has no built-in `@container` utility** (container
     queries are a *separate* `@tailwindcss/container-queries` plugin, not
     a core feature in this version) — using the class `@container`
     compiled to nothing, so `cqw`-unit font sizes had no query container
     to size against and fell back to the viewport, making text huge.
     Fixed by using an arbitrary-property utility instead, which needs no
     plugin: `[container-type:inline-size]` directly on the card's root
     div.
- **Typography approach**: all font sizes/paddings/gaps inside
  `TradingCard` are set in `cqw` (container query width) units, sized
  against that `[container-type:inline-size]` root div — so text scales
  proportionally with each card's own rendered width (not the viewport),
  and the same relative layout holds whether a card is shown large (full
  `/collection` grid) or small (compact `/arena` side-by-side). Both
  `/collection` and `/mockup` use a `grid-cols-[repeat(auto-fill,minmax(170px,1fr))]`
  grid so cards never render narrower than 170px (the width the layout was
  tuned against for the worst-case 94-char flavor text).

## 7. Subsystem #2: Players & Accounts — data/logic layer implemented

Spec: `docs/superpowers/specs/2026-08-15-players-accounts-design.md` (passed
the spec-review loop after several rounds of fixes — leveling formula,
unsafe RLS, auth-sync trigger, nation enum, case-insensitive uniqueness
indexes, coat-of-arms server-side validation, email-verification/reset flow,
leaderboard filter — see the commit history around 2026-08-15 for the
fix-by-fix detail). Plan: `docs/superpowers/plans/2026-08-15-players-accounts-plan.md`.

**What's implemented and tested** (all pure, no backend needed):
- `lib/players/nations.ts` — the 6 permanent nation choices + perk text
  (data only; no combat/transfer/occupation code reads these yet, by
  design — see spec §3.1).
- `lib/players/leveling.ts` — `xpRequiredForLevel` / `levelForXp`.
- `lib/players/matchmaking.ts` — `canPlayersFight` / `MAX_LEVEL_GAP = 3`.
- `lib/players/coats-of-arms.tsx` — 21 hand-drawn SVG shield designs (a
  shared `ShieldOutline` kite-shape wrapper + varied inner patterns per
  entry); each shield uses `useId()` for its clipPath id specifically
  because the onboarding gallery renders 20+ of these on one page at once,
  and a shared hardcoded id would have collided.
- `supabase/migrations/0001_players.sql` — the full schema from spec §2:
  `nation_id` enum, `players` table, case-insensitive unique indexes, the
  `auth.users` → `players` sync trigger, RLS (public select, no direct
  update), and the three RPC functions (`complete_kingdom_onboarding`,
  `update_kingdom`, `heartbeat`) plus a shared `is_valid_coat_of_arms_id`
  helper. **Not yet applied to any real database** — no Supabase project
  exists yet.

Verification done for this section: `npx jest lib/players` (all suites
pass), `npx tsc --noEmit` (clean) — run after every file in this section was
added.

### 7.1 Pages/auth layer — ✅ IMPLEMENTED (subsystem #2 now feature-complete)

The user provisioned a real Supabase project
(`https://yjmvktpsczmabcpwcyoa.supabase.co`) and manually applied
`0001_players.sql` via the SQL Editor (direct/pooled DB connections from
this environment failed — see the note at the end of this section — so
this is the working path if a future migration is ever needed). Verified
live via a REST `select` call returning `200 []`.

Plan: `docs/superpowers/plans/2026-08-15-players-accounts-pages-plan.md`,
all 10 tasks done and committed:
- `lib/supabase/client.ts` — singleton browser client from
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (`.env.local`,
  gitignored, holds the real project's credentials).
- `lib/supabase/useSession.ts` — `{ user, player, loading }` hook.
- `app/register/page.tsx` — email/password/display-name/nation form,
  `supabase.auth.signUp`, "check your email" confirmation screen.
- `app/login/page.tsx` — `signInWithPassword`, "email not confirmed" +
  resend flow, links to `/reset-password`/`/register`.
- `app/reset-password/page.tsx` — dual-mode (request link vs. set new
  password once a recovery session exists via
  `onAuthStateChange`'s `PASSWORD_RECOVERY` event).
- `app/onboarding/kingdom/page.tsx` (+ test) — kingdom name + coat-of-arms
  gallery (all 21 `COATS_OF_ARMS`), calls
  `complete_kingdom_onboarding` RPC.
- `components/players/PlayerProfileCard.tsx` — shared display component
  (level/XP bar, nation + perk text, kingdom name/coat of arms, online
  badge, account age, playtime) with an `editable` prop, used by both:
  - `app/profile/me/page.tsx` (+ test) — redirects to `/login` if logged
    out, `/onboarding/kingdom` if onboarding incomplete; editable kingdom
    name/coat via `update_kingdom` RPC.
  - `app/profile/[id]/page.tsx` (+ test) — read-only, fetched by id, no
    auth required.
- `app/leaderboard/page.tsx` (+ test) — all onboarded players, sorted by
  `levelForXp` then raw XP descending, ranked list linking to
  `/profile/[id]`.
- `components/players/HeartbeatBeacon.tsx` — calls the `heartbeat` RPC on
  mount + every 30s while a user is logged in; mounted once in
  `app/layout.tsx`.
- `app/page.tsx` — now a client component; shows login/register/leaderboard
  links when logged out, profile/leaderboard when logged in (via
  `useSession`).

**Verification**: `npx tsc --noEmit` clean; full `npx jest` suite
**61/61 passing** across 12 suites (up from 55). `npm run build` was
attempted but **repeatedly hung indefinitely** on this machine right after
printing the Next.js banner (no CPU activity in the spawned build workers,
reproduced 3 times, with and without `NEXT_TELEMETRY_DISABLED=1` and after
clearing `.next`) — this looks like a local/environment issue (possibly
antivirus or disk I/O contention on a shared machine), not a code problem,
since `tsc` and the full test suite are both clean. **Not yet resolved —
retry `npm run build` in a future session** if a clean production build
needs to be confirmed before deploying.

**Not yet done**: the manual browser verification checklist from the plan
(spec §8 — register a real account, confirm email, log in, complete
onboarding, check `/leaderboard`/`/profile/[id]`, test `/reset-password`)
requires the user to check their own inbox, so it's still pending their
availability. No commits have been pushed to any remote — that (like every
commit) requires separate explicit user approval, not yet requested.

**Open question, not blocking**: Supabase's IPv4 pooler
(`aws-0-<region>.pooler.supabase.com`) didn't work for this project from
this environment across ~16 tried regions (`tenant/user ... not found`),
and the direct host (`db.<ref>.supabase.co`) is IPv6-only while this
machine has no IPv6 connectivity at all. Manual SQL Editor paste-and-run
is the reliable fallback for any future migration.
  Current sizing (as of this addendum, tuned per direct user feedback —
  "2x", then dialed back to "150% of the original" — do not re-tune
  without a similar explicit request): name `text-[8.25cqw]`
  (compact: `text-[7.2cqw]`), subtitle `text-[5.7cqw]`, flavor
  `text-[5.1cqw]` (`line-clamp-3`, full mode only), rank badge
  `text-[5.4cqw]`, stat labels `text-[4.8cqw]`, stat values `text-[6.3cqw]`,
  supply text `text-[4.8cqw]` (full mode only).
- **`/arena` integration**: `SideResult` now renders a `compact`
  `TradingCard` (capped at `max-w-[140px]`) above the existing STR/LNG/DEF/
  HP and ATK/DMG/TTK stat breakdown (that breakdown table, added earlier in
  this same addendum before the TradingCard work started, is unchanged).
  The old separate `<h3>{template.name}</h3>` was removed since the
  compact card already shows the name — removing it also fixed a test
  bug (duplicate text). `SideResult`'s outer div now carries
  `data-testid="side-result-attacker"`/`"side-result-defender"` so
  `app/arena/page.test.tsx` can target each side reliably regardless of
  internal DOM nesting (replacing a fragile `getByText(name).closest('div')`
  query that broke once the name moved inside the nested `TradingCard`).
- **Verification**: `npx tsc --noEmit` clean, full Jest suite 30/30
  passing (`lib/cards/combat.test.ts`, `lib/cards/catalog.test.ts`,
  `app/arena/page.test.tsx`, `app/collection/page.test.tsx`),
  `npm run build` clean (`/`, `/arena` 1.71 kB, `/collection` 996 B,
  `/mockup` 138 B — all prerendered static), and manual `Invoke-WebRequest`
  200 checks on `/`, `/collection`, `/arena`, `/mockup` after every
  iteration. **User explicitly approved the final design** ("vypadá to
  dobře") after several rounds of live feedback (background gradient
  letterboxing, text overflow, aspect ratio, font-size scaling twice, and
  a rank-badge/rank-variety mockup mixup that turned out to be a
  non-bug — see history above).
- **Not yet done**: this whole addendum is implemented but **not yet
  committed** — per project policy, commit only once the user explicitly
  confirms the tested result looks good, which just happened, so this is
  the next natural commit point (arena stat-breakdown fields + full
  TradingCard/UnitArt visual system + `/mockup` + arena test fix, all as
  one or a few granular commits, each followed by the required
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
  trailer) — awaiting the user's go-ahead to commit (and separately, to
  push, which additionally requires its own explicit approval).

## 8. Subsystem #3: Territory Map — spec+plan approved, implementation complete, migration APPLIED & LIVE

Brainstorming completed via the `brainstorming` skill (text-only — the
visual companion's WSL `bash.exe` dependency didn't work in this
environment). Spec written to
`docs/superpowers/specs/2026-08-15-territory-map-design.md`, then run
through **5 rounds** of the `spec-document-reviewer` subagent loop until
**Approved** (fixes across rounds: concrete resolve-on-read/write RPCs
instead of a vague "every read path"; atomic home-territory assignment
folded into `complete_kingdom_onboarding` plus a unique partial index
guaranteeing one home tile per player; fully specified claim/transfer/cancel
state machines with both timers precomputed upfront at claim-start;
`start_transfer` fully specified (was previously only named); a
discriminated `CardTemplate` union (`UnitCardTemplate | StructureCardTemplate`)
so Castle/Village cards fit the existing subsystem #1 model; explicit
`minted_count`-is-a-lifetime-counter semantics reconciling structure-card
burning with subsystem #1's "cards are never destroyed" invariant (a
deliberate, scoped exception); Mongol Horde (−25% transfer time) and
Scandinavia (−20% occupation time) nation perks from subsystem #2 wired
into the formulas, since that spec explicitly deferred applying them to
"whichever subsystem owns the mechanic"; RLS enabled with public-read/
no-direct-write policies on all 5 new tables; retuned occupation-formula
constant (500→150) so the 10-hour floor is reachable by a realistic army,
not just a theoretical max; missing indexes for the lazy-resolver's due-
movement/due-occupation lookups; row-locking (`select ... for update` +
re-check) on both the target territory and the selected `card_instances` in
`start_claim`/`start_transfer`/home-assignment to close concurrent-request
races; requiring a non-empty troop selection; excluding already-claimed
tiles from the home-assignment candidate pool; and counting a player's own
in-flight claims (not just settled ownership) against the 32-territory cap
so parallel claims can't jointly overflow it).

**Key decisions locked into the spec** (full Q&A history above §1 of this
section didn't exist yet when this was written — see the spec file itself
and the brainstorming conversation transcript for the complete Q1-Q15
question list): viewport+pan+coordinate-jump+minimap map navigation; static
one-time 256×256 world-gen; only castle/village tiles start with NPC
garrisons (empty tiles have no owner at all); automatic home-territory
assignment right after onboarding, with a starter army; real `CardInstance`s
(not abstract numbers) as garrisons; subsystem #3 scope excludes **all**
combat (deferred to subsystem #4); a claimed empty tile locks immediately
(no contested claims) but the claimant can cancel (instant troop return, no
return-trip timer); hard block at the 32-territory cap; two-phase transfer-
then-occupation timing (10-hour occupation floor); 5 difficulty levels
mirroring the card-rank multiplier scale (×1.0/1.5/2.25/3.4/5.0); Castle and
Village are new burn-on-use structure cards (not tile flags), rankable like
unit cards, obtainable only via admin-mint for now (combat loot arrives with
subsystem #4); a tile may have both a Castle and a Village simultaneously,
with their defense bonuses stacking additively; and — a major scope addition
discovered mid-brainstorming — this subsystem must also add the **first real
database persistence for card instances** (`card_templates`/`card_instances`
tables), since subsystem #1 only ever defined these as in-memory
TypeScript types with no backend.

Implementation plan written to
`docs/superpowers/plans/2026-08-15-territory-map-plan.md` (deliberately more
consolidated task granularity than the `writing-plans` skill's default, per
the user's request to keep it concise), run through **3 rounds** of the
`plan-document-reviewer` subagent loop until **Approved**. Both the spec and
plan documents are committed (`0cee135`, `f34c0f6`).

**Implementation status: all 13 plan tasks complete and committed**, each
with its own tests green before committing (per the plan's per-task TDD
pattern):

- **Chunk 1 (pure logic)**: `CardTemplate` split into `UnitCardTemplate |
  StructureCardTemplate` (`lib/cards/types.ts`, `fa98806`); transfer/
  occupation formulas (`lib/territories/formulas.ts`, `2ee6d9c`);
  castle/village bonus stacking (`lib/territories/structureBonus.ts`,
  `dcf8fb9`).
- **Chunk 2 (DB schema, world-gen, RPCs)**: full schema migration —
  `card_templates`/`card_instances`/`territories`/`troop_movements`/
  `troop_movement_units`, all indexes, RLS (`supabase/migrations/
  0002_territories.sql`, `b993635`); manual SQL verification checklist
  (`0002_territories.verification.sql`, `ea7d154`); `resolve_due_movements()`
  + the 4 read RPCs (`c8996e8`); `start_claim`/`start_transfer`/
  `cancel_claim`/`build_structure` mutating RPCs with row-locking (`d68c77a`);
  `complete_kingdom_onboarding` extended for atomic home-territory + starter
  army assignment (`f0bafa2`); `scripts/seed-card-templates.ts` +
  `scripts/generate-world.ts` with tested pure placement-logic helpers
  (`537a72e`).
- **Chunk 3 (Map UI)**: typed RPC client wrappers (`lib/territories/api.ts`,
  `916c153`); pannable viewport with click-drag + arrow-button panning and
  coordinate jump (`components/territories/MapViewport.tsx`,
  `app/map/page.tsx`, `51adda6`); minimap overview
  (`components/territories/Minimap.tsx`, `21bcd4e`); territory detail panel
  with state-dependent claim/transfer/cancel/build actions and user-facing
  RPC error surfacing (`components/territories/TerritoryDetailPanel.tsx`,
  `9bbae8b`).

**Verification**: `npx tsc --noEmit` clean and full `npx jest` **119/119
passing** across **18 suites** as of the last task's commit.

**Not yet done / explicitly deferred, requires the user's separate
go-ahead**:
- No git push has been performed — commits are local only, pending the
  user's review and explicit push approval.
- All castle/village combat bonuses, actual combat resolution, and
  combat-loot card acquisition are explicitly out of scope here — deferred
  to subsystem #4 (spec §13).

**Deployment (this session, live project `yjmvktpsczmabcpwcyoa`)**:
- `0002_territories.sql` applied via the SQL Editor. Hit one bug on first
  attempt: `troop_movement_units.card_instance_id` referenced
  `card_instances(id)`, but that table's PK column is `instance_id`
  (`42703: column "id" ... does not exist`) — fixed and committed
  (`8272e1e`), re-ran successfully.
- Verified live via REST API (anon key): all 5 tables reachable
  (`territories`, `card_templates`, `card_instances`, `troop_movements`,
  `troop_movement_units`) and `get_minimap_overview` RPC callable.
- `scripts/seed-card-templates.ts` run against the live project (service
  role key) — seeded 258 card templates (248 unit + 10 structure).
- `scripts/generate-world.ts` run against the live project — generated all
  65,536 territories plus NPC garrisons on 1,000 pre-seeded structure
  tiles (7,702 `card_instances` rows total). Verified row counts live via
  REST API (`territories`: 65536, `card_templates`: 258, `card_instances`:
  7702).
- Both scripts needed a small Node-20-compatibility fix (native
  `WebSocket` global missing pre-Node-22, required internally by
  `@supabase/supabase-js`'s realtime client even though these scripts
  never use realtime) — polyfilled with the already-present `ws` package;
  committed.
- `0002_territories.verification.sql`'s manual SQL checklist has not been
  run yet against the live project — still the recommended next
  acceptance check for the RPC/schema layer.
