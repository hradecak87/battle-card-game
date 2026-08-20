# World Activity Feed ("Dění ve světě") — Design Spec

Date: 2026-08-20
Backlog item: #13 ("News feed" module)
Status: Approved by user, ready for implementation planning

## Goal

A new, always-visible page that acts as a public activity portal for the
whole game world: what attacks/claims/battles are currently happening, and
a rolling history feed of recently-resolved world events. Every logged-in
player can see it — this mirrors the existing design intent that ongoing
attacks are already visible to everyone on the map.

## Page

- Route: `/world`
- Nav label: "Dění ve světě", added to `MainNav` links for all logged-in
  players (same visibility as `/map`, `/collection`, etc. — no admin gate).
- Four sections, top to bottom: attacks in transit, claims in progress,
  active battles, world events feed (RSS-style history).
- **Mobile (portrait) friendly**: single-column stacked layout on small
  screens, list rows wrap to two lines (name above target instead of
  side-by-side with an arrow), feed pagination buttons sized for touch.
  Reuses the same responsive patterns already used in `MyMovementsPanel`
  and `app/collection/page.tsx`.

## Data model: `world_events`

Append-only log table, no deletion/cron for now (a future admin-side cap/
purge tool is a natural follow-up once the table grows large enough to
matter, but is explicitly out of scope for this spec).

```sql
create table world_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  created_at timestamptz not null default now(),
  payload jsonb not null
);
create index world_events_created_at_idx on world_events (created_at desc);
```

`payload` carries whatever a feed row + its map-focus links need: player
id(s), display name(s), home territory coordinates, target territory
coordinates, and any event-specific detail (e.g. new level number).

### Event types

| `event_type` | Written from | Feed text pattern |
|---|---|---|
| `attack_declared` | `declare_attack` | "X zahájil tažení na Y" |
| `territory_claimed` | `resolve_due_movements` (empty-territory claim branch) | "X obsadil území Z" |
| `battle_won` | `_finalize_battle` | "X vyhrál bitvu nad Y o území Z" |
| `battle_surrendered` | `surrender_battle` | "X se vzdal v bitvě o Z (Y vyhrál)" |
| `territory_abandoned` | `abandon_territory` | "X se vzdal území Z" |
| `attack_recalled` | `recall_attack` | "X odvolal útok na Z" |
| `king_relocated` | `relocate_home` | "X přenesl královské sídlo na Z" |
| `player_leveled_up` | XP-award path (`_award_xp` / wherever level is recomputed) | "X dosáhl levelu N" |
| `player_joined` | new-player registration path | "X se připojil do hry" |

Each write is a single `insert into world_events (...) values (...)` added
at the end of the correct, single canonical write-path for each action —
**not necessarily the "latest redefinition of a same-named function"**,
since some of these actions are resolved via set-based updates or have
multiple overloads. Confirmed canonical owners (grep
`create or replace function`/`create or replace trigger` across all
`supabase/migrations/*.sql` and take the latest one — verify again at
implementation time, since new migrations may land before this is built):

- `attack_declared` — the canonical `declare_attack` implementation is the
  JSONB-array-overload in `0027_npc_kingdoms.sql`; a later legacy
  array-typed overload exists purely as a delegating wrapper. Log **only**
  inside the JSONB implementation (or a shared `_declare_attack_core` if
  one exists) — never in the wrapper too, or every attack logs twice.
- `territory_claimed` — **not a simple end-of-function insert.**
  `resolve_due_movements()` (latest in `0027_npc_kingdoms.sql`) completes
  claims via a **set-based UPDATE that can finish multiple claims in one
  call**. This must become a per-row insert (e.g. `RETURNING` the
  completed claimant/territory rows, or extending whatever loop already
  exists over completed claims) — a single trailing insert cannot capture
  one event per claim.
- `battle_won` / `battle_surrendered` — **must not double-log.**
  `surrender_battle()` (`0019_battle_surrender.sql`) calls `_finalize_battle`
  (latest in `0030_wire_card_limit.sql`), so naively adding an insert to
  both functions produces two feed rows for one surrender. Centralize the
  event insert inside `_finalize_battle`, passing through enough
  information (the existing `p_defender_surrendered` param plus which side
  initiated a surrender) to pick the correct single `event_type`.
- `attack_recalled` — `recall_attack`, latest in `0025_...sql`.
- `territory_abandoned` — `abandon_territory`, latest in
  `0021_abandon_territory.sql`.
- `king_relocated` — `relocate_home`, latest in `0024_king_relocate_home.sql`.
- `player_leveled_up` — `_award_xp`, latest in `0030_wire_card_limit.sql`.
- `player_joined` — **not an RPC.** The actual write path is the
  `handle_new_user()` trigger function (`0001_players.sql`) fired by the
  `on_auth_user_created` trigger. It runs with no `auth.uid()` context
  (triggered by Supabase auth, not a logged-in player action) — redefine
  the trigger function itself, don't treat it like a player-initiated RPC.

## Row-level security & RPC grants

- `world_events` has RLS **enabled** with **no** insert/update/delete
  policy for `anon`/`authenticated` — all writes happen exclusively via
  `security definer` functions, never directly from the client.
- Every new RPC explicitly `revoke execute ... from public, anon` and
  `grant execute ... to authenticated` (matches the existing pattern used
  for `_`-prefixed internal helpers elsewhere in the migrations).
- `payload` must only ever contain data that's already intentionally
  public elsewhere in the game (display names, territory coordinates,
  levels) — never anything sensitive — since these RPCs bypass per-row RLS
  by construction.

## Backend RPCs

All `security definer`, `set search_path = public`, gated only by
`auth.uid() is not null` (no `admin_require_admin()` — this is
intentionally public data, unlike the `admin_*` dashboard RPCs).

**Live sections** (derived directly from current state, no pagination —
naturally small given the 32-territory-per-player cap and 5-concurrent-claims
cap):

- `world_list_attacks_in_transit()` — from `troop_movements` where
  `kind = 'attack' and status = 'in_transit'` (status filter matters —
  `kind = 'attack'` alone also matches already-resolved/cancelled rows):
  attacker id/display_name/home coords, target territory coords,
  `transfer_arrives_at` (battle-start ETA).
- `world_list_claims_in_progress()` — from `territories` where
  `claim_locked_by is not null`: claiming player id/display_name/home
  coords, target territory coords, `claim_occupation_completes_at`
  (claim-completion ETA).
- `world_list_active_battles()` — from `battles` where
  `status in ('awaiting_ready', 'active')`: attacker + defender
  id/display_name/home coords, territory coords, `status`.

**History feed** (paginated):

- `world_list_events(p_page integer default 0, p_page_size integer default 10)`
  — returns rows ordered `created_at desc, id desc` (tie-break to guarantee
  stable ordering), plus a total count **clamped to at most 50**. Both
  `p_page` and `p_page_size` are validated/clamped server-side (e.g.
  `p_page_size` clamped to 1-10, `p_page` clamped so `p_page * p_page_size`
  never exceeds the 50-row window) so no combination of inputs can ever
  page past the advertised most-recent-50 window into older history.

## Frontend

- `lib/world/api.ts` — thin wrappers around the 4 RPCs (same pattern as
  `lib/admin/api.ts`), typed row shapes.
- `components/world/AttacksInTransitList.tsx`,
  `ClaimsInProgressList.tsx`, `ActiveBattlesList.tsx`,
  `WorldEventsFeed.tsx` (with its own pagination controls) —
  one component per section, each independently testable.
- `app/world/page.tsx` — composes the four components, polls the three
  live-section RPCs every 30s (same interval/pattern as `MainNav`'s
  `pendingCount` poll); the feed section re-fetches on page changes only
  (its own pagination), not on the 30s timer.
- Every player/territory reference in every section is a `<Link
  href="/map?x=..&y=..">` — player names link to their **home territory**
  coordinates, territory references link to the **target territory**
  coordinates.
- `app/map/page.tsx` gains `useSearchParams()`-based initial-mount reading
  of `?x=&y=` to set `centerX`/`centerY` (uses the existing "jump to
  coordinates" mechanism already built into `MapViewport`) — no other
  behavior change to the map page.

## Testing

- Unit: `lib/world/api.ts` wrappers (mocked Supabase client) — request
  shape, response mapping, ordering.
- Component: each of the 4 list/feed components with mock data, including
  empty states (e.g. "žádné aktivní bitvy"); `WorldEventsFeed` pagination
  (correct page count for 50 rows, disabled prev/next at the edges).
- `app/map/page.test.tsx`: new case asserting `?x=100&y=50` sets
  `centerX`/`centerY` to 100/50 on mount.
- SQL `.verification.sql` (same manual smoke-test pattern as prior
  migrations): create a scratch player/battle/claim, confirm each of the 4
  RPCs surfaces it, and confirm `world_events` gets the right row after each
  action (attack declared, territory claimed, battle won, surrender,
  abandon, recall, king relocate, level up, new player).

## Done when

- `npx jest --runInBand --silent` and `npx tsc --noEmit` both pass.
- New migration applied live to Supabase via `pg.Client`/`SUPABASE_DB_URL`
  and verified.
- `/world` is reachable from `MainNav`, renders all 4 sections against the
  live DB, and mobile-portrait layout is single-column and touch-friendly.

## Explicitly out of scope (YAGNI)

- Admin-side log size cap / purge tooling (noted as a future follow-up,
  not built now).
- Any privacy/opt-out mechanism — matches existing design intent that
  world activity (attacks, claims) is already publicly visible on the map.
- Auto-refresh for the events feed itself (only the 3 live sections poll;
  the feed is paginated and refreshes on user navigation).
