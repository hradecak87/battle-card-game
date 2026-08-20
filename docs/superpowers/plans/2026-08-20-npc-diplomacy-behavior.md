# Implementation Plan: NPC Diplomacy & War-Focus Behavior

Spec: `docs/superpowers/specs/2026-08-20-npc-diplomacy-behavior-design.md`

## Context for the implementer

- Re-grep for `create or replace function resolve_due_npc_actions` and
  `create or replace function resolve_due_movements` and
  `create or replace function diplomacy_propose_peace` (etc.) across all
  migrations before editing — confirm which files currently hold the live
  definitions (as of this writing: `resolve_due_npc_actions` in
  `0048_npc_contiguous_expansion.sql`, `resolve_due_movements` in
  `0035_wire_world_events.sql`, the three diplomacy RPCs in
  `0046_diplomacy_rpcs.sql`). SQL functions in this project are frequently
  redefined later and only the highest-numbered file is live — always
  verify before assuming a given file is authoritative.
- Next migration number is `0049` at plan-writing time, but the final branch
  file was renumbered to `supabase/migrations/0050_npc_diplomacy.sql`
  (+ matching `.verification.sql`) after `0049` was claimed on `main` —
  still double-check with `git log --all
  --oneline -- 'supabase/migrations/0049*'` in case another in-flight
  branch already claimed it.
- Read the full spec before starting; it has exact SQL snippets for
  `_npc_diplomacy_power` and detailed pseudocode for both new steps. Follow
  it precisely, including the 5 fixes from spec review (non-null
  `stationed_territory_id` filter, explicit is_npc/human filter in Step B,
  `battle_won`+`battle_surrendered` in the lost-territory check, rank
  `case`-expression ordering not lexical, tribute card pre-filtering against
  unresolved-battle territories, explicit revoke on all new functions).
- Do not modify `_declare_attack_core`, `_start_claim_core`,
  `_territory_effective_unit_power`, `_compute_effective_stats`, or any
  existing diplomacy table schema — this feature only adds new functions
  and one new table, plus a refactor-only change to 3 existing RPC bodies.
- No TS/client work is needed for this feature (server-side SQL only, per
  spec's Testing section).

## Chunk 1: Schema + power metric

**Task 1 — `npc_diplomacy_state` table**
- Create the singleton table exactly as specified (boolean PK check
  constraint, single seeded row, RLS enabled + all-revoked).

**Task 2 — `_npc_diplomacy_power(p_player_id uuid)`**
- Implement exactly as specified (including the
  `stationed_territory_id is not null` filter from the review fix).
- Explicitly `revoke execute ... from public, anon, authenticated` after
  creating it.

**Task 3 — Migration-level verification for Task 1+2**
- In the `.verification.sql` companion: seed 2 fixture players with a few
  `card_instances` each (different ranks/stats) and assert
  `_npc_diplomacy_power` returns the expected sum for each, and `0` for a
  player with no stationed units, and correctly excludes a card whose
  `stationed_territory_id is null`.

## Chunk 2: `_core` refactor (regression-sensitive — do carefully)

**Task 4 — Extract `_diplomacy_propose_peace_core`,
`_diplomacy_accept_peace_core`, `_diplomacy_reject_peace_core`**
- Copy each function body from `0046_diplomacy_rpcs.sql` verbatim into a
  new `_core` function taking `p_caller_id uuid` as the first parameter,
  replacing every use of `v_caller` that was previously assigned from
  `diplomacy_require_player()` with the parameter instead. Do not change
  any other logic, ordering, or validation.
- Redefine the 3 public RPCs (`diplomacy_propose_peace`,
  `diplomacy_accept_peace`, `diplomacy_reject_peace`) as thin wrappers:
  resolve `v_caller := diplomacy_require_player()`, then call the matching
  `_core` function and return its result.
- `diplomacy_cancel_peace` is untouched — do not refactor it.
- Revoke execute on the 3 new `_core` functions from
  `public, anon, authenticated`.

**Task 5 — Regression check for the refactor**
- In the `.verification.sql` file: exercise the full existing human
  propose→accept flow and propose→reject flow end-to-end through the
  public RPCs (not the `_core` functions directly) and assert the exact
  same outcomes as before the refactor (war relation deleted on accept,
  cards/territory transferred on tribute accept, offer status set
  correctly on reject). This is the most important test in this plan —
  a regression here would silently break the live human diplomacy feature.

## Chunk 3: `resolve_due_npc_diplomacy()` hourly tick

**Task 6 — Implement the function**
- Follow the spec's Step A (respond to incoming offers) and Step B
  (propose peace for active wars) pseudocode exactly, including the
  hour-gate against `npc_diplomacy_state.last_run_at`.
- Wrap each offer/war resolution in its own `begin/exception when others
  then raise log ...` block, mirroring `resolve_due_npc_actions()`'s
  per-item error isolation, so one bad row doesn't abort the whole tick.
- Tribute card selection (Step B, ratio < 0.4): select the N weakest
  eligible stationed unit cards owned by the NPC — eligible means not on a
  territory with an unresolved battle or battle lock (pre-filter, per the
  review fix, to avoid `_diplomacy_propose_peace_core` rejecting the whole
  proposal) — ordered by a rank-strength `case` expression ascending, then
  `(str+lng+def+hp)` ascending (via `_compute_effective_stats` with the
  same null-context args as `_npc_diplomacy_power`), then `id` ascending.
- Before proposing, skip if the NPC already has a pending outgoing offer to
  that specific opponent (a plain existence check — cheaper than relying on
  the exception `_diplomacy_propose_peace_core` would otherwise raise).

**Task 7 — Wire into `resolve_due_movements()`**
- Add `perform resolve_due_npc_diplomacy();` alongside the existing
  `perform resolve_due_npc_actions();` line.

**Task 8 — Verification**
- In `.verification.sql`: seed a war row + a losing power ratio for one
  side, run `resolve_due_npc_diplomacy()`, assert a pending offer was
  created with the right kind (white vs tribute) and card count at a couple
  of ratio boundaries (e.g. 0.65 → no offer, 0.55 → white, 0.35 → tribute
  with 1 card, 0.15 → tribute with 3 cards).
- Seed a pending incoming offer targeting an NPC at a couple of ratios and
  with/without tribute; assert accept vs reject matches the spec's rule.
- Assert calling `resolve_due_npc_diplomacy()` twice in immediate
  succession is a no-op the second time (no duplicate offers created).
- Assert the Step B human/NPC filter correctly skips a human-vs-human war
  row (seed one; confirm no offer gets auto-created for it).

## Chunk 4: War focus in `resolve_due_npc_actions()`

**Task 9 — Add the war-focus branch**
- Add the new branch described in the spec's "War focus" section, inserted
  before the existing adjacent-tier/random-tier selection logic, for any
  NPC with ≥1 row in `diplomacy_relations`.
- Pick the focus enemy = lowest `_npc_diplomacy_power` among the NPC's
  current war opponents.
- Reuse the existing attack-candidate query structure (sampled
  candidates + nearest-origin-by-distance lateral join +
  `_territory_effective_unit_power(...) >= ... * 1.2` eligibility), adding
  an owner filter restricted to the one focus-enemy id instead of "anyone
  but me". Search anywhere on the map (no adjacency requirement for this
  branch, unlike the existing Tier A/Tier B expansion logic).
- On `v_war_roll < 0.8` with a valid focus-enemy target found: call
  `_declare_attack_core` and skip the rest of the tick's normal
  expansion/attack logic for this NPC.
- On `v_war_roll < 0.8` with no valid target found, or `v_war_roll >= 0.8`,
  or no active wars: fall through to the existing logic completely
  unchanged.

**Task 10 — Verification**
- In `.verification.sql`: seed an NPC at war with one human who owns a
  distant (non-adjacent) territory the NPC can beat; run
  `resolve_due_npc_actions()` many times (or force the random seed/roll if
  the test harness allows) and assert attacks against that specific
  opponent's territory happen roughly 80% of the time versus normal
  behavior; assert an NPC at war with an opponent it cannot currently beat
  anywhere still falls through to normal expansion instead of stalling.
- Assert an NPC with no active wars is completely unaffected (identical
  behavior to before this change) — a straightforward before/after
  comparison against the existing Task-5-style verification from the
  `npc-contiguous-expansion` migration if such a test exists to compare
  against, otherwise a fresh equivalent check.

## Chunk 5: Final checks

**Task 11 — Full verification**
- Apply the migration to the live DB using the established scratch-Node +
  `pg` + `SUPABASE_DB_URL` pattern (strip trailing `\r` from the env var);
  delete the scratch script after use.
- Run all `.verification.sql` files for this migration against the live DB
  and confirm pass.
- `npx jest` (full suite) green — this feature adds no new TS, but confirm
  nothing else broke.
- `npx tsc --noEmit` clean.
- `npm run build` succeeds.
- Update `docs/superpowers/PROGRESS.md` with a dated entry summarizing this
  feature (what was added, the `_core` refactor, live verification
  results).
- Commit all changes (migration + verification SQL + PROGRESS.md) with a
  clear message. **Do not merge or push** — leave the branch ready for the
  user to review and merge themselves, exactly like other in-flight feature
  branches this session.
