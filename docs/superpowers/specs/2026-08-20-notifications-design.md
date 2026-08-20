# Notifications module — design spec

Date: 2026-08-20
Status: Approved for planning (see brainstorming session)
Backlog reference: `notifications-module` ("Attack alerts + trade offer
notifications, mechanism TBD (email/push/in-app). Not designed yet.")

## Problem

Two attack-relevant surfaces exist today but neither is a real notification
system:

- **Attack alerts**: `useMyTerritoriesBattleChannel` shows a toast only while
  the player has the map page open. Nothing persists, nothing fires while
  offline or on another page.
- **Trade offers**: no notification exists at all. The recipient must
  manually check the Trading page to discover a new offer.

Other event types (battle results, territory loss, war declarations, peace
offers, level-ups, new DMs) have no player-facing alert beyond the global
`/world` activity feed, which is not player-scoped and easy to miss.

## Scope

**Channels**: in-app (persistent bell + panel) **and** Web Push (Android/
Chrome and other Web-Push-capable browsers). No email in this iteration.
iOS Safari's Web Push limitation (requires "Add to Home Screen") is an
accepted known limitation — not addressed in this MVP.

**Event types** that generate a notification:

| Type | Trigger | Recipient(s) |
|---|---|---|
| `attack_incoming` | `_declare_attack_core` (lives in `0045_diplomacy_war_creation.sql` as of this writing) | territory's current owner |
| `war_declared` | `_declare_attack_core` (new war relation created) | both players |
| `battle_resolved` | `_finalize_battle_base_0025` | attacker + defender |
| `territory_lost` | `_finalize_battle_base_0025` (capture) | defeated defender |
| `trade_offer_received` | `create_trade_offer` (direct offer to a specific player only — public marketplace listings via `list_public_trade_marketplace` do not notify anyone until acted on) | offer recipient |
| `trade_offer_accepted` | `accept_trade_offer` / `respond_to_public_offer` (accepted branch) | offer creator |
| `trade_offer_rejected` | `reject_trade_offer` / `respond_to_public_offer` (rejected branch) | offer creator |
| `peace_offer_received` | diplomacy peace-offer RPC (`lib/diplomacy`) | offer recipient |
| `level_up` | `_award_xp` (level increases) | the leveling player |
| `dm_message` | chat DM send RPC (`lib/chat`) | recipient (one row per conversation, not per message — chat's existing `unread_count` already tracks message-level detail) |

Note: `trade_offer_accepted` and `trade_offer_rejected` are two distinct
types (not one type covering both outcomes), so the bell/panel and push
copy can say "accepted" or "rejected" unambiguously without inspecting
`payload` to figure out which happened. All RPC names above are the actual
function names in `lib/trading/api.ts` and `lib/diplomacy` — verified
against the current repo, not the earlier-drafted "exchange" module name
(there is no `lib/exchange`; the correct path is `lib/trading`).

## Data model

### `notifications` table

| column | type | notes |
|---|---|---|
| `id` | bigserial | PK |
| `player_id` | uuid | FK → players, recipient |
| `type` | text | one of the event types above (check constraint) |
| `payload` | jsonb | type-specific data for rendering text + a click-through link (e.g. territory id/x/y, other player id/display name, conversation_id) |
| `is_read` | boolean | default false |
| `created_at` | timestamptz | default now() |

Indexes: `(player_id, created_at desc)` for listing, `(player_id, is_read)`
for unread-count queries.

For `dm_message`, inserting is an upsert keyed on `(player_id, type,
conversation_id)` from payload so a burst of DMs collapses to one
notification row per conversation (refreshing `created_at`/`is_read=false`
on each new message) rather than growing unbounded.

### `push_subscriptions` table

| column | type | notes |
|---|---|---|
| `id` | bigserial | PK |
| `player_id` | uuid | FK → players |
| `endpoint` | text | unique, the browser's push endpoint URL |
| `p256dh` | text | Web Push encryption key |
| `auth` | text | Web Push auth secret |
| `created_at` | timestamptz | default now() |

A player can have multiple rows (multiple devices/browsers).

### Retention

Notifications older than 30 days are deleted. No cron/scheduled-job
infrastructure exists in this project (confirmed convention, see
`0023_dynamic_card_supply.sql`); consistent with that, the cleanup runs as a
cheap side-effect (`delete from notifications where created_at < now() -
interval '30 days'`) tacked onto `resolve_due_movements()`, which already
gets invoked lazily from many other RPCs.

## Event generation

Each RPC listed in the table above gets one additional `insert into
notifications (...)` (or the DM upsert) alongside its existing
`world_events` insert, in the same transaction as the game action itself —
so a notification can never exist without the underlying event having
actually committed, and vice versa.

## In-app delivery

- A bell icon with an unread-count badge sits next to `AuthStatusBar`,
  visible on every page.
- Realtime: reuse the existing `postgres_changes` hook pattern (see
  `useMyTerritoriesBattleChannel`) — subscribe to `notifications` filtered
  by `player_id = <current user>`; badge count updates immediately on
  INSERT/UPDATE.
- On mount (before any realtime event arrives), the bell fetches its
  initial state via two RPCs: `get_unread_notification_count()` (badge
  number) and `list_notifications(limit, before_id)` (panel contents,
  paginated by `id` cursor, newest first). These are the same two RPCs the
  `/notifications` full-history page uses (with a larger page size and its
  own pagination), so there is exactly one read contract shared by both
  surfaces — see `lib/notifications/api.ts` in New Files below.
- Clicking the bell opens a panel listing the most recent 20 notifications
  from `list_notifications`; each is clickable and navigates to the
  relevant place (territory on the map, the Trading page, `/diplomacy`, or
  the chat conversation) using a link derived from `type` + `payload`.
- Clicking one notification calls `mark_notification_read(id)` (marks only
  that one as read). A "Mark all read" button in the panel calls
  `mark_all_notifications_read()`.
- A dedicated `/notifications` page shows the full 30-day history, so a
  push notification's deep link has somewhere to land.
- **Must be mobile-friendly in portrait orientation** — the bell/panel is
  not desktop-only; the panel layout needs an explicit small-viewport
  treatment (e.g. full-width sheet rather than a fixed-width dropdown),
  matching the mobile-friendliness bar already set by other recent modules
  (e.g. the mobile-friendly territory modal).

## Web Push delivery

- **Service worker** (`public/sw.js`): listens for `push` events and shows a
  system notification carrying the notification's `id` and `type` in its
  data payload; listens for `notificationclick` and opens/focuses the app
  at the **same type+payload-derived deep link the in-app panel uses**
  (e.g. straight to the attacked territory on the map, or the relevant
  Trading/`/diplomacy`/chat page) rather than always landing on the generic
  `/notifications` list. `/notifications` remains the fallback destination
  only if a deep link can't be resolved (e.g. the target territory/offer no
  longer exists).
- **Opt-in registration**: not requested automatically on login. A
  "Enable notifications" control (e.g. in the player's profile/settings)
  triggers the browser permission prompt, registers the service worker,
  obtains a push subscription, and POSTs it to `/api/push/subscribe`, which
  upserts a row into `push_subscriptions`.
- **Sending**: a Supabase Database Webhook on `INSERT` **and** `UPDATE` of
  `notifications` calls a Vercel API route `/api/push/send` (authenticated
  via a shared secret header). Both event types are needed because
  `dm_message` notifications are an upsert (see Data Model above): the
  first message in a conversation is an `INSERT`, but subsequent messages
  refresh the same row via `UPDATE` — without listening to `UPDATE` too,
  a player would only get a push for the very first DM in a conversation
  and never any after. The route uses the `web-push` npm package with
  VAPID keys (stored as env vars) to send the push payload to every
  `push_subscriptions` row for that `player_id`.
- If a send fails with an expired/invalid-subscription error, that
  `push_subscriptions` row is deleted (no stale subscriptions accumulate).
- Sending is best-effort and fully decoupled from the game-action
  transaction — a push failure never affects the underlying attack/trade/
  diplomacy action.
- iOS Safari limitation (no reliable Web Push without "Add to Home Screen")
  is accepted as-is for this MVP; nothing special is built to work around
  it.

## Security / access control

- `notifications` and `push_subscriptions` both get RLS enabled, since the
  in-app bell subscribes to `notifications` directly over the client-side
  Supabase Realtime connection (not through a server-side proxy):
  - `notifications`: `select` policy restricted to `player_id = auth.uid()`;
    no client `insert`/`update`/`delete` policies at all — every write goes
    through the `security definer` RPCs (`list_notifications` is a `select`
    stub for read-with-pagination, `mark_notification_read` /
    `mark_all_notifications_read` are the only mutation paths, plus the
    game-action RPCs above that insert on the backend). This mirrors the
    existing pattern used for other player-scoped tables in this project.
  - `push_subscriptions`: `select`/`insert`/`update`/`delete` restricted to
    `player_id = auth.uid()`, since a player only ever needs to manage
    their own subscriptions via `/api/push/subscribe`.
  - The Realtime publication for `notifications` only needs to broadcast
    rows a player is allowed to `select` per the above policy — same
    approach already relied on by `useMyTerritoriesBattleChannel`'s
    `territories` subscription.
- `/api/push/send` is called by the Supabase Database Webhook, not by any
  browser — it authenticates via a shared secret header (an env var known
  to both Supabase's webhook config and the Vercel deployment) rather than
  a user session, since there is no logged-in user in that request context.

## Error handling

- Notification insert happens in the same transaction as the triggering
  game action — atomic, never diverges.
- Push delivery is asynchronous/best-effort; failures are logged
  server-side and never surface to or block the player's original action.
- Invalid/expired push subscriptions are pruned automatically on failed
  send.

## Testing plan

- Unit tests for `lib/notifications/api.ts` (list, mark-read, mark-all-read
  calls).
- Component tests for the bell + panel (mock the realtime hook and API,
  verify badge count, click-to-navigate, mark-read behavior, and the
  mobile/portrait layout).
- Tests for `/api/push/subscribe` and `/api/push/send` route handlers
  (mock `web-push`; verify subscription upsert and expired-subscription
  pruning).
- No new SQL-level automated tests exist in this project (migrations are
  verified via manual `.verification.sql` checklists and direct live
  queries per established convention) — same pattern continues here.

## New files

- `supabase/migrations/0055_notifications.sql` — tables (with RLS policies),
  RPCs (`list_notifications`, `get_unread_notification_count`,
  `mark_notification_read`, `mark_all_notifications_read`), and the
  additional inserts wired into the existing RPCs listed above.
- `lib/notifications/types.ts`, `lib/notifications/api.ts`,
  `lib/notifications/useNotificationsChannel.ts`
- `components/notifications/NotificationBell.tsx`,
  `components/notifications/NotificationPanel.tsx`
- `app/notifications/page.tsx`
- `public/sw.js`
- `app/api/push/subscribe/route.ts`, `app/api/push/send/route.ts`
- `lib/push/` — small server-side wrapper around `web-push` + VAPID key
  handling

## Out of scope (explicitly deferred)

- Email notifications.
- iOS Web Push workarounds.
- Per-event-type user preferences/toggles (e.g. "mute trade offers") — can
  be added later if requested.
