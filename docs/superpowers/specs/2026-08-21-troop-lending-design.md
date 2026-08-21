# Troop Lending (Coalitions Phase 2) — Design

## Purpose

Allow coalition members to lend army cards to an ally's territory so the ally
can use them for defense (and generally as part of their garrison), without
any changes to the existing N-vs-M battle engine.

## Mechanism

A loan **temporarily reassigns `owner_id`** on the lent card(s) to the
borrower for the duration of the loan. Because every existing battle/defender
query already scopes by `ci.owner_id = <territory owner>`, this makes lent
cards usable in battle exactly like the borrower's own cards — **no changes
to the battle engine are required**.

- While traveling to the destination, the card's `owner_id` stays with the
  lender (not usable by anyone).
- On arrival, `owner_id` flips to the borrower; the card becomes a normal
  part of that territory's garrison (subject to the same 2-round rest
  mechanic as any other card).
- If the card loses a duel while on loan, it transfers to the battle winner
  — same as any other card, no special-case code needed for the transfer
  itself. However, **whenever a card's `owner_id` changes via capture**
  (duel loss, or territory-capture reassignment), `loaned_from_id` and
  `loan_return_at` must also be cleared on that same card. Otherwise the
  auto-expiry sweep or the original lender's `recall_loan` could later yank
  a card away from its new legitimate owner.
- If it survives and the loan ends (recall or expiry), a return transfer
  starts and `owner_id` flips back to the original lender (`loaned_from_id`)
  immediately at that point (no longer usable by the borrower once the
  return trip has started). The return trip targets the lender's **current**
  home territory (re-resolved at recall/expiry time, not the territory that
  was current when the loan started, in case it changed hands meanwhile).
- A card currently on loan to you (`loaned_from_id` set to someone else) is
  not eligible to be re-lent further — only cards you outright own can be
  lent out.

## Data model

- `card_instances`:
  - `loaned_from_id uuid null references players(id)` — original owner while
    on loan; `null` when not on loan.
  - `loan_return_at timestamptz null` — when the loan auto-expires.
- `troop_movements.kind` gains two new values: `'loan'` (outbound) and
  `'loan_return'` (return trip). Requires widening the existing check
  constraint and adding dedicated arrival branches in
  `resolve_due_movements()` (each `kind` has its own explicit completion
  branch today; a `'loan'` arrival branch must additionally set
  `loaned_from_id`/`loan_return_at`, and a `'loan_return'` arrival branch
  must clear them).

## RPCs

- `lend_troops(p_destination_territory_id, p_card_instance_ids[], p_duration_hours)`
  - Caller must own the cards; destination territory must be owned by a
    fellow coalition member (not self).
  - `p_duration_hours` bounded `[0, 336]` (0–14 days).
  - Blocked only if destination has an **active battle** (a `battles` row
    exists, not `resolved`/`expired`) — identical rule to `start_transfer`.
    Loans are allowed while an attack is merely in transit.
  - Starts a `'loan'` movement; sets `loan_return_at = now() + duration` and
    `loaned_from_id = caller` on arrival.
- `recall_loan(p_card_instance_id)`
  - Callable at any time by the original lender (`loaned_from_id = caller`).
  - Starts a `'loan_return'` movement back to the lender's territory;
    `owner_id` reverts to `loaned_from_id` immediately, clearing
    `loaned_from_id`/`loan_return_at`.
- Auto-expiry: `resolve_due_movements()` checks for stationed cards with
  `loan_return_at <= now()` and automatically starts their `loan_return`
  movement (same path as manual recall).
- Coalition breakup / member leaving: auto-recall all active loans between
  the affected pair of players. This includes loans still **in transit**
  outbound (not yet arrived/stationed) — those movements must be turned
  around toward the lender's territory rather than left to complete and
  hand a card to a now-former-ally. Stationed loans use the normal
  `recall_loan` path.

## No limits

- No consent step required from the borrower (consistent with existing
  reinforcement-style transfers).
- No cap on number of cards per loan, number of simultaneous loans, or
  cards left behind at origin.
- No cap on total army size in a battle (attacker selection or defender
  garrison) — tracked as a separate future backlog item
  (`battle-army-size-limit`), deliberately out of scope here.
- If a loaned card's territory is captured via an outright win with no
  combat, the surviving card is sent to the defender's (borrower's) home as
  usual — the loan is treated as unaffected and continues at the new
  location; this is intentional, not a gap.

## UI

- New "Lend troops" modal (mirrors `DeclareAttackModal`/transfer UI):
  pick destination territory (coalition members only), pick cards, pick
  duration (0–336h), confirm.
- New "My loans" section for the lender: active loans (destination, cards,
  return time) with a "Recall" button.
- Garrison modal at the destination: lent cards appear alongside the
  territory owner's own cards (since `owner_id` now matches), with a small
  "on loan from X" badge for clarity.
- Notifications: borrower on arrival; lender on return/expiry; both parties
  on auto-recall triggered by coalition breakup/departure.

## Testing

- Unit tests for `lend_troops`/`recall_loan` validation (coalition
  membership, duration bounds, active-battle block).
- Migration test verifying `owner_id` flips correctly on loan arrival and
  on return/recall, and that a card lost mid-loan transfers to the battle
  winner with no special-case behavior.
- Auto-expiry and coalition-breakup auto-recall covered by
  `resolve_due_movements()`/breakup-flow tests.
