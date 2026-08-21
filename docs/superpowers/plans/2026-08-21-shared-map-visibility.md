# Shared Map Visibility (Coalitions Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let coalition members see each other's in-transit troop movements (arrows + composition) on the map, mirroring the existing "my own movements" / "incoming attacks on my territories" UX.

**Architecture:** Two new read-only RPCs (`get_coalition_movements()`, `get_incoming_attacks_on_coalition_territories()`) mirroring the existing single-player versions but scoped via a `coalition_members` self-join; widen `get_movement_cards()`'s authorization to also allow coalition members; extend `useMapMovementArrows`/`MapMovementArrows` with new ally arrow categories.

**Tech Stack:** Supabase/Postgres (plpgsql migrations), Next.js 14 + TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-08-21-shared-map-visibility-design.md` — read this first.

**Worktree:** `../battle-card-game-shared-map-visibility`, branch `feat/shared-map-visibility`. Migration number: `0069` (next available after `0068` used by the troop-lending feature currently being implemented in a sibling worktree — confirm no conflict before finalizing the number; if `0068` has landed on `main` by the time this is implemented, use the next free number after it).

---

## Task 1: Backend RPCs

**Files:**
- Create: `supabase/migrations/0069_coalition_map_visibility.sql`
- Create: `supabase/migrations/0069_coalition_map_visibility.verification.sql`

**Reference for existing patterns:**
- `supabase/migrations/0059_map_movement_arrows.sql` — current `get_incoming_attacks_on_my_territories()` (columns to mirror, including attacker identity) and `get_movement_cards()` (authorization to widen).
- `supabase/migrations/0002_territories.sql:227` — current `get_my_movements()` (columns to mirror for the ally version).
- `supabase/migrations/0065_coalition_attack_enforcement.sql:82-89` — `coalition_members`/`coalitions` self-join pattern for "same undisbanded coalition" checks.

**Steps:**

- [ ] **Step 1: `get_coalition_movements()`**

Mirror `get_my_movements()`'s `select * from troop_movements where status in ('in_transit', 'occupying')`, but instead of `player_id = auth.uid()`, filter to `player_id in (select cm_target.player_id from coalition_members cm_self join coalition_members cm_target on cm_target.coalition_id = cm_self.coalition_id join coalitions c on c.id = cm_self.coalition_id where cm_self.player_id = auth.uid() and cm_target.player_id <> auth.uid() and c.disbanded_at is null)`. Join in mover identity: `player_id`, `display_name`, `kingdom_name`, `is_npc` from `players` (same columns `get_incoming_attacks_on_my_territories()` already exposes for the attacker). Call `perform resolve_due_movements();` at the top like the existing functions do.

- [ ] **Step 2: `get_incoming_attacks_on_coalition_territories()`**

Copy `get_incoming_attacks_on_my_territories()` (`0059`) verbatim except widen the final `where` clause's territory-ownership check from `t.owner_id = auth.uid() or (t.owner_id is null and t.claim_locked_by = auth.uid())` to also match any current coalition member of the caller (same self-join as Step 1, reused as a CTE or inline subquery — extract the "current coalition member ids of caller" subquery into a small helper if it keeps things readable, e.g. `_coalition_member_ids(p_player_id uuid) returns setof uuid`, and use it in both this function and Step 1).

- [ ] **Step 3: Widen `get_movement_cards(p_movement_id)`'s authorization**

`create or replace function get_movement_cards(p_movement_id uuid)` — change the `where tm.id = p_movement_id and tm.player_id = v_player_id` clause to also allow `tm.player_id in (select _coalition_member_ids(v_player_id))`. Keep everything else (masking, ordering, columns) unchanged.

- [ ] **Step 4: Write verification SQL**

Cover: a coalition member sees an ally's outgoing movement via `get_coalition_movements()` and incoming attacks on the ally's territory via `get_incoming_attacks_on_coalition_territories()`; a non-member sees neither; `get_movement_cards()` succeeds for a coalition member on an ally's movement and still fails for a non-member; after the ally leaves/is kicked/the coalition disbands, all three immediately stop returning that player's data (no snapshot to clean up, since these are live membership checks).

- [ ] **Step 5: Apply migration live and run verification**

Same live-apply process used for prior migrations (temp Node + `pg` script reading `.env.local`, split on `/\r?\n/`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0069_coalition_map_visibility.sql supabase/migrations/0069_coalition_map_visibility.verification.sql
git commit -m "feat: add coalition movement visibility RPCs"
```

---

## Task 2: Frontend — ally arrows

**Files:**
- Modify: `lib/territories/api.ts` — add `getCoalitionMovements()` and `getIncomingAttacksOnCoalitionTerritories()` client wrappers, mirroring `getMyMovements()`/`getIncomingAttacksOnMyTerritories()`.
- Modify: `lib/territories/useMapMovementArrows.ts` — fetch the two new RPCs alongside the existing two, add `ally-transfer` / `ally-offensive` / `ally-incoming` arrow categories with mover identity included, mirroring the existing `toMineArrow`/`toIncomingArrow` mapping functions.
- Modify: `components/territories/MapMovementArrows.tsx` — render the new categories with a color distinct from both "mine" and "incoming enemy" arrows.
- Test: `components/territories/MapMovementArrows.test.tsx`, `lib/territories/useMapMovementArrows.test.ts` (create if it doesn't already exist — check first).

**Steps:**

- [ ] **Step 1: Add API client wrappers** in `lib/territories/api.ts`, typed consistently with the existing `TroopMovement`/`IncomingAttackOnMyTerritory` interfaces (add mover-identity fields to the new types).

- [ ] **Step 2: Extend `useMapMovementArrows`** to fetch both new endpoints (add to the existing `Promise.all(...)`), map them to the new ally arrow categories, and merge into the returned `arrows` array alongside the existing ones.

- [ ] **Step 3: Extend `MapMovementArrows` rendering** with distinct styling for the 3 new categories (reuse the existing color/style scheme's structure, pick colors that don't collide with existing categories).

- [ ] **Step 4: Clicking an ally arrow opens the existing `MovementDetailModal` unchanged** — verify it just needs the `movementId`, which `get_movement_cards` now authorizes for coalition members; no modal changes expected, but check `MovementDetailModal.tsx` doesn't have its own separate ownership check that would need widening too.

- [ ] **Step 5: Write/extend tests** for the new arrow categories (data mapping + rendering) and the modal opening on an ally arrow.

- [ ] **Step 6: Run full verification**

```bash
npx tsc --noEmit
npx jest --silent
```

- [ ] **Step 7: Commit**

```bash
git add lib/territories/api.ts lib/territories/useMapMovementArrows.ts components/territories/MapMovementArrows.tsx
git commit -m "feat: add coalition ally movement arrows to the map"
```

---

## Task 3: Final verification and progress update

- [ ] **Step 1:** Run `npx tsc --noEmit` and `npx jest --silent` on the full worktree; confirm clean, no regressions vs. `main`.
- [ ] **Step 2:** Update `docs/superpowers/PROGRESS.md` marking shared map visibility (coalitions phase 3) done, noting the coalitions backlog item (#30) is now fully complete across all 3 phases.
- [ ] **Step 3:** Commit the progress update.
- [ ] **Step 4:** Report completion — do NOT merge/push to `main` without explicit user approval (standing project rule).
