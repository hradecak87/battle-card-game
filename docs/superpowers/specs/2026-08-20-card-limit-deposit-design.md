# Card limit + deposit design (backlog #27)

Date: 2026-08-20

## Goal

Introduce a per-player card collection limit that scales with XP level, plus
a "deposit" overflow mechanism (with expiry) and a manual "return card to
central pool" action, so the collection can't grow unbounded while still
letting players occasionally exceed the limit briefly (e.g. via battle
capture) without losing the card outright.

## Formulas

- `deck_limit(level) = 80 + 10 * (level - 1)` (level 1 → 80, level 10 → 170,
  level 20 → 270, level 30 → 370). No upper cap — level-up XP cost already
  grows quadratically (`xpRequiredForLevel` in `lib/players/leveling.ts`), so
  very high levels are naturally rare and slow to reach.
- `deposit_limit(level) = floor(deck_limit(level) / 2)` (level 1 → 40,
  level 10 → 85).
- Both formulas live once, server-side, as SQL helper functions
  `_deck_limit(p_level int)` / `_deposit_limit(p_level int)` (mirroring the
  existing `_max_card_uses()` / `_min_group_speed()` single-source-of-truth
  pattern), and are re-derived in the client (`lib/players/cardLimit.ts`) for
  display purposes only — enforcement is always server-side.
- Level is derived from `players.xp` via the existing `levelForXp()`
  (`lib/players/leveling.ts`), same as everywhere else in the app.

## Scope of the limit

- Counts toward `deck_limit`: `card_instances` rows owned by the player with
  `status in ('stationed', 'in_transit')`.
- Does **not** count toward `deck_limit`: rows with `status = 'deposit'`
  (counted against the separate, smaller `deposit_limit` instead).
- Existing players who already exceed the new `deck_limit` at rollout are
  **grandfathered**: no retroactive migration of their excess cards into the
  deposit. They simply can't acquire further cards (beyond the deposit
  overflow rules below) until their count drops back under the limit.

## Data model changes

- `card_instances.status` check constraint gains a third allowed value:
  `'deposit'` (alongside existing `'stationed'`, `'in_transit'`).
- New column `card_instances.deposit_expires_at timestamptz null` — set only
  when `status = 'deposit'`; `now() + interval '3 days'` at the moment a
  card enters deposit.
- New table `card_return_log`:
  ```sql
  create table card_return_log (
    id uuid primary key default gen_random_uuid(),
    player_id uuid not null references players(id),
    template_id text not null references card_templates(id),
    rank text not null,
    reason text not null check (reason in ('deposit_expired', 'deposit_overflow', 'manual_return')),
    returned_at timestamptz not null default now()
  );
  ```
  Only written for `rare`/`epic`/`legend` cards being burned/recycled
  (common/uncommon are just deleted, no log row). Purely for future
  auditing/reward-pool ideas — nothing reads from it yet (YAGNI).

## Card acquisition flow (overflow handling)

A new shared SQL helper, `_deposit_or_grant_card(p_player_id uuid, p_instance_id uuid)`,
centralizes the "does this player have room?" check and is called from every
place a card instance's `owner_id` changes to the player (rather than each
call site reimplementing the same branching). It **first calls
`_expire_deposit(p_player_id)`** (same transaction) so a stale expired
deposit row can never falsely count against capacity right before a new
grant, then:

1. If player's `stationed`/`in_transit` count `< deck_limit(level)` → normal
   grant, `status = 'stationed'` (or whatever the caller needs), no change
   in existing behavior.
2. Else if player's `deposit` count `< deposit_limit(level)` → card goes to
   `status = 'deposit'`, `deposit_expires_at = now() + 3 days`.
3. Else (both full) → card is immediately burned/recycled per the rank rule
   below (`reason = 'deposit_overflow'`); the player never receives it.

**Important**: this codebase's convention is that several of these
functions get *redefined* (via `create or replace function`) across later
migrations as unrelated features are added. Implementation must patch the
**current, latest live definition** of each function (found by checking
which migration most recently redefines it), not the migration file where
it was first introduced. As of this spec being written, the relevant
ownership-changing call sites are:
- Battle-round card capture: `update card_instances set owner_id = ...`
  inside `_resolve_round`, latest defined in `0026_boost_cards.sql`
  (**not** `_finalize_battle` — that function only inserts *new* structure
  reward card instances, it doesn't handle capture).
- Level-up card grants: `insert into card_instances (...)` inside
  `_award_xp`, latest defined in `0026_boost_cards.sql` (**not**
  `claim_daily_reward` in `0013_level_up_cards.sql` — verify at
  implementation time which function currently issues the daily-login
  common/uncommon grant vs. the level-up grant, and route each through the
  helper).
- Structure/battle-reward card grants: `insert into card_instances (...)`
  inside `_finalize_battle`, latest defined in `0026_boost_cards.sql`.
- `accept_trade_offer` (`0014_trading_exchange.sql`, confirm no later
  redefinition exists) — trade acceptance. Since a trade offer exchanges
  cards **both ways** in one call, apply both ownership transfers first,
  then run the capacity check per recipient on their *net* resulting count
  (not per-card mid-transfer) so a player trading away 3 cards to receive 3
  doesn't get incorrectly routed to deposit for a net-zero swap.
- `admin_grant_card` (`0012_admin_dashboard.sql`) is explicitly **exempt**
  (admin override tool, unaffected by this feature).

Implementation should grep the live migrations directory for every
`update card_instances set owner_id` / `insert into card_instances` at
start of work to confirm this list is complete and current (new features
may have added more call sites since this spec was written).

## Expiry + manual return (burn vs. recycle)

Both paths share one rule and one helper, `_return_card(p_instance_id uuid, p_reason text)`:
- `common` / `uncommon` → delete the `card_instances` row. No log entry.
- `rare` / `epic` / `legend` → delete the `card_instances` row, insert one
  `card_return_log` row (`reason` = whichever caller passed in).

Two ways this helper gets called:

1. **Lazy expiry**: new helper `_expire_deposit(p_player_id uuid)` — deletes
   (via `_return_card(..., 'deposit_expired')`) any of that player's
   deposit cards past `deposit_expires_at`. Called at the top of:
   - `get_my_card_instances` (collection page read RPC), and
   - the RPC(s) backing session/player-profile load on login.
   No cron job; consistent with the rest of the app's lazy-resolution
   pattern (`resolve_due_movements`, `_recompute_card_supply`, etc.) — see
   "Future automation" note below.
2. **Manual return**: new RPC `return_card_to_pool(p_instance_id uuid)` —
   validates caller owns the instance and it is not `in_transit` nor
   currently used in an active battle, then calls
   `_return_card(p_instance_id, 'manual_return')`.

## Withdrawing a card from deposit

A deposit card must be recoverable once deck space frees up — otherwise it
is guaranteed to eventually expire even after the player makes room, which
defeats the purpose of the deposit (it should give players a *chance* to
free up space, not just delay the loss). New RPC
`withdraw_from_deposit(p_instance_id uuid)`:

- Validates the caller owns the instance and it is currently
  `status = 'deposit'`.
- Checks current `stationed`/`in_transit` count `< deck_limit(level)`; if
  not, rejects with a clear error ("balíček je stále plný — nejdřív vrať
  jinou kartu do centrální sady").
- On success: `status = 'stationed'`, `stationed_territory_id` = player's
  home territory, `deposit_expires_at = null`.

This is the mechanism the design's "return a card to central pool to make
room, then withdraw from deposit" flow (from the original brainstorming)
relies on: player calls `return_card_to_pool()` on an unwanted stationed
card, then `withdraw_from_deposit()` on the one they want to keep.

## Future automation note

pg_cron is not introduced by this feature — deliberately deferred, matching
the rest of the app's lazy style. Because all the time-based logic here
lives in a plain SQL function (`_expire_deposit`), switching to a precise
scheduled job later (e.g. `select cron.schedule(...)` calling a thin wrapper
that runs `_expire_deposit` for all players) would not require rewriting the
underlying logic — only adding the schedule.

## Client changes

- `lib/players/cardLimit.ts` — mirrors `_deck_limit`/`_deposit_limit` in TS
  for display (e.g. progress bar), not enforcement.
- `lib/territories/api.ts` (or a new `lib/cards/deposit.ts`) — wrapper for
  `return_card_to_pool()`; `MyCardInstance` gains `deposit_expires_at` and
  the `'deposit'` status value.
- `app/collection/page.tsx`:
  - Header shows `X / deck_limit` count.
  - New "Depozit" filter/section listing deposit cards, each showing a
    live countdown to `deposit_expires_at` (e.g. "vyprší za 2 dny 4 hod").
  - "Vrátit do centrální sady" action on stationed cards, with an inline
    confirm step whose copy differs by rank (burn vs. recycle wording).
  - "Vyzvednout z depozitu" action on deposit cards (only enabled/shown
    when deck has room), calling `withdraw_from_deposit()`.
  - Warning banner shown whenever the player has ≥1 deposit card, stating
    they risk losing newly-won cards until they free up deck space.

## Testing

- `lib/players/cardLimit.test.ts` — formula boundary values (levels 1, 10,
  30).
- SQL/RPC-level tests (matching the existing migration test-file pattern):
  overflow → deposit with correct `deposit_expires_at`; overflow when
  deposit is also full → immediate burn/recycle + log row for rare+;
  lazy expiry triggered from both read paths; `return_card_to_pool`
  ownership/state validation and burn-vs-recycle behavior;
  `withdraw_from_deposit` success + rejected-when-deck-full case; a
  trade-offer swap that nets to zero cards does not route either side to
  deposit.
- `app/collection/page.test.tsx` additions: limit indicator, deposit tab
  with countdown, return-to-pool button + confirm copy, withdraw-from-
  deposit button, warning banner visibility.
