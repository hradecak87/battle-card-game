# NPC AI Improvements — Design

Date: 2026-08-22
Status: Approved by user (conversational sign-off), pending spec review

## Context

The NPC kingdom AI (`resolve_due_npc_actions()` and related functions in
`0027_npc_kingdoms.sql`, `0048_npc_contiguous_expansion.sql`,
`0050_npc_diplomacy.sql`, `0067_npc_attack_cancellation.sql`) currently:

- Runs once per NPC on a randomized 4–12h tick (`players.npc_next_action_at`).
- Each tick picks **either** an expansion (claim a free, ungarrisoned
  territory — 70% weight when available) **or** an attack (only if NPC power
  ≥ 1.2× the target's effective defensive power).
- Already re-evaluates its own in-flight attacks every 30 minutes
  (`troop_movements.npc_reeval_at`, from `0067_npc_attack_cancellation.sql`)
  and cancels them if the odds have turned unfavorable.
- Already prioritizes attacking territories owned by an active war opponent
  80% of the time when one exists (`v_focus_enemy_id` in
  `resolve_due_npc_actions()`, `0067`).
- Already accepts/rejects incoming peace offers based on a power ratio
  (`resolve_due_npc_diplomacy()`, `0050_npc_diplomacy.sql`).
- Already grants unit cards on every level-up for **any** player, NPC
  included, since `_award_xp()` (`0013_level_up_cards.sql`) is not gated on
  `is_npc`.

Four gaps were identified and are addressed by this design:

1. NPC never reinforces or redistributes its own garrisons — a territory
   under attack just sits with whatever garrison it already has.
2. NPC has no way to initiate war on its own; war today only ever starts as
   a side effect of an attack (`_declare_attack_core`,
   `0045_diplomacy_war_creation.sql`).
3. NPC has no automated equivalent of the player-facing daily login reward
   (`claim_daily_reward()`, `0013_level_up_cards.sql`), which is gated on
   `auth.uid()` and therefore unusable by a server-side NPC tick.
4. NPC never targets an unclaimed territory that has a "wild" garrison
   (e.g., an unclaimed village/castle) — both the expansion query (excludes
   any territory with a wild garrison) and the attack query (requires
   `owner_id is not null` or `claim_locked_by is not null`) skip this case
   entirely, even though `_declare_attack_core` already fully supports
   attacking such a territory for human players (see
   `target_is_empty_claimable` in `0025_multi_origin_attack.sql`).

Two related ideas surfaced during discussion but are explicitly **out of
scope** for this design and logged as separate backlog todos instead:

- `battle-army-size-limit` (already existed).
- `npc-forward-base-staging`: NPC should claim a nearby unclaimed territory
  as a forward staging point before launching long-distance attacks, rather
  than attacking directly from a far-away origin. This is a distinct
  strategic-logistics feature and needs its own brainstorming pass.

## 1. Garrison defense + redistribution

**Goal:** NPC keeps every owned territory garrisoned close to its "target"
size, and proactively reinforces a territory under attack — sending
multiple waves over time as more troops become available, similar to how a
human player would react.

**Mechanism:**

- Reuse the existing `_npc_garrison_target_size(p_difficulty)` function
  (`0054_cap_wild_garrison_growth.sql`) as the baseline "how many units
  should defend this territory" figure.
- Add a new lazy, periodic check — same cadence and same lazy-execution
  pattern as the existing 30-minute `npc_reeval_at` attack-cancellation
  check (called from `resolve_due_movements()`, no cron/scheduler). Every
  NPC-owned territory below its target garrison size is a candidate for
  reinforcement.
- **Escalation by time-to-threat**, evaluated per candidate territory:
  - **No known attack, or attack arrives in > 24h:** pull from the single
    nearest NPC-owned territory that has surplus (garrison above its own
    target), for the normal target garrison size.
  - **Attack arrives in 6–24h:** target garrison size × 1.5; pull from up
    to 2 nearest territories with surplus.
  - **Attack arrives in < 6h ("poplach"):** target = as much surplus as can
    be gathered; pull from any number of surplus territories, ordered by
    distance, nearest first.
  - **Hard constraint for all three tiers:** a candidate source is only
    used if the resulting reinforcement transfer would arrive **before**
    the attacker (`transfer duration ≤ time remaining until attacker's
    `transfer_arrives_at`), otherwise it's skipped — sending troops that
    arrive after the battle already happened is pointless.
- A source territory is only depleted down to *its own* target garrison
  size (from `_npc_garrison_target_size`), never below — so reinforcing one
  border territory can't strand a neighboring one.
- Reinforcements move via the existing `transfer` movement kind — the same
  mechanism used for player-to-player and player's-own-territory troop
  transfers.
- Because this reevaluation runs every 30 minutes for every under-target
  territory (not just once when an attack is first detected), reinforcement
  naturally happens in multiple waves as more troops become available
  nearby over time — mirroring the "reinforce again if the attacker doesn't
  cancel" behavior a human player already does manually.
- **No knowledge of attacker composition is used or needed** — this design
  deliberately never reads the incoming attack's card list. It only reads
  what a human defender can also see: who's attacking, and when they'll
  arrive (`get_incoming_attacks_on_my_territories()`, already exposes
  exactly this and nothing more). Reinforcement sizing is driven purely by
  the territory's own target garrison size, not by the attacker's strength.
- As a side effect, territories that are never attacked also end up with
  their target garrison size over time, since the same reevaluation applies
  regardless of attack status (with the "no known attack" tier) — this
  covers the original "spread garrisons everywhere" idea without needing a
  second, separate mechanic.

## 2. Imperial war declaration

**Goal:** A sufficiently large/strong NPC occasionally declares war on a
human player without first attacking, representing an "imperial" ambition
distinct from the already-implemented reactive/opportunistic attack
behavior.

**Mechanism:**

- Eligibility: NPC must own **≥ half of the max territory cap** (today
  16 of the hardcoded 32-territory limit used throughout the codebase, e.g.
  `0002_territories.sql` line 324 and dozens of call sites) **and** have
  ≥ 1.5× the military power of the candidate target, using the existing
  `_npc_diplomacy_power()` metric (`0050_npc_diplomacy.sql`).
- Candidate selection: primarily a bordering human player (has an adjacent
  territory) not already at war with this NPC and without an active
  coalition/non-aggression relation — this is the common case, given a
  higher relative probability. Sporadically (low probability), a
  non-bordering human player meeting the same power criteria is also
  considered, so NPCs aren't strictly limited to immediate neighbors.
- Trigger: at each NPC tick (still the existing 4–12h
  `npc_next_action_at` cadence), if eligible, there's a small probability
  (~10%) the NPC evaluates this and, if a candidate is found, calls the
  same underlying war-creation logic as `diplomacy_declare_war()` (adjusted
  to allow an NPC caller and a human target — today's
  `diplomacy_declare_war()` is player-only via `diplomacy_require_player()`
  and only supports human callers).
- No attack is launched by this action alone — it's purely the diplomatic
  state change (`diplomacy_relations` row + `war_declared` world event +
  notification), mirroring `diplomacy_declare_war()`'s side effects.
- Once war exists (whether from this new path or the existing
  attack-triggered path), the **already-implemented** war-focus targeting
  in `resolve_due_npc_actions()` (`v_focus_enemy_id`, 80% priority) takes
  over — no changes needed there.

## 3. Automated NPC daily reward

**Goal:** NPC accumulates cards over time similarly to how an active human
player does, via the same daily-reward mechanic, without needing a login.

**Mechanism:**

- New function mirroring `claim_daily_reward()`'s reward logic (1 random
  common unit card per day, plus 1 random uncommon unit card every 7-day
  streak), but keyed by NPC id instead of `auth.uid()`, and driven by the
  same `players.daily_reward_streak` / `players.last_daily_reward_at`
  columns already present on every player row (added in
  `0013_level_up_cards.sql`, not gated on `is_npc`).
- Runs as part of the existing lazy tick infrastructure (called from
  `resolve_due_movements()`, no cron): for every NPC where a day has
  elapsed since `last_daily_reward_at` (or it was never set), grant the
  reward and advance the streak exactly like `claim_daily_reward()` does.
- Level-up card grants need no changes — `_award_xp()` already applies to
  NPCs today.

## 4. Conquering unclaimed wild-garrisoned territories

**Goal:** NPC can attack (not just ignore) unclaimed territories that have
a wild garrison (e.g. an unclaimed village/castle), since these are also a
significant source of capturable cards.

**Mechanism:**

- Add a third candidate-selection query to `resolve_due_npc_actions()`,
  alongside the existing expansion and attack candidate queries: territories
  where `owner_id IS NULL AND claim_locked_by IS NULL` **and** a wild
  garrison unit is present (mirrors the `not exists (...)` wild-garrison
  check already used by the expansion query, just inverted).
- Power comparison: same 1.2× threshold as the existing attack path,
  comparing NPC attack power against
  `_territory_effective_unit_power(null, territory_id, true)` — this
  function already supports a `null` owner id for wild-garrison defenders,
  no changes needed there.
- Execution: call the existing `_declare_attack_core()` exactly as the
  current attack path does — it already auto-detects that a wild-garrisoned
  unclaimed territory is not "empty claimable" and routes through the
  battle path (`target_is_empty_claimable` check in
  `0025_multi_origin_attack.sql`).
- This new candidate pool participates in the same weighted random pick
  (`v_pick_roll`) as the existing expansion/attack/war-focus candidates —
  no separate priority tier is introduced; it's simply one more type of
  attack target discovered by the search.

## Testing

Each of the four pieces gets a `*.verification.sql` script following this
repo's existing convention (rollback-wrapped `begin; ... rollback;` SQL
scripts with real INSERT/UPDATE/assert statements, run manually against a
live/test Postgres connection — not part of the Jest suite). No frontend
changes are anticipated; these are all server-side `resolve_due_*` function
changes.
