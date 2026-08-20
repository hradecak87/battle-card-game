# Chat (Global + Direct Messages) — Design Spec

Date: 2026-08-20
Status: Approved by user, pending implementation plan

## Summary

Add a chat system with two channel types:
1. **Global channel** — single shared room, all players.
2. **Direct messages (DM)** — 1:1 conversations between any two players.

No faction/kingdom-scoped chat in this iteration. Delivery via polling
(consistent with the rest of the app — map, world feed), not Supabase
Realtime/websockets.

## Data Model

### `chat_messages`
| column | type | notes |
|---|---|---|
| id | bigint identity PK | |
| sender_id | uuid, FK players | |
| channel_type | text, `'global'` \| `'dm'` | |
| conversation_id | uuid, nullable | null for global; deterministic id for DM (see below) |
| recipient_id | uuid, nullable, FK players | null for global; the other DM participant |
| body | text | max 500 chars, enforced client + server |
| created_at | timestamptz default now() | |
| deleted_at | timestamptz, nullable | admin soft-delete |
| deleted_by | uuid, nullable, FK players | admin who deleted it |

Constraint: `channel_type = 'global'` → `conversation_id`/`recipient_id` NULL.
`channel_type = 'dm'` → both NOT NULL.

**Conversation id generation for DM**: deterministic from the two participant
ids so both sides resolve to the same conversation regardless of who
initiated: `conversation_id = md5(least(sender,recipient)::text || greatest(sender,recipient)::text)::uuid`
(computed inside `chat_send_message`, never chosen by the client).

### `chat_blocks`
| column | type | notes |
|---|---|---|
| blocker_id | uuid, FK players | |
| blocked_id | uuid, FK players | |
| created_at | timestamptz default now() | |

PK `(blocker_id, blocked_id)`.

### `chat_read_state`
| column | type | notes |
|---|---|---|
| player_id | uuid, FK players | |
| conversation_id | uuid | |
| last_read_at | timestamptz | |

PK `(player_id, conversation_id)`. Used to compute unread counts for the DM
conversation list. Global channel unread tracking is out of scope for MVP
(only DM gets unread badges) — global just shows new messages as they poll in.

### Indexes
- `chat_messages (channel_type, created_at desc)` for global feed.
- `chat_messages (conversation_id, created_at desc)` for DM feed.
- `chat_messages (sender_id, created_at desc)` for rate-limit lookup.

### RLS
- `chat_messages`: enable RLS, no direct client insert/update/delete (writes
  only via `security definer` RPCs). Select policy: global messages visible
  to all authenticated players; DM messages visible only to
  `sender_id = auth.uid() OR recipient_id = auth.uid()`, and only when not
  soft-deleted (`deleted_at IS NULL`) unless the viewer is the sender (senders
  can still see their own deleted message showed as "message removed",
  handled client-side by checking `deleted_at`).
- `chat_blocks`, `chat_read_state`: RLS enabled, players can only see/manage
  their own rows (`blocker_id = auth.uid()` / `player_id = auth.uid()`).
- All tables: `revoke all from public, anon`; RPCs `grant execute to authenticated`.

## Backend RPCs

All `security definer`, validate `auth.uid()` is a valid player, follow
existing project conventions (see `world_events` RPCs from the
world-activity-feed feature for the pagination/RLS pattern to reuse).

- **`chat_send_message(p_channel_type text, p_recipient_id uuid, p_body text) returns chat_messages`**
  - Validate `p_body` length (1–500 chars after trim), reject empty.
  - Rate limit: reject if sender has a message with `created_at > now() - interval '2 seconds'` (any channel), with a clear error code the client maps to "wait Ns".
  - For `dm`: validate `p_recipient_id` is a real player, not self; check
    neither direction is blocked (`chat_blocks` where `blocker_id =
    p_recipient_id and blocked_id = auth.uid()` → reject "you are blocked by
    this player"; the reverse direction is allowed to send is a UX choice —
    **decision: if the sender has blocked the recipient, sending is also
    blocked**, since a player who blocked someone shouldn't message them
    either without unblocking first). Compute `conversation_id` server-side.
  - For `global`: `conversation_id`/`recipient_id` left NULL.
  - Insert and return the row.

- **`chat_list_global_messages(p_before_id bigint default null, p_limit int default 30)`**
  - Returns up to `p_limit` (clamped to max 100) messages with
    `channel_type = 'global' and deleted_at is null`, ordered
    `created_at desc`, keyset-paginated via `id < p_before_id` when provided.
  - Client reverses order for display (oldest at top).

- **`chat_list_conversations()`**
  - For the calling player: distinct `conversation_id`s they participate in,
    each with the other participant's id/name, the last message body +
    timestamp, and unread count (`count(*) where created_at >
    coalesce(chat_read_state.last_read_at, '-infinity')`).
  - Ordered by last message time desc.

- **`chat_list_dm_messages(p_conversation_id uuid, p_before_id bigint default null, p_limit int default 30)`**
  - Validates the caller is a participant (`sender_id = auth.uid() or
    recipient_id = auth.uid()` on at least one row, or derive expected
    participants from the conversation id — simplest: check at least one
    existing message row in that conversation has the caller as
    sender/recipient; if none exists yet, return empty rather than erroring).
  - Same keyset pagination as global.

- **`chat_mark_read(p_conversation_id uuid)`**
  - Upserts `chat_read_state(player_id=auth.uid(), conversation_id,
    last_read_at=now())`.

- **`chat_block_player(p_target_id uuid)` / `chat_unblock_player(p_target_id uuid)`**
  - Insert/delete row in `chat_blocks` for `auth.uid()` → `p_target_id`.
  - Blocking does not delete message history, only prevents future sends (see
    `chat_send_message` above) and hides the blocked player's messages from
    the blocker's UI (client-side filter, since DM history should stay
    intact for the other party/admin visibility).

- **`admin_list_chat_messages(...)` / `admin_delete_chat_message(p_message_id bigint)`**
  - Reuse the existing `admin_require_admin()` guard pattern from the admin
    dashboard RPCs. Soft-delete only (`deleted_at = now(), deleted_by =
    auth.uid()`), never hard delete.

## Frontend

- **`/chat` page** (new nav entry) — two tabs: "Globální" / "Zprávy".
  - Globální: message list + input, polling every 4s while tab is active/visible.
  - Zprávy: conversation list → tap opens a conversation detail view (message
    list + input), same polling cadence. On mobile portrait, the conversation
    list and detail view are separate full-width screens (not side-by-side),
    with a back button from detail → list.
- **Floating widget**, present on all pages (desktop: bottom-right bubble with
  unread badge; collapses to the last-open channel). On mobile portrait, tapping
  the bubble opens a **fullscreen overlay** (not a small popup) with a
  top-left close ("X"), bottom tab bar for Global/Messages with large tap
  targets, and the message input pinned above the on-screen keyboard (sticky
  bottom, safe-area aware).
- Client enforces the 500-char limit in the input (counter) and disables send
  during the server's rate-limit cooldown countdown (based on the last
  successful send timestamp).
- Sender name in both global and DM views links to the player's profile.
- Block/unblock action available from a message's context menu and from the
  player profile page.
- Polling pauses when the widget/page is not visible (use
  `document.visibilityState` or existing app convention if one exists) to
  avoid unnecessary load.

## Testing & Done Criteria

- RPC unit tests: rate-limit enforcement, block enforcement (both
  directions), RLS isolation (a player cannot read another player's DM
  conversation, cannot mark another player's read-state), keyset pagination
  correctness, admin soft-delete hides message from normal queries but is
  auditable.
- Component tests: widget open/close, unread badge updates, mobile-portrait
  layout (viewport-based test) for both the page and the widget overlay,
  send/blocked-send flow, rate-limit cooldown UI.
- Done when: both channels functional end-to-end against the live DB, block
  is enforced server-side in both directions, rate-limit is enforced
  server-side (not just client-side UX), mobile-portrait UX verified
  (fullscreen overlay, sticky input, tab bar), full suite (`jest`, `tsc`)
  green.

## Out of Scope (this iteration)

- Faction/kingdom-scoped chat channels.
- True realtime delivery (websockets/Supabase Realtime) — polling only.
- Rich content (images, emoji picker, markdown) — plain text only.
- Message editing (only delete, admin-only, soft).
- Global-channel unread tracking / read receipts.
