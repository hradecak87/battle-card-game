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
- **Correction on what's actually protected today:** `troop_movements`
  itself has a public-read RLS policy (`using (true)`, same convention as
  `territories`/`players`/`card_instances`) — so movement *existence and
  metadata* (kind, origin/destination, timestamps, status) are already
  queryable by anyone directly against the table today. The real existing
  protection boundary is movement **composition** — `troop_movement_units`
  has a `using (false)` policy, and `get_movement_cards(movement_id)` is
  the only access path, gated to `tm.player_id = caller`. The current
  frontend (`get_my_movements()`, `get_incoming_attacks_on_my_territories()`,
  `useMapMovementArrows`) only ever *surfaces* a player's own movements and
  incoming attacks on their own territory as arrows — nothing stops a
  third party from querying the raw table, but the UI/RPC layer doesn't
  build ally-facing arrows or expose ally movement composition today.
  This phase's real contribution is therefore **UX (arrows, filtering to
  relevant allies) plus widening composition access to coalition
  members** — not closing a table-level access-control gap, since none
  exists for metadata. `troop_movements` RLS is left as-is (public-read,
  consistent with the rest of the schema); only `get_movement_cards`'s
  authorization changes.

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
  caller's own (already covered by the existing endpoint). Additionally
  includes mover-identity columns (`player_id`, `display_name`,
  `kingdom_name`, `is_npc`) — needed so the frontend can label/color each
  ally's arrow, the same way `get_incoming_attacks_on_my_territories()`
  already includes attacker identity columns today. This check is a live
  query against current `coalition_members` rows each call (no snapshot
  taken at movement start), so visibility naturally stops the instant a
  membership row is removed — nothing to reconcile if an ally leaves mid-transit.
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
