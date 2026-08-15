# Players & Accounts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every part of subsystem #2 (Players & Accounts) that doesn't
require a live Supabase project — pure data/logic modules with tests, plus
the SQL migration file — so the app has working, tested nation/leveling/
matchmaking/coat-of-arms logic ready to plug into pages once Supabase
credentials are provided.

**Architecture:** New `lib/players/` folder mirrors the existing
`lib/cards/` pattern: one small file per concern (`nations.ts`,
`coats-of-arms.tsx`, `leveling.ts`, `matchmaking.ts`), each with a co-located
Jest test. A single SQL migration file captures the schema, trigger, RLS, and
RPC functions from the spec (§2) as reviewable, version-controlled code, even
though it can't be run yet.

**Tech Stack:** TypeScript, Jest, React (for inline SVG coat-of-arms
components, same style as `components/cards/UnitArt.tsx`), raw SQL for the
Supabase migration.

---

## Chunk 1: Data & Logic (buildable/testable now)

### Task 1: Nations data

**Files:**
- Create: `lib/players/nations.ts`
- Test: `lib/players/nations.test.ts`

- [ ] Write `nations.test.ts`: exactly 6 entries, each with a unique `id`,
      `name`, and `perkDescription`; no duplicate `id`s.
- [ ] Implement `nations.ts` exporting `NATIONS` (the 6-row table from spec
      §3: Anglické království/Franská říše/Svatá říše římská/Byzantská
      říše/Mongolská horda/Skandinávské království, with their perk text).
- [ ] Run `npx jest lib/players/nations.test.ts` — expect PASS.
- [ ] Commit: `feat: add nations reference data`

### Task 2: Leveling

**Files:**
- Create: `lib/players/leveling.ts`
- Test: `lib/players/leveling.test.ts`

- [ ] Write `leveling.test.ts` covering `xpRequiredForLevel(1..3,10,20)` →
      `0, 100, 300, 4500, 19000`, and `levelForXp` at each of those exact
      boundaries plus one XP below each boundary (still previous level).
- [ ] Implement `xpRequiredForLevel` / `levelForXp` exactly as in spec §5.
- [ ] Run `npx jest lib/players/leveling.test.ts` — expect PASS.
- [ ] Commit: `feat: add XP leveling formulas`

### Task 3: Matchmaking proximity rule

**Files:**
- Create: `lib/players/matchmaking.ts`
- Test: `lib/players/matchmaking.test.ts`

- [ ] Write `matchmaking.test.ts`: gap 0/3 → true, gap 4 → false, negative
      order (`canPlayersFight(10, 7)` vs `canPlayersFight(7, 10)`) → same
      result.
- [ ] Implement `MAX_LEVEL_GAP = 3` and `canPlayersFight` per spec §5.
- [ ] Run `npx jest lib/players/matchmaking.test.ts` — expect PASS.
- [ ] Commit: `feat: add level-proximity matchmaking rule`

### Task 4: Coat-of-arms gallery

**Files:**
- Create: `lib/players/coats-of-arms.tsx`
- Test: `lib/players/coats-of-arms.test.ts`

- [ ] Write `coats-of-arms.test.ts`: at least 20 entries, unique `id`s, each
      entry's `Svg` is a valid React component (renders without throwing via
      `render(<entry.Svg />)`).
- [ ] Implement `coats-of-arms.tsx` exporting `COATS_OF_ARMS`: ≥20 small
      hand-authored SVG shield components (simple shape/color/pattern
      variations — same hand-drawn style as `components/cards/UnitArt.tsx`),
      each `{ id, label, Svg }`.
- [ ] Run `npx jest lib/players/coats-of-arms.test.ts` — expect PASS.
- [ ] Commit: `feat: add coat-of-arms gallery`

### Task 5: SQL migration (schema, trigger, RLS, RPCs)

**Files:**
- Create: `supabase/migrations/0001_players.sql`

- [ ] Write the full migration in one file, transcribing spec §2 exactly:
      `nation_id` enum, `players` table, the two `lower()` unique indexes,
      the `handle_new_user()` trigger function + trigger on `auth.users`,
      RLS enabled with public `select` policy and no `update` policy, and
      the three `security definer` RPC functions
      (`complete_kingdom_onboarding`, `update_kingdom`, `heartbeat`), each
      checking `auth.uid() = id`.
- [ ] This file can't be executed yet (no Supabase project exists) — note
      that at the top of the file as a SQL comment: apply via
      `supabase db push` once the project is provisioned.
- [ ] Commit: `feat: add players schema migration (not yet applied)`

### Task 6: Update progress doc

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] Add a short note: subsystem #2's data/logic layer is implemented and
      tested; pages/auth wiring is blocked on the user providing a Supabase
      project URL + anon key, and is a follow-up plan once that's available.
- [ ] Commit: `docs: record subsystem #2 data-layer progress`

---

## Not in this plan (needs Supabase credentials first)

Once the user provisions a Supabase project and shares its URL + anon key:
`/register`, `/login`, `/reset-password`, `/onboarding/kingdom`,
`/profile/me`, `/profile/[id]`, `/leaderboard` (spec §7), plus running the
migration for real and wiring the Supabase client. This will be a short
follow-up plan — the hard design/logic decisions are already made and
tested here, so that plan should be small.
