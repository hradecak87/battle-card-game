# Trading / Exchange (Směnárna) — Design Spec

**Status**: Approved by user, 2026-08-17.

## 1. Problem

Players currently have no way to trade unit cards with each other outside
of winning/losing them in battle. The roadmap calls for a trading/exchange
module ("směnárna") that lets a player offer cards to another specific
player, or list cards publicly for anyone to make an offer on, with
counter-offers, acceptance/rejection, and expiration — all fully
asynchronous (no requirement for both players to be online at the same
time, unlike battles).

## 2. Decisions (from brainstorming)

- **Two ways to initiate a trade**: a *direct* offer to a specific player,
  or a *public* marketplace listing that anyone can respond to with a
  counter-offer.
- **Bundle-for-bundle.** Both direct offers and counter-offers may include
  any number of cards on each side (not limited to 1-for-1). Public
  listings state what the lister wants (specific criteria, or free text/
  "anything considered") rather than a fixed set of requested cards.
- **Eligible cards**: any card not currently involved in an active battle
  or in-transit movement (`card_instances.status` other than
  `in_transit`/actively garrisoned-in-combat). Cards stationed at a
  territory but not currently fighting are still tradeable.
- **No card locking.** Placing a card in an offer does not reserve it.
  Eligibility is re-checked at accept time; if a card was used elsewhere in
  the meantime, the accept fails cleanly with no partial trade.
- **Fully asynchronous.** No online-presence requirement, unlike battles.
- **Unlimited counter-offer rounds** until someone accepts, rejects, or
  cancels.
- **3-day expiration** per offer/counter-offer round; each new counter
  resets the clock for that round. Expiration is resolved lazily (same
  pattern as `resolve_due_battles()`), not via a cron job.
- **Limit of 10 active offers per player** (direct + public listings
  combined).
- **Notifications**: a simple unread-count badge in the main navigation
  (offers where the current player is the target and status is
  `pending`), plus the `/exchange` page itself. No realtime push — that
  waits for the future shared notifications module.
- **Cancellation**: the initiator of an offer may cancel it at any time
  before it's resolved. The target may reject at any time.
- **Marketplace filters**: rank, unit type, owner name.
- **Trade history** is visible (completed trades only, who traded what
  with whom).
- Lives at a new dedicated page, `/exchange`.

## 3. Data model

One table serves both direct offers and public listings, with
counter-offers represented as a chain of linked rows:

```sql
create table trade_offers (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null check (type in ('direct', 'public')),
  status              text not null default 'pending'
                        check (status in
                          ('pending', 'countered', 'accepted',
                           'rejected', 'cancelled', 'expired')),
  initiator_id        uuid not null references players(id),
  target_player_id    uuid references players(id),      -- null for public
  parent_offer_id     uuid references trade_offers(id),  -- previous round
  root_offer_id       uuid not null references trade_offers(id),
  offered_card_ids     uuid[] not null,
  requested_card_ids   uuid[],       -- direct offers: specific cards wanted
  requested_criteria   jsonb,        -- public listings: {rank?, unit_type?} or null = "anything"
  message              text,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,   -- created_at + 3 days
  resolved_at          timestamptz
);

create index trade_offers_target_idx on trade_offers (target_player_id, status);
create index trade_offers_initiator_idx on trade_offers (initiator_id, status);
create index trade_offers_expires_idx on trade_offers (expires_at) where status in ('pending');
create index trade_offers_public_idx on trade_offers (status) where type = 'public';
```

**Public listing → response flow**: a public listing (`type='public'`,
`target_player_id=null`) stays active and browsable in the marketplace
independent of any responses. When another player responds, a new
`direct` row is created with `parent_offer_id` = the public listing,
`root_offer_id` = the public listing's own id (or its root, if chained
further), and `target_player_id` = the lister. The lister can accept,
reject, or counter that response like any direct offer. The original
public listing is only closed out (status → `accepted`/`cancelled`) when
the lister accepts a response or cancels the listing itself — it is not
auto-consumed by every incoming response, since multiple people may
respond to the same listing.

**Counter-offer chaining**: countering sets the parent row's status to
`countered` and inserts a new row with `parent_offer_id` = the row being
countered, same `root_offer_id`, flipped `initiator_id`/`target_player_id`
(whoever is responding becomes the new initiator), and a fresh 3-day
`expires_at`. The full negotiation history for a trade is reconstructed by
querying all rows sharing the same `root_offer_id`, ordered by
`created_at`.

## 4. Trade lifecycle & validation

- **Create / counter**: validate the initiator owns all `offered_card_ids`
  and none are in an active battle or in-transit movement. For direct
  offers, `requested_card_ids` (if given) just need to exist and belong to
  the target — no eligibility re-check happens until accept time, since
  the target may not have decided to trade them yet. Enforce the
  active-offers-per-player cap (10) before insert.
- **Accept**: re-validates, inside a single transaction, that every card
  in both `offered_card_ids` and `requested_card_ids` still belongs to the
  expected owner and is still eligible (not in battle/in transit). If any
  check fails, the whole accept is rejected with a clear error and nothing
  changes — no partial trades. On success: swap `owner_id` for every
  involved card, set `status = 'accepted'`, `resolved_at = now()`, and
  (if this row has a `parent_offer_id` chain or a linked public listing)
  close out the related rows appropriately.
- **Reject**: only the current `target_player_id` may reject; sets
  `status = 'rejected'`, `resolved_at = now()`.
- **Cancel**: only the current `initiator_id` may cancel their own
  pending offer (including an unanswered public listing); sets
  `status = 'cancelled'`, `resolved_at = now()`.
- **Expire**: a `resolve_expired_trade_offers()` SQL function, mirroring
  the existing `resolve_due_battles()` lazy-resolution pattern, is called
  at the top of every offer-listing/read API so no cron job is needed. It
  marks any row with `status = 'pending'` and `expires_at <= now()` as
  `expired`.

## 5. API / server actions

- `createTradeOffer({ type, targetPlayerId?, offeredCardIds,
  requestedCardIds?, requestedCriteria?, message? })`
- `counterOffer(parentOfferId, { offeredCardIds, requestedCardIds?,
  message? })`
- `respondToPublicOffer(publicOfferId, { offeredCardIds, message? })`
- `acceptOffer(offerId)`
- `rejectOffer(offerId)`
- `cancelOffer(offerId)`
- `listMyOffers()` — sent + received direct offers, any status
- `listPublicMarketplace({ rank?, unitType?, ownerName? })`
- `listTradeHistory()`
- `resolve_expired_trade_offers()` (DB function, called lazily by the
  above list/read endpoints, same pattern as `resolve_due_battles()`)

## 6. UI — `/exchange` page

- **Tabs**: "Moje nabídky" (sent + received direct offers), "Tržnice"
  (public listings, filterable by rank / unit type / owner name),
  "Historie" (completed trades).
- **Create offer modal**: multi-select card picker from the player's
  collection (reusing `TradingCard`/card-zoom components); direct offers
  additionally let the initiator search for a target player and pick from
  that player's cards to request; public listings instead capture
  criteria (rank/unit type, or free text for "anything considered").
- **Offer detail view**: both sides' cards shown side by side, with
  Accept/Reject/Counter/Cancel actions shown based on the viewer's role
  and the offer's status, plus the full counter-offer chain listed
  chronologically underneath.
- **Navigation badge**: count of `pending` offers where the current player
  is `target_player_id`, shown next to the player's profile link in the
  main nav.

## 7. Testing notes

- Unit/integration tests for: eligibility validation at create and at
  accept time (including the "card became ineligible between create and
  accept" failure path with no partial trade), the active-offer cap,
  counter-offer chaining (`root_offer_id` propagation, parent status
  flip), public-listing multi-responder behavior (listing stays open
  until explicitly closed), cancel/reject permission checks (only
  initiator cancels, only target rejects), and lazy expiration.
- Follows the existing project convention of a `.sql` migration plus a
  paired `.verification.sql` file with direct SQL assertions.
