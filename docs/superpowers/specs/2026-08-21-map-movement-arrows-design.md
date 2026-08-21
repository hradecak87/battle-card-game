# Map movement arrows — design

## Summary

Visualize in-transit army movements on the main map viewport (`/map`) as
animated arrows between origin and destination tiles, so a player can see
at a glance which of their transfers/attacks are under way and which
enemy attacks are converging on their own territory — without opening the
"Moje probíhající akce" list or clicking through individual tiles.

## Scope

Arrows are drawn for exactly three categories of `troop_movements` rows
with `status = 'in_transit'`:

1. **My own transfers** (`kind = 'transfer'`) — reinforcements moving
   between two of my own territories.
2. **My own offensive movements** (`kind = 'attack'` or `kind = 'claim'`) —
   an army I sent marching toward a target (an owned/contested territory
   for `attack`, an empty one for `claim`). Both render identically
   (same color), since from the sender's point of view they're the same
   kind of action: "my army marching toward a target".
3. **Incoming attacks against my territory** — another player's or NPC's
   `attack`-kind movement whose destination is a territory I own **or am
   currently claiming**. This is the existing
   `get_incoming_attacks_on_my_territories()` data set, already used by
   `MyMovementsPanel`'s defender section.

Movements belonging to other players that don't involve me in any way
(neither sender nor destination owner) are **not** shown — this preserves
the existing privacy model where only battle/claim locks on tiles are
publicly visible, not the underlying movement details.

## Visual design

- Each movement renders as a **straight guide line** from origin-tile
  center to destination-tile center, with a small **arrowhead** at the
  destination end, plus a **single colored dot** that continuously
  animates along the line. The dot's position is computed purely
  client-side from `(now - started_at) / (transfer_arrives_at -
  started_at)`, clamped to `[0, 1]` — no extra network round-trips are
  needed for the animation to look live between data refreshes.
- **Color by category:**
  - Amber/orange — my transfer.
  - Red — my attack or claim.
  - Fuchsia/purple — incoming attack on me.
- **Viewport clipping:** a movement is drawn only if at least one of its
  two endpoints falls within the currently loaded viewport window
  (`[x1,x2] × [y1,y2]`, the same bounds `loadViewport` already fetches).
  If only one endpoint is visible, the line is clipped to the viewport's
  edge, with the arrowhead/dot still indicating the direction of travel
  (into or out of view). If neither endpoint is visible, the movement is
  skipped entirely — no general line/viewport intersection test, by
  design (YAGNI; a movement passing *through* an unrelated visible area
  without either endpoint present is not drawn).
- **Toggle:** a "Zobrazit pohyby" button/checkbox near the existing map
  controls (pan/zoom/jump) shows or hides all arrows at once. Plain
  component state for this iteration — no persistence across sessions or
  page reloads.
- **Minimap:** out of scope. Arrows only render in the main detailed
  viewport (`MapViewport`). Note: `components/territories/Minimap.tsx`
  and `getMinimapOverview()` already exist and are tested, but are not
  actually rendered anywhere in the app today — this is a pre-existing,
  unrelated gap, not addressed by this design.

## Click-through detail

Clicking a movement's line or its animated dot opens a new
`MovementDetailModal`, styled consistently with the existing map detail
modals (`GarrisonModal`, `DeclareAttackModal`, etc.):

- **My own transfer/attack/claim:** origin and destination, each shown as
  name-or-coordinates and clickable to recenter the map (same
  `onNavigateToTerritory` convention used elsewhere), the full list of
  card instances in the movement (unit type + rank), and a live ETA
  countdown.
- **Incoming attack on me:** attacker's identity (display name + kingdom,
  or "NPC"), their home territory (clickable, same convention), and ETA.
  **No unit count or card list** — this preserves the existing fog-of-war
  behavior (`IncomingAttackInfo`/`IncomingAttackOnMyTerritory` already
  never expose attacker unit counts today; this feature must not
  introduce a new way to leak that information). A future "Scout" card
  that reveals enemy composition before battle is a natural follow-up,
  but is explicitly out of scope here.
  - Note: `get_incoming_attacks_on_my_territories()` (the RPC backing
    this list) currently does **not** return `attacker_kingdom_name`
    (only the separate single-territory `get_incoming_attack_info()` RPC
    does). This spec includes adding that one column to
    `get_incoming_attacks_on_my_territories()`'s return type, mirroring
    what `get_incoming_attack_info()` already exposes — a small, scoped
    addition, not a new RPC.

## Data & architecture

- **New hook** (e.g. `useMapMovementArrows`, colocated under
  `lib/territories/` or `components/territories/`) that combines:
  - `getMyMovements()` filtered client-side to `status === 'in_transit'`
    (covers categories 1 and 2 above).
  - `getIncomingAttacksOnMyTerritories()` (category 3).
  - Bulk-resolves any referenced territory ids to coordinates via the
    existing `getTerritoriesByIds()` (the same pattern already used in
    `MyMovementsPanel` — `getIncomingAttacksOnMyTerritories` already
    returns `territory_x`/`territory_y`/`attacker_home_x`/`attacker_home_y`
    directly, so only `getMyMovements()`'s origin/destination ids need
    resolving).
  - Produces a unified list of arrow descriptors: `{ id, category:
    'transfer' | 'offensive' | 'incoming', originX, originY, destX,
    destY, startedAt, arrivesAt, movementId? (mine only), attacker info?
    (incoming only) }`.
- **New component** `components/territories/MapMovementArrows.tsx` — an
  absolutely-positioned SVG overlay rendered inside `MapViewport.tsx`'s
  grid container, reusing the same `cellPx`/viewport-bounds pixel math
  already used to position tiles, so arrows stay pixel-aligned across
  pan/zoom.
- **New component** `components/territories/MovementDetailModal.tsx` for
  the click-through detail described above.
- **New backend RPC** `get_movement_cards(movement_id)` — returns the
  card instances (joined with templates for type/rank) attached to a
  movement via the existing `troop_movement_units` join table. Enforced
  **server-side** to only return rows when the caller is that movement's
  own `player_id` (`troop_movements.player_id = auth.uid()`), mirroring
  how `IncomingAttackInfo` already omits unit-count data entirely rather
  than relying on client-side filtering.
  - **Required accompanying migration:** `troop_movement_units` currently
    has an RLS policy `using (true)` — publicly selectable by any client,
    which would let a client bypass this RPC's authorization entirely via
    a direct table select (confirmed no existing client code depends on
    direct reads of this table — all current references are inside
    `security definer` SQL functions). This spec includes tightening that
    policy (e.g. `using (false)`, access only via `security definer`
    RPCs) so the new RPC's server-side check is the only way to reach
    this data, not merely client-side hiding.
- **Refresh trigger:** arrows appear/disappear/update using the same
  refresh mechanism `MyMovementsPanel` already uses: an initial load plus
  **polling every 15 seconds** (matching `MyMovementsPanel`'s existing
  `setInterval(..., 15000)`), *and* an immediate reload whenever the
  page's `movementsRefreshKey` is bumped (transfer/attack/claim
  started/cancelled elsewhere on the page). No new realtime channel is
  introduced by this design.

## Explicitly out of scope

- True realtime (sub-second/push-based) updates — arrows refresh on the
  same 15s poll + refresh-key cadence as `MyMovementsPanel` (see Data &
  architecture), not instantly. Push-based updates are tracked separately
  under the existing `realtime-map-and-actions-feed` backlog item; this
  feature will benefit from it later but doesn't require it now.
- Arrows on the minimap.
- Persisting the show/hide toggle preference across sessions.
- A future "Scout" card revealing enemy army composition before battle —
  noted as a good idea for its own future backlog item.
