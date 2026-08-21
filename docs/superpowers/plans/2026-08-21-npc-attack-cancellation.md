# NPC Attack Cancellation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NPC attackers periodically (lazily, every 30 min per in-transit NPC attack) re-check whether the target's defense (garrison + timely reinforcements) has grown enough to drop the NPC's estimated win probability below 45%, and if so, recall the attack.

**Architecture:** New migration `0067_npc_attack_cancellation.sql`. Extract `_recall_attack_core(p_movement_id, p_caller)` from `recall_attack` (no `resolve_due_movements`/`resolve_due_battles` bootstrap calls inside `_core` — those stay in the public wrapper only, to avoid recursive re-entry). Add a new `_movement_unit_power(p_movement_id, p_is_defender, p_territory_id default null)` helper for computing power of in-transit card instances (attacker's outgoing movement, or a reinforcement transfer). Add `troop_movements.npc_reeval_at`. New `resolve_due_npc_attack_reevaluations()` function, called from `resolve_due_movements()` alongside the existing NPC loops. Extend `notifications.type` with `'attack_cancelled'`. Pure TS probability helpers in `lib/npc/kingdoms.ts`.

**Tech Stack:** Postgres/plpgsql (Supabase migrations), TypeScript (pure helpers + Jest tests). Spec: `docs/superpowers/specs/2026-08-21-npc-attack-cancellation-design.md`.

---

### Task 1: Pure TS probability helpers

**Files:**
- Modify: `lib/npc/kingdoms.ts`
- Test: `lib/npc/kingdoms.test.ts`

- [ ] Add `NPC_ATTACK_CANCEL_RATIO = 11 / 9` constant next to existing `NPC_ATTACK_POWER_RATIO`.
- [ ] Add `attackerWinProbability(attackerPower: number, defenderPower: number): number` returning `attackerPower / (attackerPower + defenderPower)` (return `1` when both are `0` to avoid `NaN`, matching "no defenders = certain win").
- [ ] Add `shouldNpcCancelAttack(attackerPower: number, defenderPower: number): boolean` returning `defenderPower > NPC_ATTACK_CANCEL_RATIO * attackerPower`.
- [ ] Write tests: exactly-at-threshold (no cancel), just-above-threshold defender power (cancel), zero defender power (never cancel), symmetry check against `attackerWinProbability` (`shouldNpcCancelAttack` true iff `attackerWinProbability < 0.45`).
- [ ] Run `npx jest lib/npc/kingdoms.test.ts` — expect all passing.
- [ ] Commit: `feat(npc): add attack-cancellation probability helpers`.

### Task 2: Migration — schema, `_movement_unit_power`, `_recall_attack_core` extraction

**Files:**
- Create: `supabase/migrations/0067_npc_attack_cancellation.sql`
- Create: `supabase/migrations/0067_npc_attack_cancellation.verification.sql`

- [ ] `alter table troop_movements add column npc_reeval_at timestamptz;` + partial index `troop_movements (npc_reeval_at) where status = 'in_transit'`.
- [ ] `create or replace function _movement_unit_power(p_movement_id uuid, p_is_defender boolean, p_territory_id integer default null) returns numeric` — join `troop_movement_units` → `card_instances` → `card_templates` (unit category only) → owning `players.nation`; sum `_compute_effective_stats(...)` (`hp+str+lng+def`), passing `p_territory_id`'s `castle_rank/village_rank/wall_rank` only when `p_is_defender` (else `null`), mirroring `_territory_effective_unit_power`'s pattern. `security definer`.
- [ ] Extract `_recall_attack_core(p_movement_id uuid, p_caller uuid) returns void` from the current `recall_attack` body (source: `0035_wire_world_events.sql`) — **omit** the `perform resolve_due_movements(); perform resolve_due_battles();` lines (those stay only in the public wrapper). Redefine public `recall_attack(p_movement_id uuid)` to keep the bootstrap calls, resolve `auth.uid()`, and delegate to `_recall_attack_core(p_movement_id, caller)`.
- [ ] `create or replace function resolve_due_npc_attack_reevaluations() returns void security definer` — loop `troop_movements` where `kind='attack'`, `status='in_transit'`, `player_id`'s `players.is_npc = true`, `npc_reeval_at <= now()`, `for update`; wrap each iteration body in `begin ... exception when others then raise log ...; end;` (mirror `resolve_due_npc_actions` per-row guard) so one bad row can't abort the batch:
  - compute attacker power via `_movement_unit_power(movement.id, false)`.
  - compute defender power: `_territory_effective_unit_power(target_owner_id, target_territory_id, true)` + `sum(_movement_unit_power(reinforcement.id, true, target_territory_id))` over qualifying `kind='transfer'`/`status='in_transit'` rows with `destination_territory_id = target` and `transfer_arrives_at <= this_movement.transfer_arrives_at`.
  - if `defender_power > (11.0/9.0) * attacker_power`: call `_recall_attack_core(movement.id, movement.player_id)`, then insert `notifications` row (`type = 'attack_cancelled'`, target owner as `player_id`, payload with territory id/x/y/name + NPC attacker's `display_name`).
  - else: `update troop_movements set npc_reeval_at = now() + interval '30 minutes' where id = movement.id`.
- [ ] Also set `npc_reeval_at = now() + interval '30 minutes'` at NPC-attack creation time. `_declare_attack_core` (latest def in `0045_diplomacy_war_creation.sql`) **already `returns uuid`** (`returning id into movement_id; return movement_id;`) — no redefinition needed. There are **two separate NPC-attack call sites** in `resolve_due_npc_actions()` (`0050_npc_diplomacy.sql`, the "focus enemy" branch and the general attack-target branch), both currently `perform _declare_attack_core(...)`. At **both** sites, change to `select _declare_attack_core(...) into v_movement_id;` (declare `v_movement_id uuid`) then `update troop_movements set npc_reeval_at = now() + interval '30 minutes' where id = v_movement_id;` right after.
- [ ] Use the existing `_notify(p_player_id, p_type, p_payload)` helper (see `0050_npc_diplomacy.sql`/`_declare_attack_core` usage) for the `attack_cancelled` notification, not a raw `insert into notifications`, for consistency with every other notification-producing code path.
- [ ] Add `perform resolve_due_npc_attack_reevaluations();` to `resolve_due_movements()` (source: `0056_notifications.sql`), alongside the existing `perform resolve_due_npc_actions(); perform resolve_due_npc_diplomacy();` lines.
- [ ] Extend the `notifications.type` check constraint (drop + re-add, or `alter table ... drop constraint ... add constraint ...`) to include `'attack_cancelled'`.
- [ ] `revoke execute ... from public, anon, authenticated; grant execute ... to service_role;` on `_movement_unit_power`, `_recall_attack_core`, `resolve_due_npc_attack_reevaluations` (internal-only, same convention as other `_core`/NPC helpers).
- [ ] Verification script (rollback-wrapped, mirror `0050_npc_diplomacy.verification.sql` setup conventions): seed one NPC attacker + one human defender with territories/cards via existing onboarding-core helpers; insert the NPC attack `troop_movements`/`troop_movement_units` row(s) directly (or via a direct `_declare_attack_core` call) with a controlled `transfer_arrives_at`, not via `resolve_due_npc_actions()` random selection, to keep scenarios deterministic. Scenarios:
  1. Defender sends a reinforcement transfer arriving before the NPC attack → run `resolve_due_npc_attack_reevaluations()` directly with `npc_reeval_at` forced to `now()` → assert movement `status = 'cancelled'`, a `transfer` return movement exists, `battle_locked_by` cleared, a `notifications` row with `type='attack_cancelled'` exists for the defender, and a `world_events` row with `event_type='attack_recalled'` exists.
  2. Reinforcement arrives *after* the NPC attack's `transfer_arrives_at` → same re-eval → assert movement still `in_transit` and `npc_reeval_at` advanced by ~30 minutes.
  3. Regression: existing player-triggered `recall_attack` RPC still works unchanged (call it directly, assert same outcome as before this migration).
- [ ] Apply migration + verification live via the established temp-Node-script pattern (`.env.local` parsed with `/\r?\n/`, `pg` + `SUPABASE_DB_URL`); delete the temp script afterward.
- [ ] Commit: `feat(npc): cancel NPC attacks when defense reinforcements drop win chance below 45%`.

### Task 3: Final verification

- [ ] `npx tsc --noEmit` — expect clean.
- [ ] `npx jest --silent` — expect full suite green (no regressions).
- [ ] Update `docs/superpowers/PROGRESS.md` backlog entry for this feature (mark done, one line, reuse existing table format).
- [ ] Commit: `docs: mark NPC attack cancellation done in PROGRESS.md`.
