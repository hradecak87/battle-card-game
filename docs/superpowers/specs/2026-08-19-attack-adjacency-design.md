# Attack adjacency (backlog #10) — design

## Problem

Today `declare_attack()` allows attacking any territory regardless of
distance or surrounding ownership — only the transfer ETA changes with
distance. This lets a player attack straight into the interior of another
player's contiguous landmass without first taking any of its border
territories, which doesn't match the intended "siege the frontier first"
feel.

## Rule

A territory `D` owned by player `P` (i.e. `territories.owner_id = P`) can
only be attacked if at least one of its 4 orthogonal neighbors (up, down,
left, right — not diagonals) is **not** owned by `P`. That includes:
- a neighbor owned by a different player,
- a neighbor that is unclaimed/NPC-garrisoned (`owner_id is null`),
- a neighbor that doesn't exist because `D` is on the edge of the 256×256
  grid.

If all 4 in-grid neighbors are owned by the same `P`, `D` is an "interior"
territory and cannot be attacked directly — the attacker must first take
one of `P`'s bordering territories.

**Territories with `owner_id is null` (truly empty or NPC-garrisoned) are
exempt from this rule and remain always attackable**, regardless of their
neighbors. NPC territories have no ownership column to group into a
contiguous landmass the way player-owned land does, so there's no
meaningful "interior NPC territory" concept yet. When a more advanced NPC
world-simulation is eventually built (see the `npc-autonomous-behavior`
roadmap item), this should be revisited to decide whether NPC-controlled
regions should get their own adjacency/siege rule at that point.

This rule does not affect `start_claim`/`cancel_claim` (the peaceful-claim
RPCs) since they only ever target `owner_id is null` territories, which are
exempt.

## Server change

New migration `0017_attack_adjacency.sql`, following the established
"immutable migration history" convention: `create or replace function
declare_attack(...)` copied from the current definition (`0003_battles.sql`,
as later amended) with one addition — a border check inserted at both
places the target territory is already validated (the initial read and the
row-locked recheck immediately before writing), mirroring the existing
double-check pattern for the other target-territory invariants:

```sql
if target_owner is not null then
  if not exists (
    select 1
    from (values (target_x - 1, target_y), (target_x + 1, target_y),
                 (target_x, target_y - 1), (target_x, target_y + 1)) as n(nx, ny)
    left join territories t2 on t2.x = n.nx and t2.y = n.ny
    where t2.id is null or t2.owner_id is distinct from target_owner
  ) then
    raise exception 'target territory is surrounded by owner''s own territory and cannot be attacked directly';
  end if;
end if;
```

A matching `0017_attack_adjacency.verification.sql` will cover: (a) an
interior territory (all 4 neighbors same owner) is rejected, (b) a border
territory (at least one differing/off-grid/null neighbor) succeeds, (c) a
grid-edge territory (x=0 or y=255 etc.) is always attackable regardless of
its other neighbors, (d) NPC/empty targets are unaffected.

## Client change

- New `lib/territories/attackReachability.ts`: pure function
  `isTerritoryAttackable(targetOwnerId, neighborOwnerIds: (string | null)[])`
  — returns `true` if `targetOwnerId` is null, or if any neighbor owner
  differs from it (including a missing/off-grid neighbor represented as
  `null` in the input array, matching the server's `t2.id is null` case).
  Plus `lib/territories/attackReachability.test.ts` covering the same cases
  as the SQL verification file.
- `DeclareAttackModal`: on open, fetch the target's 4 orthogonal neighbor
  territories' `owner_id` via a direct `territories` select (public read via
  existing RLS `territories_select_all` policy — no new RPC needed), compute
  `isTerritoryAttackable`, and if `false`, disable/hide the submit button and
  show a short Czech message (e.g. "Toto území je obklíčeno nepřátelským
  územím – nejprve dobyj okrajová území.") instead of the normal card-picker
  form. No changes to the map's own rendering (per owner's explicit choice —
  error+disabled-button only, no advance visual indicator on the map itself).

## Testing

- New unit tests for `attackReachability.ts` (interior/border/edge/null
  cases).
- Update/extend `DeclareAttackModal.test.tsx` for the new
  blocked-submit-with-message case.
- New `0017_attack_adjacency.verification.sql` (manual, not automated, same
  pattern as other migrations).
- No changes needed to existing `declare_attack` behavior for any
  currently-passing test scenario (border/NPC/empty targets keep working
  exactly as before).
