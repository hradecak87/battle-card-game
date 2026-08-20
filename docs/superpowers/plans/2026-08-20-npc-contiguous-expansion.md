# Implementation Plan: NPC Contiguous Expansion

Spec: `docs/superpowers/specs/2026-08-20-npc-contiguous-expansion-design.md`

## Context for the implementer

- The live/authoritative NPC tick logic is `resolve_due_npc_actions()` in
  `supabase/migrations/0027_npc_kingdoms.sql` (lines ~964-1153). **Re-grep
  for `create or replace function resolve_due_npc_actions` across all
  migrations before editing** — confirm 0027 is still the last definition
  (it was as of this plan's writing; SQL functions in this project are
  frequently redefined later and only the highest-numbered file is live).
- Pick the next migration number by listing `supabase/migrations/*.sql` and
  taking the highest number + 1. **Important**: a separate in-flight feature
  (`hradby-task4-9`, branch `feat/hradby-walls`, not yet merged to `main`)
  is using `0047` in its own worktree. If `0047` is still unused on `main`
  when you start, use `0048` to avoid a near-certain collision at merge
  time (cheap to double check: `git log --all --oneline -- 'supabase/migrations/0047*'`).
- Helper functions this change reuses unchanged: `_start_claim_core`,
  `_declare_attack_core`, `_territory_effective_unit_power`. Do not modify
  their signatures or behavior.
- `NPC_ATTACK_POWER_RATIO = 1.2` and the 70/30 expand/attack weighting stay
  exactly as-is — only the candidate *sourcing* changes (adjacency-first,
  map-wide-random fallback).
- TS mirror file: `lib/npc/kingdoms.ts` / `lib/npc/kingdoms.test.ts` (pure,
  deterministic helper functions + their unit tests — same pattern as the
  existing `chooseNpcAction`/`canNpcAttackTarget`/`selectNearestOriginTerritory`/
  `scheduleNpcNextActionAt`). These functions are NOT called at runtime by
  the app (the real logic runs in SQL); they exist purely as a documented,
  tested reference for what the SQL should implement, so keep the same
  spirit — pure inputs/outputs, no DB access.
- No worktree/build tooling exists for a linked "npc-ai" concept beyond this
  file — treat this as a small, single-chunk change.

## Chunk 1: TS mirror helper (do first, it's the cheap/fast part)

**Task 1 — Add `shouldUseAdjacentTier` to `lib/npc/kingdoms.ts`**
- Signature: `shouldUseAdjacentTier(hasAdjacentCandidates: boolean, rand: number): boolean`
- Returns `true` only if `hasAdjacentCandidates` is true AND `rand < 0.90`.
  Returns `false` otherwise (meaning: fall back to the Tier B map-wide
  random search).
- Add JSDoc comment cross-referencing the spec file path.

**Task 2 — Unit tests in `lib/npc/kingdoms.test.ts`**
- No adjacent candidates + any rand → `false`.
- Has adjacent candidates, `rand = 0.89` → `true`.
- Has adjacent candidates, `rand = 0.90` → `false` (boundary — matches the
  `chooseNpcAction` test's convention of testing the exact boundary value).
- Has adjacent candidates, `rand = 0.0` → `true`.

Run `npx jest lib/npc/kingdoms.test.ts` and confirm green before moving on.

## Chunk 2: SQL — adjacency-aware candidate sourcing

**Task 3 — Write migration `00NN_npc_contiguous_expansion.sql`**

Replace the body of `resolve_due_npc_actions()` (`create or replace
function`, same signature) with:

1. Keep the existing outer loop (`for v_npc in select ... for update`),
   per-NPC exception handling, and the final `npc_next_action_at`
   reschedule exactly as-is.
2. Inside the loop, before the existing Tier B queries, add a **Tier A**
   block:
   - Build the set of the NPC's owned territories' direct neighbor
     coordinates via a lateral `values` cross join (same idiom already used
     in the existing attack-candidate query's adjacency check — reuse that
     `(values (t.x-1,t.y), (t.x+1,t.y), (t.x,t.y-1), (t.x,t.y+1))` pattern),
     joined back to `territories` to resolve real territory rows (skip
     coordinates with no territory row — map edges).
   - From that neighbor set, compute expansion candidates (same filter as
     today's Tier B expansion query: `owner_id is null`, not claim/battle
     locked, no ownerless garrison) and attack candidates (same filter as
     today's Tier B attack query, but the "adjacent to an owner-boundary"
     condition is now automatically satisfied by construction — no need to
     re-check it — and still require
     `_territory_effective_unit_power(npc, origin_territory, false) >=
     _territory_effective_unit_power(defender, target, true) * 1.2`, using
     the specific owned territory being expanded from as the origin — no
     nearest-origin search needed here since the origin *is* the adjacent
     owned territory).
   - Pick one candidate of each type at random if multiple qualify (`order
     by random() limit 1`), mirroring today's style.
3. Roll `v_pick_roll := random()` **once**, before deciding which tier to
   use (reuse the same roll for the tier decision; a second independent
   roll may then be used for the existing 70/30 expand/attack choice within
   whichever tier is selected — keep these two rolls conceptually distinct
   variables, e.g. `v_tier_roll` and `v_pick_roll`, don't conflate them).
4. Tier selection: if Tier A produced at least one candidate (expansion or
   attack) AND `v_tier_roll < 0.90`, use Tier A's candidates for the
   existing 70/30 expand-vs-attack decision + `_start_claim_core`/
   `_declare_attack_core` call. Otherwise, run today's existing Tier B
   logic completely unchanged (200-row map-wide sampling + nearest-origin
   lookup) as the fallback.
5. Preserve the existing perf-rationale comment (200-row sampling) on the
   Tier B block since it still applies there.

**Task 4 — Apply the migration to the live DB**
- Use the established scratch-Node-script + `pg` + `SUPABASE_DB_URL` (from
  `.env.local`, strip trailing `\r`) pattern used earlier this session;
  delete the scratch script after use. Confirm via a `select
  pg_get_functiondef('resolve_due_npc_actions'::regproc)` (or similar)
  that the new definition is live.

**Task 5 — SQL-level verification**
- Add a `.verification.sql` companion file (matches this project's
  established migration convention — see any recent migration for the
  exact format) that seeds a throwaway NPC-like setup (or reuses
  fixtures/documented manual steps) and asserts: (a) with a directly
  adjacent free territory available, running `resolve_due_npc_actions()`
  claims it far more often than a distant one across repeated runs; (b) a
  boxed-in NPC (no valid Tier A neighbors) still falls through to Tier B
  and does not get stuck idle when Tier B has valid candidates.
- If a full statistical repeated-run test is impractical in the
  verification-SQL format, a lighter deterministic check (e.g. temporarily
  forcing `random()` via a wrapped test schema, or asserting the query
  structure/candidate set directly) is acceptable — use judgment, but do
  not skip verifying this migration against the live DB entirely.

## Chunk 3: Final checks

**Task 6 — Full verification**
- `npx jest` (full suite) green.
- `npx tsc --noEmit` clean.
- `npm run build` succeeds.
- Update `docs/superpowers/PROGRESS.md` with a dated entry summarizing this
  change.
- Commit all changes (migration + verification SQL + `lib/npc/kingdoms.ts`
  + test file + PROGRESS.md) with a clear message. **Do not merge or push**
  — this plan runs in a dedicated worktree/branch; leave the branch ready
  for the user to review and merge themselves, exactly like the other
  in-flight feature branches this session (`feat/hradby-walls`, etc.).
