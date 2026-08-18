# Reinforcement lock + attack recall (backlog #23 + #14) — design

## Problem

Today, once an attack is declared, the defender can keep sending fresh
reinforcement transfers into the besieged territory indefinitely — even
after the attacker's troops arrive and a battle exists — because
`start_transfer()` has no awareness of battles, and `pick_defender_card()`
allows picking any card currently `stationed` at the territory regardless
of when it arrived. This lets a defender "wait out the timer" and always
have a full-strength garrison no matter how long the siege drags on.

Separately, an attacker has no way to change their mind and call off an
in-transit attack (backlog #14) — including the specific new case this
creates: if the attacker sees the defender is rushing in reinforcements
that will land before their own troops arrive, they have no way to react.

## Rules

1. **Reinforcements are blocked once a battle exists for a territory.**
   `start_transfer()` rejects the call if the destination territory has any
   `battles` row with `status not in ('resolved', 'expired')`. A battle row
   is only created the moment the attacker's troops actually arrive (see
   `resolve_due_movements()`), so reinforcements sent *before* that moment
   remain unaffected.

2. **Reinforcements already in flight when the attacker arrives are
   automatically recalled.** The instant a battle is created for a
   territory, any other in-transit `transfer`-kind movement heading to
   that same territory (sent by the defender) is turned around: it starts
   traveling back to where it came from, taking exactly as long as it had
   already traveled (so a reinforcement 1/5 of the way through a 10-hour
   trip returns home in 2 hours). This reuses a new shared helper,
   `_recall_movement_to_origin(movement_id)` (see below).

3. **The attacker can voluntarily recall their own attack while it's still
   in transit** (backlog #14, scoped narrowly to this one case — not a
   general "cancel any movement" feature). New RPC `recall_attack(movement_id)`:
   only works while the movement's `status = 'in_transit'` (i.e. the attack
   hasn't arrived and no battle exists yet for it). Uses the same
   `_recall_movement_to_origin()` helper, then clears the target
   territory's `battle_locked_by` (set by `declare_attack` at the moment of
   dispatch) so the territory becomes attackable again. Once the attack has
   already arrived and a battle exists, it's too late to recall — this is
   intentionally out of scope (recalling an *arrived*/`awaiting_ready`
   battle is a separate, more complex feature that was explicitly deferred).

4. **The attacker is warned in the UI if defender reinforcements are en
   route with an earlier ETA than their own attack.** Purely informational,
   pairs naturally with the new cancel button from rule 3.

## `_recall_movement_to_origin(p_movement_id uuid)` (new shared helper)

Turns any in-transit movement around: swaps `origin_territory_id` and
`destination_territory_id`, sets `kind = 'transfer'` (so the existing
generic "transfer arrival" landing logic — which just marks the cards
`stationed` at the destination with no side effects — handles it with zero
new code), resets `started_at = now()`, and sets the new
`transfer_arrives_at = now() + elapsed`, where `elapsed` is how long the
movement had already been traveling (`now() - started_at` at the moment of
recall). This is used both by the system (rule 2, always still in-transit)
and by the player-triggered RPC (rule 3, always still in-transit, since
that's its precondition).

## Server changes

- `supabase/migrations/0018_reinforcement_lock_and_recall.sql`:
  - New `_recall_movement_to_origin(uuid)` helper.
  - `create or replace function start_transfer(...)` (from
    `0002_territories.sql`) with the new battle-existence check added.
  - `create or replace function resolve_due_movements()` (from
    `0011_claim_xp.sql`, the latest redefinition) with a new step inserted
    right after each of the two PvP battle-creation branches (attacker vs.
    player-owned target, attacker vs. claim-locked target): recall any
    other in-transit `transfer` movements from the defender heading to the
    same destination.
  - New `recall_attack(p_movement_id uuid)` RPC.
- Matching `.verification.sql`.

## Client changes

- `lib/territories/api.ts`: `recallAttack(movementId)` RPC wrapper;
  `getIncomingReinforcements(destinationTerritoryIds: number[])` — a direct
  `troop_movements` select (`kind = 'transfer'`, `status = 'in_transit'`,
  `destination_territory_id in (...)`) returning each row's destination and
  `transfer_arrives_at`, for the warning comparison.
- `MyMovementsPanel.tsx`: for every in-transit `attack` row, look up
  incoming reinforcements for its destination; if any has an earlier
  `transfer_arrives_at` than the attack's own, show a short warning with
  the count. Every in-transit `attack` row also gets a "Zrušit útok" button
  calling `recallAttack`.

## Testing

- SQL: manual verification checklist covering (a) `start_transfer` rejected
  once a battle exists, (b) in-transit reinforcement auto-recalled on
  attacker arrival with the correct partial-elapsed return time, (c)
  `recall_attack` succeeds pre-arrival and returns the correct
  elapsed-based return time, (d) `recall_attack` rejected once the attack
  has already arrived.
- Client: `MyMovementsPanel.test.tsx` extended for the warning banner and
  the cancel button/action.
