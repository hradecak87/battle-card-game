# Admin Panel Overhaul — Design Spec

## Context

The `/admin` page (`app/admin/page.tsx`) has grown into a single long
scrolling page with four always-expanded sections (Online hráči, Aktivní
bitvy, Správa karet, Správa XP). The "Karty vybraného hráče" list renders
one full-width row per card, which becomes very long for players with many
cards. There is also a testing-only "⏩ 10s (test)" speed-up button exposed
to *every* player in `MyMovementsPanel.tsx` (via `debug_speed_up_movement`,
restricted to the caller's own movements) that should move to an
admin-only tool instead, alongside a new read-only monitoring view of all
troop movements/claims in the game (including NPCs).

This spec covers three independent but co-located changes to the admin
page:

1. Make every section collapsible.
2. Replace the flat card list with a compact thumbnail grid.
3. Add a new "Přesuny a zabírání území" monitoring section with an
   admin-only speed-up action, and remove the player-facing speed-up
   button.

## 1. Collapsible sections

A new shared component, `components/admin/CollapsibleSection.tsx`, wraps
a section's heading + description + toggle chevron and children. Clicking
the header (or a dedicated button) toggles expanded/collapsed. All five
sections on `/admin` (Online hráči, Aktivní bitvy, Správa karet, Správa
XP, and the new Přesuny a zabírání) are wrapped in it.

- **Default state on page load: all collapsed.** The admin opens whichever
  section they need.
- State lives in local component state only (one `useState<Set<string>>`
  of open section keys, or one `useState<boolean>` per section) — **not**
  persisted to `localStorage`. A full page reload always starts collapsed.
- Collapsing a section does not unmount its data-fetching effects; the
  existing `useEffect` calls that load players/battles/cards/etc. keep
  running regardless of collapsed state (no lazy-loading-on-expand, to
  keep this change purely visual/structural and avoid subtle refetch
  bugs). Collapsing just hides the rendered content via conditional
  rendering of the section body.

### Component shape

```tsx
interface CollapsibleSectionProps {
  title: string
  description?: string
  defaultOpen?: boolean // always false in practice here, but keep it configurable
  children: React.ReactNode
}
```

Renders the existing `<section className="rounded-2xl border ...">`
wrapper, a header row with an expand/collapse button (chevron icon +
`aria-expanded`), and the children only when open. The existing
`grid gap-6 lg:grid-cols-[1.3fr_0.9fr]` two-column layout for
Správa karet / Správa XP is preserved by wrapping *each* of those two
sub-panels in its own `CollapsibleSection` inside that same grid (so they
can be expanded/collapsed independently of each other).

## 2. Card thumbnail grid ("Karty vybraného hráče")

Replace the current `<ul>` of full-width rows with a responsive grid of
small `TradingCard` thumbnails, 3 per row, inside a height-capped,
independently-scrollable container.

- Grid: `grid grid-cols-3 gap-3`.
- Container: capped to roughly 3 rows of card height (`max-h-[...]` sized
  to 3× the thumbnail's rendered height at this grid width, e.g. using a
  fixed `max-h-[560px]` tuned to look right at 3 columns) with
  `overflow-y-auto` — only this box scrolls, not the whole page.
- Each grid cell renders:
  - `TradingCard` (small/compact instance — reuse the existing `compact`
    prop or an even smaller preset if needed) built from the card
    instance's template + stats, matching how other parts of the app
    (e.g. garrison views) already render owned cards.
  - A small **× button, top-left corner**, absolutely positioned over the
    card, `aria-label="Odebrat kartu {name}"`. Clicking it triggers the
    same removal flow as today (`handleRemoveCard`, including its
    existing confirmation behavior) — no behavior change, only a new
    trigger location/visual.
  - A small **🔍 (magnifying glass) button, top-right corner**, absolutely
    positioned. Clicking it opens a modal showing the same `TradingCard`
    at full size (reuse an existing modal pattern from the codebase,
    e.g. similar structure to other card-preview modals if one exists;
    otherwise a simple centered `Dialog`-style overlay with a close
    button). No other actions live in this modal — just a bigger, more
    detailed look at the card.
  - A short text caption below the thumbnail: name, rank, and current
    location (reusing the existing `territoryLabel()` helper output —
    "Inventář" or `(x, y) · #id`), so the card is identifiable even
    before zooming in.
- Empty/loading states unchanged in wording ("Načítám…" /
  "Vybraný hráč zatím nemá žádné karty.").

## 3. "Přesuny a zabírání území" admin section

### Data source

New read-only RPC, `admin_list_movements()`:

- `security definer`, restricted to `is_admin = true` callers (same
  guard pattern as the other `admin_*` RPCs — raise an exception
  otherwise).
- Calls `resolve_due_movements()` first (same convention as every other
  admin/gameplay RPC) so the list reflects up-to-date state before
  reading.
- Returns one row per `troop_movements` record, joined to `players` for
  `player_id` (display name + `is_npc`) and to `territories` twice (for
  origin and destination x/y), plus a units count via
  `troop_movement_units`:

  ```sql
  id, player_id, player_display_name, player_is_npc,
  kind,                       -- 'transfer' | 'claim'
  origin_territory_id, origin_x, origin_y,
  destination_territory_id, destination_x, destination_y,
  started_at, transfer_arrives_at, status,
  cancelled_at,
  unit_count
  ```

- Ordering: active statuses (`in_transit`, `occupying`) first (by
  soonest `transfer_arrives_at`), then, only if history is requested,
  `completed`/`cancelled` ordered by `started_at desc`, capped at the
  most recent 200 rows total returned by the function (an `order by
  status = 'in_transit' or status = 'occupying' desc, ...` plus a
  `limit 200` is sufficient — no separate pagination UI needed for v1).

### Frontend

New component, `components/admin/AdminMovementsPanel.tsx`, rendered
inside a `CollapsibleSection` on `/admin` titled "Přesuny a zabírání
území":

- Table columns: Hráč (name + a small "NPC" badge when
  `player_is_npc`), Typ (Přesun/Zabírání), Odkud → Kam (`(x,y) → (x,y)`),
  Stav, Zbývající čas / ETA (reuse existing relative-time formatting
  patterns from `MyMovementsPanel.tsx` if present), Počet jednotek,
  and an Akce column with the speed-up button (active rows only).
- Filter controls above the table:
  - A 3-way toggle: **Vše / Jen NPC / Jen hráči** (client-side filter on
    the already-fetched rows — no need for a server-side parameter given
    the modest expected row count).
  - A text input to search by player display name (case-insensitive
    substring match, client-side).
  - A checkbox "Zobrazit i dokončené/zrušené" — unchecked by default,
    which filters the already-fetched list down to `in_transit`/
    `occupying` only; checked shows everything the RPC returned
    (including the historical rows, up to the 200-row cap).
- Speed-up action: new RPC `admin_speed_up_movement(p_movement_id uuid)`,
  `security definer`, guarded by `is_admin = true` (no ownership check,
  unlike the existing player-facing RPC) — otherwise same effect as
  today's `debug_speed_up_movement`: shrinks `transfer_arrives_at` (and,
  for claims, the associated territory's `claim_transfer_arrives_at`/
  `claim_occupation_completes_at`) to ~10s/20s out, then calls
  `resolve_due_movements()`. In the Akce column this is a single small
  icon-only button (⏩, `aria-label="Urychlit na 10s"`, no visible text
  label, to keep the column narrow) that appears only for `in_transit`/
  `occupying` rows, disables itself while in flight, and triggers a
  refetch of the list on success.
- `lib/admin/api.ts` gains `getAdminMovements()` and
  `adminSpeedUpMovement(movementId)` wrappers, following the existing
  file's typed-wrapper conventions.

### Removing the player-facing speed-up button

- Remove the "⏩ 10s (test)" button, its handler, and the
  `debugSpeedUpMovement` import from
  `components/territories/MyMovementsPanel.tsx`.
- Remove `debug_speed_up_movement` from `lib/territories/api.ts`
  (the `debugSpeedUpMovement` wrapper) since nothing calls it anymore.
- Drop the underlying `debug_speed_up_movement(p_movement_id uuid)` RPC
  in a new migration (`revoke`/`drop function`), replaced functionally
  by the new admin-only `admin_speed_up_movement`. Existing tests that
  reference the old button/handler in
  `components/territories/MyMovementsPanel.test.tsx` are updated/removed
  accordingly.

## Out of scope / explicitly deferred

- No lazy data-fetching tied to expand/collapse — all existing effects
  keep running regardless of section state (§1).
- No `localStorage` persistence of section open/closed state (§1).
- No server-side pagination for the movements list — a flat 200-row cap
  is sufficient for the admin's needs today (§3).
- No new permissions model — reuses the existing `players.is_admin`
  flag and RPC guard pattern used by every other `admin_*` function.
