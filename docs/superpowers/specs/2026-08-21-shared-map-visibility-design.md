# Shared Map Visibility (Coalitions Phase 3) — Design

## Purpose

Extend the coalitions system (phase 1: `2026-08-21-coalitions-design.md`,
phase 2: `2026-08-21-troop-lending-design.md`) so coalition members can see
each other's troop movements on the map — something no third party can see
today for anyone else's movements.

## Current state (confirmed by exploring the codebase)

- Garrison/army composition at **any** territory is already visible to
  **everyone** via `get_visible_territory_cards(territory_id)` (no
  ownership check; only boost cards are masked from non-owners). No change
  needed here — this part of the original request is already satisfied.
- Troop movements (attacks, transfers, claims) are visible only to the
  mover themselves (`get_my_movements()`) and, for incoming attacks, only to
  the defending territory's owner (`get_incoming_attacks_on_my_territories()`).
  A third party sees no arrow and no detail for anyone else's in-transit
  movement — not even that one exists. `get_movement_cards(movement_id)` is
  gated to `tm.player_id = caller` only. `troop_movement_units` has a
  `using (false)` select policy, so the RPC is the only access path.
- The map's own generic per-tile data (`get_viewport`) exposes a `battle_id`
  once a battle has actually started, visible to all — not affected here.

**The real gap to close:** a coalition member cannot see an ally's
in-transit movements (outgoing or incoming) at all today. This spec adds
that, scoped strictly to current coalition membership.

## Scope

Visibility applies to **all** movement kinds (`attack`, `transfer`,
`claim`) of a coalition member, regardless of the movement's target —
since phase 1 already restricts a member's attacks to targets the whole
coalition is at war with, every movement a member makes is inherently
coalition-relevant. No filtering by target is needed.

- Live/current only — no history, no retroactive visibility after someone
  leaves the coalition.
- Only current coalition members see each other; never third parties.

## Backend

- `get_coalition_movements()` — mirrors `get_my_movements()`'s shape, but
  returns `in_transit` movements for every player who shares an
  undisbanded coalition with the caller (via `coalition_members` self-join,
  same pattern as `0065_coalition_attack_enforcement.sql`), excluding the
  caller's own (already covered by the existing endpoint).
- `get_incoming_attacks_on_coalition_territories()` — mirrors
  `get_incoming_attacks_on_my_territories()`, but matches territories owned
  (or claim-locked) by any current coalition member of the caller, not just
  the caller.
- `get_movement_cards(p_movement_id)` — widen the existing `where` clause
  to also allow the caller when they share a coalition with `tm.player_id`.

## Frontend

- `useMapMovementArrows` gains a call to the two new RPCs and produces new
  arrow categories (`ally-transfer`, `ally-offensive`, `ally-incoming`),
  rendered in `MapMovementArrows` with a distinct color from the player's
  own arrows (own vs. ally vs. incoming-enemy should all be visually
  distinguishable).
- Clicking an ally arrow opens the existing `MovementDetailModal`
  unchanged — it already calls `get_movement_cards`, which now authorizes
  coalition members too.

## Testing

- RPC tests: a coalition member sees an ally's outgoing/incoming
  movements and card composition; a non-member sees nothing; visibility
  stops immediately after the ally leaves/is kicked/the coalition
  disbands (reusing the same current-membership check as the RPCs, so no
  extra cleanup logic is needed — membership rows are simply gone).
- Frontend tests: new arrow categories render with distinct styling and
  open the detail modal on click, mirroring existing arrow tests.
