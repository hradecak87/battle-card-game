# Notifications Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, player-scoped notifications system (in-app bell +
panel + full-history page, plus opt-in Web Push) covering attacks, battle
results, territory loss, war declarations, trade offers, peace offers,
level-ups, and DMs.

**Architecture:** One new Postgres table (`notifications`) with RLS, written
to by existing game-action RPCs in the same transaction as their current
`world_events` insert; a second table (`push_subscriptions`) for opt-in Web
Push endpoints. In-app delivery reuses the existing `postgres_changes`
realtime-hook pattern (`useMyTerritoriesBattleChannel`). Web Push uses a
Supabase Database Webhook → Vercel API route → `web-push` + VAPID, fully
decoupled/best-effort from the game-action transaction.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase Postgres +
Realtime + RLS, `web-push` npm package, Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-20-notifications-design.md` (read
this first — it has the full rationale, event-type table, and the exact RPC
names below).

---

## Chunk 1: Database schema + event wiring

**Files:**
- Create: `supabase/migrations/0055_notifications.sql`
- Create: `supabase/migrations/0055_notifications.verification.sql` (follow
  the existing `.verification.sql` convention used by every prior migration
  — manual checklist of `select` queries proving the schema/RPCs work,
  since this project has no automated SQL test runner)
- Modify (add one notification insert to the existing logic, alongside the
  existing `world_events` insert — do **not** remove or alter the
  `world_events` insert):
  - `supabase/migrations/0045_diplomacy_war_creation.sql` — `_declare_attack_core` (`attack_incoming` to territory's current owner; `war_declared` to both players if a new war relation is created)
  - `supabase/migrations/0047_wall_structure_card.sql` — `_finalize_battle_base_0025` (`battle_resolved` to attacker + defender; `territory_lost` to defeated defender on capture)
  - `supabase/migrations/0014_trading_exchange.sql` — `create_trade_offer` (`trade_offer_received`), `respond_to_public_offer` (`trade_offer_accepted`/`trade_offer_rejected` branch), `reject_trade_offer` (`trade_offer_rejected`)
  - `supabase/migrations/0030_wire_card_limit.sql` — `accept_trade_offer` (this is the last redefinition of `accept_trade_offer`, not the one in 0014 — confirm with `grep -n "create or replace function accept_trade_offer" supabase/migrations/*.sql` before editing, since only the highest-numbered definition is live)
  - `supabase/migrations/0050_npc_diplomacy.sql` — `_diplomacy_propose_peace_core` (`peace_offer_received`; this is the real logic, `diplomacy_propose_peace` in `0046_diplomacy_rpcs.sql` is just a thin wrapper superseded by 0050 — verify with the same grep pattern before editing)
  - `supabase/migrations/0047_wall_structure_card.sql` — `_award_xp` (`level_up`, only when computed level actually increases — compare old vs new level, don't fire on every XP gain)
  - `supabase/migrations/0041_chat_rpcs.sql` — `chat_send_message` (`dm_message`, DM branch only — skip for global chat; upsert keyed on `(player_id, type, (payload->>'conversation_id'))`)

- [ ] **Step 1: Confirm the true "source of truth" file for every function above**

  Several of these functions have been redefined multiple times across
  migrations (Postgres `create or replace function` means only the
  *highest-numbered migration file* defining a given function name is what
  actually runs live). Before editing anything, run:

  ```powershell
  cd "C:\Users\z0040m9d\Documents\Projects\Battle card game V2"
  Select-String -Path supabase\migrations\*.sql -Pattern "create or replace function (_declare_attack_core|_finalize_battle_base_0025|create_trade_offer|respond_to_public_offer|accept_trade_offer|reject_trade_offer|_diplomacy_propose_peace_core|_award_xp|chat_send_message)\(" | Sort-Object Path
  ```

  For each function, edit only the file with the **highest migration
  number** among the matches (this plan's file list above already reflects
  this as of 2026-08-20, but migrations may have been added since — always
  re-verify). Also run `select pg_get_functiondef('_award_xp'::regproc);`
  (etc.) against the live DB to double check the live body matches what you
  expect to edit before making changes.

- [ ] **Step 2: Write `0055_notifications.sql`**

  Contents (in order):
  1. `create table notifications (id bigserial primary key, player_id uuid
     not null references players(id), type text not null check (type in
     ('attack_incoming','war_declared','battle_resolved','territory_lost',
     'trade_offer_received','trade_offer_accepted','trade_offer_rejected',
     'peace_offer_received','level_up','dm_message')), payload jsonb not
     null default '{}'::jsonb, is_read boolean not null default false,
     created_at timestamptz not null default now());`
  2. `create index notifications_player_created_idx on notifications
     (player_id, created_at desc);`
  3. `create index notifications_player_unread_idx on notifications
     (player_id, is_read) where is_read = false;`
  4. `create unique index notifications_dm_conversation_idx on
     notifications (player_id, type, (payload->>'conversation_id')) where
     type = 'dm_message';` — backs the DM upsert.
  5. `create table push_subscriptions (id bigserial primary key, player_id
     uuid not null references players(id), endpoint text not null unique,
     p256dh text not null, auth text not null, created_at timestamptz not
     null default now());`
  6. `alter table notifications enable row level security;` +
     `alter table push_subscriptions enable row level security;`
  7. RLS policies exactly as specified in the spec's "Security / access
     control" section:
     - `notifications`: one `select` policy, `player_id = auth.uid()`. No
       insert/update/delete client policies (writes only via
       `security definer` RPCs below).
     - `push_subscriptions`: `select`/`insert`/`update`/`delete` policies,
       all `player_id = auth.uid()`.
  8. RPCs (all `security definer`, all requiring an authenticated
     `players` row — follow the `chat_require_player()` /
     `diplomacy_require_player()` pattern already used in this codebase for
     the "who is calling" boilerplate):
     - `get_unread_notification_count() returns integer` — `select
       count(*) from notifications where player_id = v_player_id and
       is_read = false`.
     - `list_notifications(p_limit integer default 20, p_before_id bigint
       default null) returns setof notifications` — `where player_id =
       v_player_id and (p_before_id is null or id < p_before_id) order by
       id desc limit p_limit`.
     - `mark_notification_read(p_id bigint) returns void` — `update
       notifications set is_read = true where id = p_id and player_id =
       v_player_id`.
     - `mark_all_notifications_read() returns void` — `update
       notifications set is_read = true where player_id = v_player_id and
       is_read = false`.
     - A small internal helper `_notify(p_player_id uuid, p_type text,
       p_payload jsonb) returns void` that does a plain insert, EXCEPT
       when `p_type = 'dm_message'`, in which case it does `insert ...
       on conflict (player_id, type, (payload->>'conversation_id')) where
       type = 'dm_message' do update set created_at = now(), is_read =
       false, payload = excluded.payload`. Every call site in Step 3 calls
       this helper — don't duplicate the insert/upsert logic 9 times.
  9. Retention: append one statement to the **existing** body of
     `resolve_due_movements()` (in `0050_npc_diplomacy.sql` — this is the
     current source of truth per the grep above) — `delete from
     notifications where created_at < now() - interval '30 days';` — this
     means `0055_notifications.sql` must `create or replace function
     resolve_due_movements()` with the *entire* existing body plus this one
     new line, not just the new line alone. Copy the existing body
     verbatim from the live DB (`select pg_get_functiondef
     ('resolve_due_movements'::regproc);`) as your starting point to avoid
     accidentally dropping unrelated logic.

- [ ] **Step 3: Add the `_notify(...)` call to each of the 8 modified
  functions**

  For each function listed in Step 1/the Files section, `create or
  replace` it with its existing full body plus one new `perform
  _notify(...)` call placed right after (never before — the game action
  must have already succeeded/committed-within-transaction) its existing
  `insert into world_events` call. Pull each function's current live body
  via `select pg_get_functiondef('<name>'::regproc);` first, then add the
  new line — do not hand-retype the whole function from the migration
  file, since it may have drifted from later migrations.

  Payload shape per type (used later by the panel's click-through link and
  push deep-link — keep these keys stable, the UI in Chunk 3 depends on
  them):
  - `attack_incoming` / `territory_lost`: `{ "territory_id": ..., "x": ...,
    "y": ..., "other_player_id": ..., "other_display_name": ... }`
  - `war_declared`: `{ "other_player_id": ..., "other_display_name": ... }`
  - `battle_resolved`: `{ "territory_id": ..., "x": ..., "y": ...,
    "outcome": "won"|"lost", "other_player_id": ... }`
  - `trade_offer_received` / `trade_offer_accepted` / `trade_offer_rejected`:
    `{ "offer_id": ..., "other_player_id": ..., "other_display_name": ... }`
  - `peace_offer_received`: `{ "offer_id": ..., "other_player_id": ...,
    "other_display_name": ... }`
  - `level_up`: `{ "new_level": ... }`
  - `dm_message`: `{ "conversation_id": ..., "other_player_id": ...,
    "other_display_name": ... }`

- [ ] **Step 4: Write `0055_notifications.verification.sql`**

  Manual checklist (follow the format of e.g.
  `0050_npc_diplomacy.verification.sql`): create a test notification for a
  known player, confirm `get_unread_notification_count()` reflects it,
  confirm `list_notifications()` returns it, confirm
  `mark_notification_read`/`mark_all_notifications_read` flip `is_read`,
  confirm the DM upsert collapses two inserts with the same
  `conversation_id` into one row with a bumped `created_at`, confirm a
  `select` from another player's session (or via `set role`) is blocked by
  RLS.

- [ ] **Step 5: Apply the migration live and run the verification checklist**

  Apply `0055_notifications.sql` against the live Supabase DB the same way
  prior migrations in this project were applied (see recent session history
  for the exact `psql`/Supabase CLI invocation used for 0053/0054). Run
  through `0055_notifications.verification.sql` manually and confirm every
  check passes.

- [ ] **Step 6: Run the full test suite + `tsc --noEmit`**

  ```powershell
  cd "C:\Users\z0040m9d\Documents\Projects\Battle card game V2"
  npm test
  npx tsc --noEmit
  ```

  Expected: all existing suites still pass (no SQL-level test regressions
  expected since this only adds new tables/functions and appends to
  existing function bodies without changing their existing return
  contracts).

- [ ] **Step 7: Commit**

  ```bash
  git add supabase/migrations/0055_notifications.sql supabase/migrations/0055_notifications.verification.sql
  git commit -m "feat: add notifications table, RPCs, and event wiring for 9 event types"
  ```

---

## Chunk 2: `lib/notifications` client + push helper library

**Files:**
- Create: `lib/notifications/types.ts`
- Create: `lib/notifications/api.ts`
- Create: `lib/notifications/useNotificationsChannel.ts`
- Create: `lib/notifications/deepLink.ts`
- Test: `lib/notifications/api.test.ts`
- Test: `lib/notifications/deepLink.test.ts`

- [ ] **Step 1: `lib/notifications/types.ts`**

  Define `NotificationType` (the 9-value union matching the DB check
  constraint) and a `NotificationRow` interface (`id`, `player_id`, `type`,
  `payload: Record<string, unknown>`, `is_read`, `created_at`) plus a
  typed `payload` shape per type (mirror the Step 3 payload shapes from
  Chunk 1 as discriminated-union interfaces keyed on `type`).

- [ ] **Step 2: Write failing tests for `lib/notifications/deepLink.ts`**

  ```typescript
  // lib/notifications/deepLink.test.ts
  import { getDeepLink } from './deepLink'

  describe('getDeepLink', () => {
    it('links attack_incoming to the map centered on the territory', () => {
      const link = getDeepLink({
        type: 'attack_incoming',
        payload: { territory_id: 1, x: 4, y: 167 },
      } as any)
      expect(link).toBe('/map?x=4&y=167')
    })

    it('links dm_message to the chat conversation', () => {
      const link = getDeepLink({
        type: 'dm_message',
        payload: { conversation_id: 'abc' },
      } as any)
      expect(link).toBe('/chat?conversation=abc')
    })

    it('falls back to /notifications for an unrecognized shape', () => {
      const link = getDeepLink({ type: 'level_up', payload: {} } as any)
      expect(link).toBe('/notifications')
    })
  })
  ```

  Adjust the exact URL query-param conventions to match whatever the map
  page (`app/map/page.tsx` or equivalent) and chat page
  (`app/chat/page.tsx` or equivalent) actually accept — check those pages'
  existing `useSearchParams`/route usage first and mirror it exactly rather
  than inventing new query params.

- [ ] **Step 2b: Run it, confirm it fails** (module doesn't exist yet)

- [ ] **Step 3: Implement `lib/notifications/deepLink.ts`**

  One function, `getDeepLink(n: NotificationRow): string`, a switch over
  `n.type` building the URL from `n.payload`, with a `default:` returning
  `/notifications`. Reused by both the in-app panel (Chunk 3) and the
  service worker (Chunk 4 — note `public/sw.js` can't `import` this file
  since service workers aren't bundled the same way; keep the switch logic
  simple enough to duplicate in plain JS in `sw.js`, or check if this
  project's build already bundles `public/sw.js` through anything — if not,
  duplicate the logic in Chunk 4 with a comment pointing back here).

- [ ] **Step 4: Run tests, confirm pass**

- [ ] **Step 5: Write failing tests for `lib/notifications/api.ts`**

  Mirror the existing test style in e.g. `lib/chat/api.test.ts` or
  `lib/trading/api.test.ts` (mock the Supabase client's `.rpc()` calls).
  Cover: `listNotifications`, `getUnreadCount`, `markRead`, `markAllRead` —
  each just thin wrappers calling the corresponding RPC by name and
  throwing/returning per the project's existing `lib/*/api.ts` error
  conventions.

- [ ] **Step 6: Run it, confirm it fails**

- [ ] **Step 7: Implement `lib/notifications/api.ts`**

- [ ] **Step 8: Run tests, confirm pass**

- [ ] **Step 9: Implement `lib/notifications/useNotificationsChannel.ts`**

  Copy the structure of `lib/battles/useMyTerritoriesBattleChannel.ts`
  almost exactly: subscribe to `postgres_changes` on `notifications`
  filtered by `player_id=eq.<current user id>` for both `INSERT` and
  `UPDATE`, and expose `{ unreadCount, notifications, refresh() }` to
  consumers, calling `listNotifications`/`getUnreadCount` from Step 7 for
  the initial load per the spec's initial-load contract. No new test file
  strictly required if `useMyTerritoriesBattleChannel` itself has no
  dedicated unit test (check first — if it does, mirror it).

- [ ] **Step 10: Commit**

  ```bash
  git add lib/notifications
  git commit -m "feat: add notifications client library (api, types, realtime hook, deep links)"
  ```

---

## Chunk 3: In-app UI (bell, panel, full-history page)

**Files:**
- Create: `components/notifications/NotificationBell.tsx`
- Create: `components/notifications/NotificationPanel.tsx`
- Create: `app/notifications/page.tsx`
- Test: `components/notifications/NotificationBell.test.tsx`
- Test: `components/notifications/NotificationPanel.test.tsx`
- Modify: the root layout file that currently mounts `<AuthStatusBar />`
  (find it via `grep -rn "AuthStatusBar" app/`) — mount `<NotificationBell
  />` next to it.

- [ ] **Step 1: Write failing tests for `NotificationBell`**

  Mock `useNotificationsChannel` (Chunk 2). Assert: badge shows the
  `unreadCount` number when > 0, no badge when 0, clicking the bell toggles
  the panel open/closed. Mirror the existing test conventions in
  `components/players/AuthStatusBar.test.tsx` if it exists, or another
  small component test in this repo for style.

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `NotificationBell.tsx`**

  A button with a bell icon + badge, positioned to sit inline with
  `AuthStatusBar` (check its exact styling — `bg-zinc-900`, `text-xs` —
  and match visually). Toggles `NotificationPanel` open/closed on click.

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Write failing tests for `NotificationPanel`**

  Assert: renders a list from `notifications`, each item's text depends on
  `type` (write a small per-type label function inline or in
  `lib/notifications/types.ts` — e.g. "Nový útok na tvé území",
  "Obchodní nabídka přijata" — Czech, matching this project's existing UI
  language), clicking an item calls `markRead(id)` and navigates via
  `getDeepLink`, "Mark all read" button calls `markAllRead()`, and on a
  narrow/mobile viewport (`window.matchMedia` or a CSS-class-based check —
  follow whatever pattern this repo already uses elsewhere for
  mobile-responsive components) it renders as a full-width sheet rather
  than a small dropdown.

- [ ] **Step 6: Run, confirm fail**

- [ ] **Step 7: Implement `NotificationPanel.tsx`**

- [ ] **Step 8: Run, confirm pass**

- [ ] **Step 9: Implement `app/notifications/page.tsx`**

  Full-history page: paginated list using `listNotifications(limit,
  before_id)` with a "load more" control, same per-type label/click-through
  logic as the panel (extract the shared label-rendering into a small
  helper in `lib/notifications/` if it's identical, to avoid duplicating it
  between panel and page — DRY).

- [ ] **Step 10: Manually verify mobile/portrait layout**

  Run `npm run dev`, open the app in a narrow browser viewport (or browser
  devtools device emulation) and confirm the panel is usable in portrait
  orientation, per the spec's explicit mobile-friendliness requirement.

- [ ] **Step 11: Run full test suite + `tsc --noEmit`**

- [ ] **Step 12: Commit**

  ```bash
  git add components/notifications app/notifications app/layout.tsx
  git commit -m "feat: add notification bell, panel, and full-history page"
  ```

---

## Chunk 4: Web Push (service worker, subscribe/send API routes, opt-in UI)

**Files:**
- Modify: `package.json` (add `web-push` dependency + `@types/web-push` dev
  dependency)
- Create: `public/sw.js`
- Create: `lib/push/vapid.ts` (env var access + key pair helper)
- Create: `lib/push/sendPush.ts` (thin wrapper around `web-push.sendNotification`)
- Create: `app/api/push/subscribe/route.ts`
- Create: `app/api/push/send/route.ts`
- Create: a small opt-in UI control (e.g. in the player's profile/settings
  page — find via `grep -rn "profile" app/ --include=*.tsx -l` and add a
  "Povolit oznámení" button there, following that page's existing style)
- Test: `app/api/push/subscribe/route.test.ts`
- Test: `app/api/push/send/route.test.ts`

- [ ] **Step 1: Install dependencies**

  ```powershell
  cd "C:\Users\z0040m9d\Documents\Projects\Battle card game V2"
  npm install web-push
  npm install -D @types/web-push
  ```

- [ ] **Step 2: Generate VAPID keys and document env vars**

  ```powershell
  npx web-push generate-vapid-keys
  ```

  Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:`
  contact) to `.env.local` (and to Vercel's project env vars — flag this to
  the user, since only they can set Vercel production env vars) and a
  `PUSH_WEBHOOK_SECRET` (a random string shared between the Supabase
  Database Webhook config and `/api/push/send`'s auth check).

- [ ] **Step 3: Write `public/sw.js`**

  Plain JS (no bundler/import), roughly:

  ```javascript
  self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {}
    event.waitUntil(
      self.registration.showNotification(data.title || 'Battle Card Game', {
        body: data.body || '',
        data: { type: data.type, payload: data.payload },
      })
    )
  })

  self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const url = getDeepLinkForServiceWorker(event.notification.data)
    event.waitUntil(clients.openWindow(url))
  })

  function getDeepLinkForServiceWorker(data) {
    // Mirrors lib/notifications/deepLink.ts's switch — kept duplicated
    // here in plain JS since service workers can't import TS modules from
    // this project's build. If the two ever diverge, deepLink.test.ts is
    // the source of truth to re-sync against.
    if (!data) return '/notifications'
    switch (data.type) {
      case 'attack_incoming':
      case 'territory_lost':
      case 'battle_resolved':
        return `/map?x=${data.payload.x}&y=${data.payload.y}`
      case 'dm_message':
        return `/chat?conversation=${data.payload.conversation_id}`
      // ...remaining cases mirroring deepLink.ts
      default:
        return '/notifications'
    }
  }
  ```

  Fill in every case from `lib/notifications/deepLink.ts` (Chunk 2) exactly
  — do not let this drift; add a code comment in `deepLink.ts` pointing
  back to `public/sw.js` as a reminder.

- [ ] **Step 4: Write failing test for `/api/push/subscribe`**

  Mirror an existing `app/api/*/route.test.ts` in this repo for
  conventions (mock the Supabase server client). Assert: POSTing a valid
  `{ endpoint, keys: { p256dh, auth } }` upserts a `push_subscriptions` row
  for the authenticated player; missing auth → 401.

- [ ] **Step 5: Run, confirm fail; implement route; run, confirm pass**

- [ ] **Step 6: Write failing test for `/api/push/send`**

  Assert: request without the correct `PUSH_WEBHOOK_SECRET` header → 401;
  a valid webhook payload (mock a Supabase DB Webhook `INSERT`/`UPDATE`
  payload shape for a `notifications` row) triggers `sendPush` once per
  matching `push_subscriptions` row for that `player_id`; a send that
  throws a "subscription expired" error (410/404 per `web-push`
  conventions) deletes that `push_subscriptions` row; other rows are
  unaffected.

- [ ] **Step 7: Run, confirm fail; implement route + `lib/push/sendPush.ts`
  + `lib/push/vapid.ts`; run, confirm pass**

- [ ] **Step 8: Implement the opt-in UI control**

  A button that: requests `Notification.requestPermission()`, registers
  `public/sw.js` via `navigator.serviceWorker.register`, calls
  `registration.pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey: <VAPID public key> })`, and POSTs the resulting
  subscription to `/api/push/subscribe`. Handle and surface the
  "permission denied" and "unsupported browser" cases with a simple
  message rather than crashing.

- [ ] **Step 9: Configure the Supabase Database Webhook**

  This step cannot be done by an agent running only within this repo — it
  requires the Supabase dashboard (or `supabase` CLI with project access).
  Document the exact configuration needed in this plan's own commit
  message or a short paragraph in the PROGRESS.md update (Chunk 5): a
  Database Webhook on `notifications`, events `INSERT` and `UPDATE`, HTTP
  POST to `https://<deployed-domain>/api/push/send`, with an `Authorization`
  (or custom) header carrying `PUSH_WEBHOOK_SECRET`. Flag this to the user
  as a manual step they (or whoever has dashboard access) must complete —
  do not mark this task done until confirmed configured.

- [ ] **Step 10: Manual end-to-end smoke test**

  With the webhook configured against a deployed/staging environment:
  enable notifications in the opt-in UI on an Android/Chrome device,
  trigger any of the 9 event types (e.g. have a second test account send a
  trade offer), confirm a system push notification appears, and confirm
  tapping it opens the app at the correct deep link.

- [ ] **Step 11: Run full test suite + `tsc --noEmit`**

- [ ] **Step 12: Commit**

  ```bash
  git add package.json package-lock.json public/sw.js lib/push app/api/push
  git commit -m "feat: add Web Push subscribe/send routes, service worker, and opt-in UI"
  ```

---

## Chunk 5: Documentation

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Add a dated entry** summarizing the notifications module
  shipped (all 4 chunks), noting the one manual step (Supabase Database
  Webhook configuration) if not yet completed by the user, and updating
  the `notifications-module` backlog item status.

- [ ] **Step 2: Commit**

  ```bash
  git add docs/superpowers/PROGRESS.md
  git commit -m "docs: update PROGRESS.md for notifications module"
  ```
