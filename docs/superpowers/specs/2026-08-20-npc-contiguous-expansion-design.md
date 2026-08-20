# NPC Contiguous Expansion — Design Spec

Date: 2026-08-20
Status: Approved by user, pending implementation plan

## Summary

Change how NPC kingdoms pick expansion and attack targets each autonomous
tick so they preferentially grow into territories directly adjacent to
territory they already own, forming visually coherent contiguous blocks
instead of the current fully-random scattering. Distant/random targets
(including attacking other players) remain possible, just much rarer.

This only changes **target selection**. Nothing about the tick schedule,
origin selection (already nearest-owned), claim/attack execution
(`_start_claim_core`/`_declare_attack_core`), combat resolution, or the
attack power-ratio threshold (`NPC_ATTACK_POWER_RATIO = 1.2`) changes.

## Current Behavior (baseline)

`resolve_due_npc_actions()` (`0027_npc_kingdoms.sql`), per due NPC per tick:

1. If the NPC owns < 32 territories, sample 200 random unclaimed
   territories map-wide as expansion candidates; pick one at random, paired
   with its nearest-owned origin territory.
2. Sample 200 random contested/enemy territories map-wide as attack
   candidates (adjacent-to-owner-boundary filter already exists for owned
   targets, but candidates are drawn from the whole map, not from the NPC's
   own borders); keep only those where the NPC's power from its nearest
   origin ≥ 1.2× the defender's power; pick one at random.
3. If both an expansion and an attack candidate exist, 70% chance to
   expand, 30% to attack (`chooseNpcAction` in `lib/npc/kingdoms.ts`
   mirrors this ratio for unit tests). If only one type exists, do that.
   If neither, idle.
4. Reschedule `npc_next_action_at` to `now() + 4-12 random hours`.

The 200-row sampling exists purely for performance (a full-table lateral
join across all ~65k territories previously took ~65s per tick and caused
statement timeouts) — this constraint carries over unchanged.

## New Behavior

Replace step 1+2's candidate sourcing with a two-tier search:

**Tier A — direct neighbors (90% of ticks):**

1. Compute the direct (4-directional) neighbor coordinates of every
   territory the NPC currently owns (≤ 32 owned × 4 neighbors = ≤ 128
   candidate cells — cheap direct query, no sampling needed).
2. Among these neighbor cells, split into:
   - **expansion candidates**: unclaimed, not claim/battle-locked, no
     ownerless garrison present (same filters as today).
   - **attack candidates**: owned by another player/NPC or claim-locked by
     another player/NPC, not battle-locked, where NPC power from the
     adjacent owned territory (as origin) ≥ 1.2× defender power (same
     threshold as today).
3. If at least one candidate (either type) exists in this tier: apply the
   existing 70/30 expand/attack weighting (`chooseNpcAction`) to choose
   between whichever types are present, then pick uniformly at random
   within the chosen type. Origin is always the specific owned territory
   the candidate neighbors (already known from step 1, no separate nearest-
   origin search needed for this tier).

**Tier B — map-wide random fallback (10% of ticks, or whenever Tier A has
no candidates at all):**

- Falls back to exactly today's behavior: 200-row random map-wide sampling
  for both expansion and attack, nearest-owned-origin lookup, 70/30
  weighting. This preserves the "occasionally claims/attacks something far
  away, including other players' territory" behavior the user wants kept.

**Branch selection order per tick:**

```
roll = random()
if roll < 0.90 and Tier A has ≥1 candidate:
    use Tier A
else:
    use Tier B (today's logic, unchanged)
```

If Tier A is empty (e.g. a boxed-in NPC with no free/attackable neighbors),
Tier B always runs regardless of the roll — the 90% is a preference, not a
hard gate that can produce an idle tick when Tier B would have found
something.

## Implementation Notes

- **SQL**: modify `resolve_due_npc_actions()` in a new migration (next
  sequential number — re-check the latest migration file at plan time,
  since `hradby-task4-9` is concurrently claiming `0047` in a separate
  worktree/branch not yet merged to `main`). Use `create or replace
  function` per project convention. The Tier A neighbor query is a plain
  `territories` self-join/`values` lateral against the NPC's owned rows —
  no new indexes expected to be needed given the ≤128-row bound, but verify
  with `explain analyze` against the live-sized table during implementation.
- **TS mirror**: add a new pure function to `lib/npc/kingdoms.ts`, e.g.
  `shouldUseAdjacentTier(hasAdjacentCandidates: boolean, rand: number):
  boolean`, following the existing pattern (pure, deterministic given
  `rand`, unit-testable) so the branch-selection logic has the same
  test-mirror coverage as `chooseNpcAction`/`canNpcAttackTarget`. This does
  not get called from any runtime code path (like the existing mirrors) —
  it exists purely to keep the documented/tested logic in
  `lib/npc/kingdoms.ts` in sync with what the SQL implements, and so a
  future SQL refactor has a clear TS reference to diff against.
- No schema changes, no new columns, no new RLS surface.
- No changes to `_pick_npc_defender_card`, `_territory_effective_unit_power`,
  `_start_claim_core`, `_declare_attack_core`, or any combat-resolution code.

## Testing

- Unit tests (`lib/npc/kingdoms.test.ts`): new `shouldUseAdjacentTier`
  cases (no candidates → always false; has candidates → true below 0.90,
  false at/above 0.90).
- SQL/integration test: seed an NPC with a small owned cluster plus both a
  directly-adjacent free territory and a distant free territory; run
  `resolve_due_npc_actions()` repeatedly with a fixed/controlled random seed
  (or statistically over many runs) and assert the adjacent territory is
  claimed with much higher frequency (~90%) than the distant one.
- Regression: existing NPC kingdom tests (onboarding, attack power
  threshold, 70/30 weighting, reschedule interval) continue to pass
  unchanged.

## Out of Scope (this iteration)

- Any change to attack-vs-expand weighting ratio (stays 70/30) or the
  power-ratio threshold (stays 1.2×) inside either tier.
- Diplomacy-aware NPC decisions (proposing/accepting peace) — tracked
  separately as backlog item `npc-diplomacy-behavior`.
- 8-directional (diagonal) adjacency — only direct 4-directional neighbors
  count as "contiguous" for this iteration.
- Any change to how NPC defends during battle (`_pick_npc_defender_card`).
