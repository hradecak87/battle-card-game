# Troop Lending (Coalitions Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let coalition members lend army cards to an ally's territory by temporarily reassigning card ownership, so the existing battle engine works unmodified.

**Architecture:** New `troop_movements.kind` values `'loan'`/`'loan_return'`, two new nullable columns on `card_instances` (`loaned_from_id`, `loan_return_at`), two new RPCs (`lend_troops`, `recall_loan`), and small additions to the existing `resolve_due_movements()` arrival pipeline, `_resolve_round()` (duel-loss capture), `_finalize_battle()` (no-combat capture), and coalition-leave/breakup logic. Frontend: a lend modal, a "my loans" list, a garrison badge, and notifications.

**Tech Stack:** Supabase/Postgres (plpgsql migrations), Next.js 14 + TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-08-21-troop-lending-design.md` — read this first.

**Worktree:** `../battle-card-game-troop-lending`, branch `feat/troop-lending`. Migration number: `0068` (next available after `0067`).

---

## Task 1: Schema — columns, constraint, and lend/recall RPCs

**Files:**
- Create: `supabase/migrations/0068_troop_lending.sql`
- Create: `supabase/migrations/0068_troop_lending.verification.sql`

**Reference for existing patterns:**
- `supabase/migrations/0020_speed_attribute.sql` — `start_transfer` (eligibility, active-battle block, row locking, `troop_movements`/`troop_movement_units` insert pattern).
- `supabase/migrations/0065_coalition_attack_enforcement.sql:60-100` — coalition-membership check pattern (`coalition_members`/`coalitions` join, `disbanded_at is null`).
- `supabase/migrations/0018_reinforcement_lock_and_recall.sql` — `_recall_movement_to_origin` (turning an in-transit movement around).
- `supabase/migrations/0003_battles.sql:19-21` — current `troop_movements_kind_check` constraint definition to widen.

**Steps:**

- [ ] **Step 1: Add columns and widen the kind constraint**

```sql
alter table card_instances
  add column loaned_from_id uuid null references players(id),
  add column loan_return_at timestamptz null;

alter table troop_movements drop constraint troop_movements_kind_check;
alter table troop_movements add constraint troop_movements_kind_check
  check (kind in ('transfer', 'claim', 'attack', 'loan', 'loan_return'));

-- store the requested loan duration on the outbound movement so
-- resolve_due_movements() can set loan_return_at on arrival
alter table troop_movements
  add column loan_duration_hours numeric null;
```

- [ ] **Step 2: Write `lend_troops(p_caller, p_destination_territory_id, p_card_instance_ids uuid[], p_duration_hours numeric)`**

Follow `start_transfer`'s shape closely:
- Validate `p_duration_hours between 0 and 336`.
- Validate all `p_card_instance_ids` are owned by `p_caller`, `status = 'stationed'`, and `loaned_from_id is null` (a card already on loan to the caller cannot be re-lent — the caller doesn't own it outright).
- Validate destination territory is owned by a fellow coalition member (same join pattern as `0065`, excluding self), not the caller's own territory.
- Block if destination has an active battle (`battles` row with `status not in ('resolved','expired')`) — same rule as `start_transfer`'s existing block.
- Compute travel time using the existing distance/speed helper `start_transfer` uses (reuse it directly, do not reimplement).
- Insert a `troop_movements` row with `kind = 'loan'`, `status = 'in_transit'`, `loan_duration_hours = p_duration_hours`, plus `troop_movement_units` rows for each card. Set the cards' `status = 'in_transit'` (existing convention for any outbound movement).

- [ ] **Step 3: Write `recall_loan(p_caller, p_card_instance_id uuid)`**

- Validate the card's `loaned_from_id = p_caller` and `status = 'stationed'` (only a currently-stationed loaned card can be recalled this way; in-transit outbound loans are handled by cancellation in Task 3, not this RPC).
- Immediately set `owner_id = loaned_from_id`, clear `loaned_from_id`/`loan_return_at` on the card (per spec: ownership reverts at recall time, not on arrival home).
- Look up the lender's **current** home territory (`is_home = true and owner_id = p_caller`) as the return destination — do not use whatever territory was current when the loan started.
- Insert a `troop_movements` row with `kind = 'loan_return'`, `status = 'in_transit'`, origin = the loaned card's current `stationed_territory_id`, destination = lender's current home territory. Set card `status = 'in_transit'`.

- [ ] **Step 4: Write the verification SQL**

Cover: constraint accepts new kinds; `lend_troops` rejects non-coalition destination, rejects duration out of range, rejects lending an already-loaned-to-you card, blocks when destination has an active battle but allows when destination merely has an in-transit attack; `recall_loan` reverts ownership immediately and targets the lender's current home even if their original home changed.

- [ ] **Step 5: Apply migration locally/live and run verification**

Follow the same live-apply process used for `0067` (see that migration's application in the prior session if a helper script exists, otherwise apply via the Supabase SQL editor/CLI and run the verification file against it).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0068_troop_lending.sql supabase/migrations/0068_troop_lending.verification.sql
git commit -m "feat: add troop lending schema and lend/recall RPCs"
```

---

## Task 2: Arrival handling, auto-expiry, and capture cleanup

**Files:**
- Modify: `supabase/migrations/0068_troop_lending.sql` (same file — add these functions after Task 1's content, as new `create or replace function` statements that supersede the ones below)

**Reference:**
- `supabase/migrations/0067_npc_attack_cancellation.sql:683-953` — current `resolve_due_movements()`. The **generic** card-instance stationing update (no `kind` filter, near line 945: `update card_instances ... set stationed_territory_id = ..., status = 'stationed' from troop_movements tm where tm.status = 'in_transit' and tm.transfer_arrives_at <= now()`) already handles moving `'loan'`/`'loan_return'` cards to their destination — no change needed there. What's missing is kind-specific completion logic.
- `supabase/migrations/0026_boost_cards.sql:687-780` — current `_resolve_round()`; the capture line is `update card_instances set owner_id = v_winner_owner where instance_id = v_loser_card;` (line 780).
- `supabase/migrations/0047_wall_structure_card.sql:853` — current `_finalize_battle()`; the no-combat-capture reassignment (`set owner_id = v_battle.attacker_id, ...`).

**Steps:**

- [ ] **Step 1: Extend `resolve_due_movements()` with loan-specific arrival branches**

`create or replace function resolve_due_movements()` (copy the full current body from `0067` and add):
- After the existing generic transfer/claim completion updates, add: mark `'loan'` movements `status = 'in_transit' and transfer_arrives_at <= now()` as `completed`, and for their cards set `owner_id = destination territory's current owner`, `loaned_from_id = tm.player_id`, `loan_return_at = now() + (tm.loan_duration_hours || ' hours')::interval`.
- Similarly mark `'loan_return'` movements completed (owner already reverted at recall time in Task 1 Step 3 — no further owner change needed on arrival, cards are just now `stationed` at the lender's territory via the generic update).

- [ ] **Step 2: Add auto-expiry sweep**

In the same function (or a small helper called from it, e.g. `_expire_due_loans()`), for every `stationed` card with `loan_return_at <= now()`, run the same logic as `recall_loan` (revert `owner_id`, clear loan fields, insert a `loan_return` movement to the lender's current home). Extract the shared body from `recall_loan` into a `_recall_loan_core(p_card_instance_id)` helper (mirrors the `_recall_attack_core` pattern from `0067`) so both the RPC and the sweep call the same code.

- [ ] **Step 3: Clear loan fields on duel-loss capture**

In `_resolve_round()` (`0026_boost_cards.sql:780` is the line to copy-and-extend in the new `create or replace function`): immediately after `update card_instances set owner_id = v_winner_owner where instance_id = v_loser_card;`, add `update card_instances set loaned_from_id = null, loan_return_at = null where instance_id = v_loser_card;` (only matters if the loser card was on loan; harmless no-op otherwise).

- [ ] **Step 4: Clear loan fields on no-combat-capture**

In `_finalize_battle()` (`0047_wall_structure_card.sql:853` line to extend): wherever surviving/captured cards get `owner_id` reassigned to `v_battle.attacker_id` or `v_battle.defender_id`, add the same `loaned_from_id = null, loan_return_at = null` clear for any affected card that had `loaned_from_id is not null`.

- [ ] **Step 4b: Clear loan fields on the `steal_unit` boost-effect capture path**

`0026_boost_cards.sql`'s `_trigger_instant_boost_if_needed()` also directly reassigns `card_instances.owner_id` for the `steal_unit` instant effect (lines 285 and 319: `update card_instances set owner_id = v_battle.attacker_id/defender_id where instance_id = v_target;`). This is a third, separate ownership-transfer path outside `_resolve_round`/`_finalize_battle`. Add the same `loaned_from_id = null, loan_return_at = null` clear at both of these sites in the new `create or replace function _trigger_instant_boost_if_needed(...)`.

- [ ] **Step 5: Write tests**

Add to `supabase/migrations/0068_troop_lending.verification.sql`: a loaned card that loses a duel keeps its new owner and has null loan fields (auto-expiry sweep does not later yank it); a loaned card that survives is auto-returned when `loan_return_at` passes.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0068_troop_lending.sql supabase/migrations/0068_troop_lending.verification.sql
git commit -m "feat: handle loan arrival, auto-expiry, and capture cleanup"
```

---

## Task 3: Coalition breakup/leave auto-recall (including in-transit loans)

**Files:**
- Modify: `supabase/migrations/0064_coalition_rpcs.sql` — currently defines `coalition_leave()`, `coalition_disband()`, `_coalition_disband_core()`, and `coalition_kick(p_player_id uuid)`.

**Steps:**

- [ ] **Step 1: Confirm current function definitions**

Run `grep -n "create or replace function coalition_leave\|create or replace function coalition_disband\|create or replace function _coalition_disband_core\|create or replace function coalition_kick" supabase/migrations/*.sql` to confirm `0064_coalition_rpcs.sql` (or a later migration, if one redefines them) is authoritative before editing.

- [ ] **Step 2: Add auto-recall for stationed loans**

When a member leaves (`coalition_leave`), is kicked (`coalition_kick`), or the coalition disbands (`coalition_disband`/`_coalition_disband_core`), for every card where `(owner_id, loaned_from_id)` is an affected pair (either direction) and `status = 'stationed'`, call `_recall_loan_core(card_instance_id)` (from Task 2).

- [ ] **Step 3: Add cancellation for in-transit outbound loans**

For every `troop_movements` row with `kind = 'loan'`, `status = 'in_transit'`, where `player_id`/destination-territory-owner is the affected pair, reuse `_recall_movement_to_origin` (from `0018_reinforcement_lock_and_recall.sql`) to turn the movement around toward the lender's origin instead of letting it complete.

- [ ] **Step 4: Write tests**

Cover: leaving a coalition recalls both a stationed loan and cancels an in-transit one; being kicked does the same; disbanding a coalition does the same for all member pairs.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<edited file>
git commit -m "feat: auto-recall troop loans on coalition breakup/leave"
```

---

## Task 4: Frontend — lend modal, my loans list, garrison badge, notifications

**Files:**
- Look at existing analogues before writing new code: `components/*/DeclareAttackModal*` (or equivalent transfer modal) for the lend modal's shape; wherever the garrison/territory-detail modal lists stationed cards, for the loan badge; `components/notifications/notificationLabel.ts`, `lib/notifications/deepLink.ts`, `lib/notifications/types.ts` (extended for `attack_cancelled` in `0067`'s work — follow the same pattern for new loan-related notification types).
- Create: a new "Lend troops" modal component (co-locate with the existing transfer/attack modal it mirrors).
- Create: a "My loans" list section (co-locate with wherever the player's territory/army overview lives).
- Modify: the garrison/territory-cards display component to show a small "on loan from X" badge when `loaned_from_id is not null`.

**Steps:**

- [ ] **Step 1: Add TypeScript types/hooks for loans**

Mirror the existing pattern for transfers/attacks (check `lib/` for a `useMyTerritoriesBattleChannel`-style hook or a data-fetching hook for movements; add an equivalent for "my outstanding loans").

- [ ] **Step 2: Build the lend modal**

Destination territory picker restricted to coalition members' territories (reuse the player-search/territory-picker component already used in the diplomacy UI, per this session's earlier player-search work), card multi-select from the caller's stationed cards at the chosen origin, duration input (0-336h), confirm calls `lend_troops`.

- [ ] **Step 3: Build "My loans" list + recall action**

List active loans (destination, cards, `loan_return_at`), a "Recall" button per loan calling `recall_loan`.

- [ ] **Step 4: Add garrison badge**

In the territory/garrison card list, when a card has `loaned_from_id`, show "on loan from {name}".

- [ ] **Step 5: Add notification types**

Add new notification types (e.g., `loan_arrived`, `loan_returned`, `loan_auto_recalled`) following the exact pattern `attack_cancelled` used in `0067`'s frontend changes (`NotificationList.tsx`, `notificationLabel.ts`, `deepLink.ts`, `types.ts`, push send route, `sw.js`).

- [ ] **Step 6: Write component tests** for the new modal, list, badge, and notification label/deep-link additions, mirroring existing test patterns for the analogous components.

- [ ] **Step 7: Run full verification**

```bash
npx tsc --noEmit
npx jest --silent
```

Expected: no type errors, all suites passing.

- [ ] **Step 8: Commit**

```bash
git add <changed files>
git commit -m "feat: add troop lending UI (lend modal, my loans, garrison badge, notifications)"
```

---

## Task 5: Final verification and progress update

- [ ] **Step 1:** Run `npx tsc --noEmit` and `npx jest --silent` on the full worktree one more time; confirm clean.
- [ ] **Step 2:** Update `docs/superpowers/PROGRESS.md` to mark troop lending (coalitions phase 2) as done, noting the temporary-ownership-reassignment mechanism for future reference.
- [ ] **Step 3:** Commit the progress update.
- [ ] **Step 4:** Report completion — do NOT merge/push to `main` without explicit user approval (per this project's standing rule).
