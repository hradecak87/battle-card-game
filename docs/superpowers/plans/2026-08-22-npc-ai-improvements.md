# NPC AI Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give NPC kingdoms four missing behaviors: garrison defense/redistribution, imperial war declaration, an automated daily card reward, and the ability to conquer unclaimed wild-garrisoned territories (villages/castles).

**Architecture:** Four independent SQL migrations, each redefining/extending functions already wired into the existing lazy `resolve_due_movements()` pipeline (no cron). Each ships with a rollback-wrapped `*.verification.sql` script (this repo's existing convention — not Jest). No frontend changes.

**Tech Stack:** PostgreSQL/PL-pgSQL (Supabase), existing repo migration conventions.

**Spec:** `docs/superpowers/specs/2026-08-22-npc-ai-improvements-design.md`

---

### Task 1: Fix war-focus targeting bug + add imperial war declaration

**Files:**
- Create: `supabase/migrations/0074_npc_imperial_war_declaration.sql`
- Create: `supabase/migrations/0074_npc_imperial_war_declaration.verification.sql`

- [ ] **Step 1: Fix the `state = 'war'` filter bug**

  In `resolve_due_npc_actions()`, the `v_focus_enemy_id` subquery (originally
  from `0067_npc_attack_cancellation.sql`) selects any `diplomacy_relations`
  row involving the NPC, without checking `state`. Redefine
  `resolve_due_npc_actions()` (full `create or replace`, copy the current
  body from `0067_npc_attack_cancellation.sql` and add the missing
  predicate) so the subquery adds `and r.state = 'war'`.

- [ ] **Step 2: Add the imperial-declaration check to the same tick**

  Still inside `resolve_due_npc_actions()`, before the existing expansion/
  attack `v_pick_roll` logic (and independent of the `v_war_roll`
  war-focus branch), add:
  - Eligibility: `select count(*) from territories where owner_id = v_npc.id` `>= 16` (half of the hardcoded 32-territory cap used throughout the codebase).
  - If eligible, roll `random() < 0.10`. If it hits:
    - Find a bordering candidate: a human player (`is_npc = false`) owning
      a territory adjacent (4-neighbor) to any of this NPC's territories,
      with `_npc_diplomacy_power(npc) >= 1.5 * _npc_diplomacy_power(candidate)`,
      not already in a `diplomacy_relations` row with this NPC (war or
      non_aggression), excluding coalition members of either side.
    - If no bordering candidate, fall back to a random non-bordering human
      player meeting the same power/relation criteria (this covers both
      the 90/10 weighting and the "fall back if one pool is empty" rule —
      implement as: try bordering pool first, if empty try the
      non-bordering pool).
    - If a candidate is found, call `_diplomacy_declare_war_core(v_npc.id, candidate_id)` (from `0064_coalition_rpcs.sql`) directly.

- [ ] **Step 3: Write the verification script**

  `0074_npc_imperial_war_declaration.verification.sql`, rollback-wrapped,
  covering:
  1. War-focus bug fix: NPC with a `non_aggression` relation (no `war`
     relation) does NOT get treated as having a focus enemy (assert
     `v_focus_enemy_id` logic no longer matches it — test indirectly via
     observing that a subsequent tick's attack does not target the NAP
     partner's territory when a clearly-worse alternative exists, or by
     directly querying the fixed subquery's SQL logic against seeded rows).
  2. Imperial declaration: seed an NPC with ≥16 territories and ≥1.5×
     power over a bordering human candidate with no existing relation;
     force the random rolls to succeed (e.g. call the extracted
     declaration logic directly if factored into a small helper function,
     to keep the test deterministic instead of looping on `random()`);
     assert a `diplomacy_relations` row with `state = 'war'` now exists.
  3. Non-eligible NPC (< 16 territories) never triggers a declaration.

- [ ] **Step 4: Apply migration + run verification live** (same pg/SUPABASE_DB_URL technique used earlier this session), confirm pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0074_npc_imperial_war_declaration.sql supabase/migrations/0074_npc_imperial_war_declaration.verification.sql
git commit -m "Add NPC imperial war declaration + fix war-focus state filter bug"
```

---

### Task 2: Garrison defense + redistribution

**Files:**
- Create: `supabase/migrations/0075_npc_garrison_reinforcement.sql`
- Create: `supabase/migrations/0075_npc_garrison_reinforcement.verification.sql`

- [ ] **Step 1: Add a new lazy periodic function**

  `resolve_due_npc_garrison_reinforcement()`, called from
  `resolve_due_movements()` right after `resolve_due_npc_actions()`. Gate
  its per-NPC work with a new `players.npc_garrison_reeval_at timestamptz`
  column (add via `alter table`), defaulting to `now()`, advanced by
  `+ interval '30 minutes'` after each run per NPC — same lazy cadence
  pattern as `npc_reeval_at` in `0067_npc_attack_cancellation.sql`.

- [ ] **Step 2: Implement the per-territory target/shortfall logic**

  For each NPC-owned territory:
  - Base target = `_npc_garrison_target_size(territory.difficulty)`.
  - If the territory has an incoming attack
    (`troop_movements` where `kind = 'attack'`, `status = 'in_transit'`,
    `destination_territory_id = territory.id`, earliest `transfer_arrives_at`
    if multiple), pick the escalation tier by time-to-arrival:
    `> 24h` → target = base; `6–24h` → target = `ceil(base * 1.5)`;
    `< 6h` → target = "as much surplus as reachable in time" (no fixed
    multiplier — iterate all surplus sources ordered by distance).
  - Current garrison count = stationed unit cards at the territory +
    unit cards on any in-transit friendly `transfer` movements already
    heading there (mirrors the existing `defender_power` in-transit sum
    in `resolve_due_npc_attack_reevaluations`, `0067`).
  - If current < target, look for surplus source territories (this NPC's
    other owned territories where `stationed count > that territory's own
    base target`), ordered by distance
    (`greatest(abs(dx), abs(dy))`), capped to 1 source for the base tier,
    2 for the 6–24h tier, unlimited for the <6h tier — and for
    attack-aware tiers, skip any source whose transfer duration to the
    target would arrive later than the attacker.
  - From each chosen source, select stationed unit cards ordered by
    highest effective defensive power first (via
    `_compute_effective_stats`, same fields used elsewhere:
    `hp+str+lng+def`), taking only as many as needed to close the
    shortfall, capped so the source never drops below its own base
    target.
  - Move the selected cards via the existing `transfer` movement
    mechanism (reuse whatever internal transfer-creation function
    player-owned transfers already use — locate it before writing this
    step, likely near `_start_claim_core`/existing transfer RPCs).

- [ ] **Step 3: Write the verification script**

  Cover: (a) an under-target, unattacked territory gets topped up from
  the nearest surplus territory to its base target; (b) an attacked
  territory arriving in 10h gets the ×1.5 target, pulling from up to 2
  sources; (c) a source is never drained below its own base target;
  (d) a reinforcement that wouldn't arrive before the attacker is skipped;
  (e) already-in-transit reinforcements are counted so a second 30-minute
  run doesn't send a duplicate wave; (f) selected cards are the
  highest-effective-power ones available, not arbitrary.

- [ ] **Step 4: Apply + verify live.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0075_npc_garrison_reinforcement.sql supabase/migrations/0075_npc_garrison_reinforcement.verification.sql
git commit -m "Add NPC garrison defense/redistribution with time-to-threat escalation"
```

---

### Task 3: Automated NPC daily reward

**Files:**
- Create: `supabase/migrations/0076_npc_daily_reward.sql`
- Create: `supabase/migrations/0076_npc_daily_reward.verification.sql`

- [ ] **Step 1: Implement `resolve_due_npc_daily_rewards()`**

  Mirror `claim_daily_reward()`'s reward logic (`0013_level_up_cards.sql`):
  for every NPC where `date_trunc('day', now()) > date_trunc('day', last_daily_reward_at)`
  or `last_daily_reward_at is null`, grant 1 random common unit card,
  advance `daily_reward_streak` the same way (reset to 1 if the previous
  claim wasn't yesterday, else +1), grant 1 random uncommon unit card
  every streak-multiple-of-7, and update `last_daily_reward_at`. Call this
  from `resolve_due_movements()` alongside the other two `resolve_due_npc_*`
  calls.

- [ ] **Step 2: Write the verification script**

  Cover: (a) NPC with no prior `last_daily_reward_at` gets a common card
  and streak = 1; (b) NPC claimed yesterday gets streak incremented; (c)
  NPC claimed today already does not get a duplicate grant this run; (d)
  streak hitting a multiple of 7 also grants an uncommon card.

- [ ] **Step 3: Apply + verify live.**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0076_npc_daily_reward.sql supabase/migrations/0076_npc_daily_reward.verification.sql
git commit -m "Add automated daily card reward for NPC kingdoms"
```

---

### Task 4: Conquering unclaimed wild-garrisoned territories

**Files:**
- Create: `supabase/migrations/0077_npc_wild_garrison_conquest.sql`
- Create: `supabase/migrations/0077_npc_wild_garrison_conquest.verification.sql`

- [ ] **Step 1: Add the third candidate query**

  Redefine `resolve_due_npc_actions()` again (full `create or replace`,
  building on Task 1's version) to add a third candidate-selection query
  alongside the existing expansion and regular-attack queries: territories
  where `owner_id IS NULL AND claim_locked_by IS NULL` and a wild garrison
  is present (mirror the `not exists (...)` check from the expansion query,
  inverted to `exists (...)`). Compare NPC attack power against
  `_territory_effective_unit_power(null, territory_id, true)` with the
  same 1.2× threshold as the existing attack path. Fold this into the
  existing `v_pick_roll` random selection alongside expansion/attack (does
  not touch the separate `v_war_roll` branch). Execute via the same
  `_declare_attack_core(...)` call already used for regular attacks.

- [ ] **Step 2: Write the verification script**

  Cover: (a) NPC with sufficient power attacks a wild-garrisoned unclaimed
  territory via `_declare_attack_core` (assert a battle/attack movement
  was created targeting it); (b) NPC with insufficient power does not
  attempt it; (c) the existing expansion/regular-attack candidate pools
  are unaffected by this addition.

- [ ] **Step 3: Apply + verify live.**

- [ ] **Step 4: Update `docs/superpowers/PROGRESS.md`** with an entry
  summarizing all 4 tasks (root cause/goal, migrations 0074–0077, verified
  live).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0077_npc_wild_garrison_conquest.sql supabase/migrations/0077_npc_wild_garrison_conquest.verification.sql docs/superpowers/PROGRESS.md
git commit -m "Let NPCs conquer unclaimed wild-garrisoned territories (villages/castles)"
```

---

## Notes for the implementing agent

- All four tasks redefine or build on `resolve_due_npc_actions()` /
  `resolve_due_movements()`. Apply and verify Task 1 live before starting
  Task 4 (which further redefines the same function) to avoid clobbering
  each other's changes — do the tasks in numeric order.
- Use the established live-DB diagnostic/apply technique from this
  session: a temporary Node.js script + the `pg` npm package + `.env.local`'s
  `SUPABASE_DB_URL` (regex-parsed, no `dotenv` installed) to apply migration
  SQL and run `.verification.sql` scripts (each is `begin; ... rollback;`
  wrapped) against the live DB. Delete the temp script afterward.
- No Jest/frontend changes are expected. If any are discovered as
  necessary, stop and flag it rather than silently expanding scope.
- Do not commit any task until its own verification script has passed live.
