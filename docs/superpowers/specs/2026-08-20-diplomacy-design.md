# Diplomacy Module — Design Spec

Date: 2026-08-20
Status: Approved by user, pending implementation plan

## Summary

Add a diplomacy layer on top of the existing PvP conquest system: a `war`
relationship is created automatically when one player attacks another
player's occupied territory, and either side can then negotiate `peace`
(white peace or peace-for-tribute) to end it. There is no currency in this
game — the only things a player owns are unit/boost cards and territories —
so "tribute" means cards and/or an unoccupied non-home territory.

This does not gate or restrict attacks in any way. War is purely a relationship
label plus a gateway to diplomacy actions; players can already attack each
other freely today and that does not change.

## Data Model

### `diplomacy_relations`

| column | type | notes |
|---|---|---|
| player_a_id | uuid, FK players | always the lexicographically/numerically smaller of the two ids (`least(a,b)`) |
| player_b_id | uuid, FK players | always `greatest(a,b)` |
| state | text, `'war'` | only `'war'` rows are ever stored — **no row means peace**. This avoids pre-creating O(n²) peace rows for every player pair on a 256x256 map with potentially hundreds of players. |
| war_started_at | timestamptz | |
| created_at, updated_at | timestamptz | |

PK `(player_a_id, player_b_id)`. A unique constraint enforces one row per
unordered pair. Ending a war (peace signed) **deletes** the row rather than
setting state to something else — simplest possible representation given
there is only one non-default state.

### `diplomacy_offers`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| initiator_id | uuid, FK players | |
| target_id | uuid, FK players | |
| kind | text, `'white_peace'` \| `'tribute_peace'` | |
| offered_card_ids | uuid[] | card instances owned by `initiator_id`, empty for `white_peace` |
| offered_territory_id | int, nullable, FK territories | must be owned by `initiator_id`, must NOT be `is_home`, must have zero card instances currently stationed on it (`stationed_territory_id = offered_territory_id`) |
| status | text, `'pending'\|'accepted'\|'rejected'\|'cancelled'\|'expired'` | |
| created_at | timestamptz | |
| expires_at | timestamptz | `created_at + interval '3 days'`, consistent with existing trade offer expiry |
| resolved_at | timestamptz, nullable | |

Constraint: `initiator_id <> target_id`. At most one `pending` offer between
any given initiator/target pair at a time (partial unique index on
`(initiator_id, target_id) where status = 'pending'`) — a player must
wait for their existing offer to resolve (or cancel it) before sending
another to the same target, avoiding offer spam.

### RLS

- `diplomacy_relations`: select allowed when `auth.uid() in (player_a_id,
  player_b_id)`. No client writes (RPC-only, `security definer`).
- `diplomacy_offers`: select allowed when `auth.uid() in (initiator_id,
  target_id)`. No client writes (RPC-only).
- `revoke all on both tables from public, anon`.

## Backend RPCs

All `security definer`, revoke from `public, anon`, grant execute to
`authenticated`, following the existing project convention (see
`0012_admin_dashboard.sql` / `world_events` RPCs for the pattern).

- **War creation is NOT a new standalone RPC** — it is wired into the
  existing attack-declaration path. Re-verify the current canonical
  function at implementation time (grep for `declare_attack`; as of the
  world-activity-feed work it was the JSONB-array overload in
  `0027_npc_kingdoms.sql`, but this may have moved again since — check
  fresh). At the point where an attack is declared against a territory
  owned by another **player** (not NPC, not empty), insert a
  `diplomacy_relations` row for that pair if one doesn't already exist
  (`insert ... on conflict do nothing`), and if a row was newly inserted,
  log a `world_events` row (`event_type = 'war_declared'`) with both
  player ids and their home coordinates (reuse the exact logging pattern
  already established for `attack_declared` events in
  `0035_wire_world_events.sql`).

- **`diplomacy_get_relation(p_other_player_id uuid)`** — returns `'war'` or
  `'peace'` for the calling player vs. the given player (peace = no row
  found). Used by profile/map UI to show a badge.

- **`diplomacy_list_wars()`** — returns all `war` rows involving the caller,
  with the other player's display name, kingdom, home coordinates, and
  `war_started_at`.

- **`diplomacy_propose_peace(p_target_id uuid, p_kind text, p_offered_card_ids uuid[] default '{}', p_offered_territory_id int default null)`**
  - Reject if no `war` row exists between caller and target.
  - Reject if caller already has a `pending` offer to this target (see
    unique index above) — client should show "you already have a pending
    offer" rather than letting this reach the server as a surprise.
  - For `tribute_peace`: validate every card in `p_offered_card_ids` is
    owned by the caller and currently `stationed` (not `in_transit`/
    `deposit` — must be in the caller's control uncontested); validate
    `p_offered_territory_id` (if given) is owned by the caller, not
    `is_home`, and has no card instances with
    `stationed_territory_id = p_offered_territory_id`.
  - For `white_peace`: `offered_card_ids` must be empty and
    `offered_territory_id` must be null (reject otherwise — don't silently
    ignore extra input).
  - Insert the offer row, return it.

- **`diplomacy_accept_peace(p_offer_id uuid)`**
  - Caller must be `target_id` on the offer, offer must be `pending` and not
    expired (auto-expire past `expires_at` the same way trade offers do —
    check the existing expiry-check pattern in `lib/trading`/trade RPCs and
    mirror it).
  - Transfer: `update card_instances set owner_id = target_id where
    instance_id = any(offered_card_ids)`; if `offered_territory_id` is set,
    `update territories set owner_id = target_id where id =
    offered_territory_id` (re-validate at accept-time that it's still
    ownerless-of-troops and still owned by initiator — state may have
    changed since the offer was created; reject the whole accept with a
    clear error if not, do not partially apply).
  - Delete the `diplomacy_relations` row for this pair (peace restored).
  - Mark this offer `accepted`, `resolved_at = now()`; mark any other
    `pending` offers between this same pair `cancelled` (a peace treaty
    resolves all outstanding proposals between the two, not just the
    accepted one).
  - Log `world_events` (`event_type = 'peace_signed'`) with both player ids
    and home coordinates, and whether tribute was involved (for the feed
    message wording).

- **`diplomacy_reject_peace(p_offer_id uuid)`** — caller must be `target_id`,
  offer must be `pending`; sets `status = 'rejected'`, `resolved_at = now()`.

- **`diplomacy_cancel_peace(p_offer_id uuid)`** — caller must be
  `initiator_id`, offer must be `pending`; sets `status = 'cancelled'`,
  `resolved_at = now()`.

## Frontend

- New **`/diplomacy`** page (added to main nav, alongside `/world` and
  `/chat`) with two sections:
  1. **"Moje války"** — list of active wars (other player's name/kingdom,
     home-coordinate map link, time started), each with a "Navrhnout mír"
     button opening a peace-proposal form (white peace vs. tribute, tribute
     card picker reusing the existing trade-offer card-selection component
     if one already exists and is generic enough — check
     `components/trading/` before building a new one — plus a
     territory picker limited to the caller's non-home, garrison-free
     territories).
  2. **"Nabídky míru"** — incoming and outgoing pending offers, each with
     accept/reject (incoming) or cancel (outgoing) actions and a clear
     description of what's being offered.
  - **Mobile portrait**: both sections render full-width, stacked vertically
    (not side-by-side columns); each war/offer renders as its own card-style
    block with large tap targets; the peace-proposal form opens as a
    fullscreen overlay (same pattern as the chat widget's mobile overlay)
    rather than a small centered modal.
- **War badge**: on `/map` tile details and on player profile pages, show a
  small "⚔️ Válka" badge when `diplomacy_get_relation` returns `'war'` for
  the viewed player, linking to `/diplomacy`.
- **World feed**: `WorldEventsFeed` gains two new event-type renderers
  (`war_declared`, `peace_signed`), following the exact same `mapLink`/
  message-composition pattern already used for the other event types.
- Polling: `/diplomacy` page polls every ~10–15s while visible, using the
  same visibility-aware polling hook already built for chat
  (`components/chat/useVisiblePolling.ts` — reuse it directly rather than
  duplicating).

## Testing & Done Criteria

- RPC unit tests: attacking a player with no existing war creates exactly
  one `diplomacy_relations` row (idempotent — a second attack does not
  error or duplicate); tribute validation rejects a card the caller doesn't
  own, a home territory, an occupied territory, and a territory the caller
  doesn't own; accepting peace transfers cards/territory and deletes the
  war row; accepting one offer cancels other pending offers between the
  same pair; RLS isolation (a third player cannot see or act on another
  pair's war/offers).
- Component tests: `/diplomacy` page sections, mobile-portrait layout
  (stacked sections, fullscreen proposal overlay), war badge rendering,
  world feed's two new event types (including their map links).
- Done when: attacking a player reliably creates a war entry exactly once,
  peace (both white and tribute) can be proposed/accepted/rejected/
  cancelled end-to-end against the live DB, tribute transfers are verified
  correct and cannot be gamed (re-validated at accept time), mobile-portrait
  UX verified, full suite (`jest`, `tsc`, `build`) green.

## Out of Scope (this iteration)

- Manually declaring war without attacking.
- Alliances/coalitions between multiple players (tracked separately as
  backlog #30, explicitly depends on this module).
- Any war-time combat bonus/penalty — war is a label + diplomacy gateway
  only, it does not change battle mechanics.
- Tribute involving anything other than cards and a single territory (no
  partial/percentage territory tribute, no recurring/installment tribute).
- Automatic war expiry/timeout — wars persist until a peace treaty is
  signed, no forced resolution.
