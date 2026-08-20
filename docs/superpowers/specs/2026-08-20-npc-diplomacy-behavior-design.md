# NPC Diplomacy & War-Focus Behavior — Design

Status: Approved (2026-08-20)

## Problem

NPCs already expand into unclaimed territory and attack players/other NPCs
(`resolve_due_npc_actions()`, shipped in `npc-contiguous-expansion`). Attacking
a human player automatically creates a `diplomacy_relations` war row
(`_declare_attack_core`, `0045_diplomacy_war_creation.sql`) — but NPCs never
do anything about that war afterwards. They never propose peace, never
respond to peace offers a human sends them, and they keep splitting their
turns between expansion and attack exactly as if no war existed. This makes
NPC wars either permanent stalemates (nobody ever proposes peace) or
one-sided (a human can attack an NPC in-and-out with no diplomatic or
strategic consequence).

This feature adds two related behaviors:

1. **NPC diplomacy**: NPCs autonomously propose peace to enemies they're
   losing to, and autonomously accept/reject incoming peace offers from
   humans.
2. **NPC war focus**: while at war, an NPC redirects most of its turns from
   expansion to attacking its war opponent, instead of splitting attention
   evenly.

## Non-goals

- NPC-vs-NPC wars: out of scope. `_declare_attack_core` already never
  creates a war relation when the target owner is an NPC, so NPC-vs-NPC wars
  cannot occur today and this feature does not change that.
- Any change to the human-facing diplomacy UI or RPC contracts. Peace offers
  from NPCs appear in the existing UI exactly like offers from any other
  player — no new UI work.
- Alliance/non-aggression-pact mechanics, multi-party diplomacy, or any
  negotiation beyond the existing binary white/tribute peace offer kinds.

## Power metric

New SQL function `_npc_diplomacy_power(p_player_id uuid) returns numeric`:
sums `(str + lng + def + hp)` across **all** of a player's `stationed` unit
`card_instances`, anywhere on the map, with the rank multiplier applied but
**no** contextual bonuses (no castle/village/wall rank, no nation bonus).
Reuses the existing `_compute_effective_stats(base_stats, rank, nation,
is_defender, castle_rank, village_rank, wall_rank)` helper, called with
`nation = null`, `is_defender = false`, and the three structure-rank
parameters `null`:

```sql
create or replace function _npc_diplomacy_power(p_player_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(e.hp + e.str + e.lng + e.def), 0)
  from card_instances ci
  join card_templates ct
    on ct.id = ci.template_id
   and ct.category = 'unit'
  cross join lateral _compute_effective_stats(
    ct.base_stats, ct.rank, null, false, null, null, null
  ) e
  where ci.owner_id = p_player_id
    and ci.status = 'stationed'
$$;
```

This is a simple, cheap, whole-army metric — deliberately not the
per-territory `_territory_effective_unit_power` used for attack-eligibility
checks (that one is scoped to a single origin/target territory and includes
structure bonuses, which is right for "can this specific army capture this
specific territory" but wrong for "who's winning this war overall").

Used as a ratio: `power(a) / power(b)`. If the denominator is `0`, treat the
ratio as `+infinity` when the numerator is `> 0` (a is overwhelmingly
stronger with no valid target territories left for b — should not normally
happen since a player losing their last territory loses the game, but guard
against a race/edge case), and `1.0` (even) if both are `0`.

## Schema changes

### `npc_diplomacy_state` (new singleton table)

```sql
create table npc_diplomacy_state (
  id boolean primary key default true check (id),
  last_run_at timestamptz
);

insert into npc_diplomacy_state (id, last_run_at) values (true, null);

alter table npc_diplomacy_state enable row level security;
revoke all on npc_diplomacy_state from public, anon, authenticated;
```

Single row, gates the hourly diplomacy tick (see below). Mirrors the
existing `npc_next_action_at` per-NPC staggering column, but diplomacy
decisions are evaluated for **all** NPCs together on a single shared
hourly cadence rather than per-NPC staggered timers — the tick itself is
cheap (bounded by number of active wars, not by map size), so a shared timer
is simpler and sufficient.

### `diplomacy_offers` / `diplomacy_relations`

No schema changes. Existing tables/columns are reused as-is.

## RPC refactor: `_core` pattern

Extract the body of each of the three caller-mutating diplomacy RPCs into an
internal `_core` function parameterized by an explicit `p_caller_id`, mirroring
the existing `_declare_attack_core` / `_start_claim_core` pattern used by
`resolve_due_npc_actions()`:

- `diplomacy_propose_peace(p_target_id, p_kind, p_offered_card_ids,
  p_offered_territory_id)` → thin wrapper: resolves `v_caller :=
  diplomacy_require_player()`, then `return
  _diplomacy_propose_peace_core(v_caller, p_target_id, p_kind,
  p_offered_card_ids, p_offered_territory_id)`.
- `diplomacy_accept_peace(p_offer_id)` → wrapper delegating to
  `_diplomacy_accept_peace_core(v_caller, p_offer_id)`.
- `diplomacy_reject_peace(p_offer_id)` → wrapper delegating to
  `_diplomacy_reject_peace_core(v_caller, p_offer_id)`.

Each `_core` function is the exact existing function body, with every
`v_caller` reference now sourced from the `p_caller_id` parameter instead of
`diplomacy_require_player()`. No behavior change for the existing validation
logic (ownership checks, pending-offer checks, tribute validation, etc.) —
this is a pure extraction refactor. `_core` functions are **not** granted to
`anon`/`authenticated` (same as `_declare_attack_core` today); they're only
callable from other `SECURITY DEFINER` functions (`resolve_due_npc_diplomacy`,
and the public wrappers themselves).

`diplomacy_cancel_peace` is **not** touched — NPCs never cancel their own
offers in this design (no NPC behavior needs it), so it's left as-is.

## `resolve_due_npc_diplomacy()` — hourly tick

Wired into the existing lazy-tick chain: `resolve_due_movements()` gains one
new line, `perform resolve_due_npc_diplomacy();`, alongside its existing
`perform resolve_due_npc_actions();` call. The function itself gates its own
cadence:

```sql
create or replace function resolve_due_npc_diplomacy()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_run timestamptz;
  ...
begin
  select last_run_at into v_last_run from npc_diplomacy_state where id = true for update;
  if v_last_run is not null and v_last_run > now() - interval '1 hour' then
    return;
  end if;
  update npc_diplomacy_state set last_run_at = now() where id = true;

  -- Step A, then Step B (below)
end;
$$;
```

### Step A — respond to incoming peace offers

For every `pending` row in `diplomacy_offers` where `target_id` is an NPC
(`players.is_npc = true`):

```
ratio := _npc_diplomacy_power(target_npc_id) / nullif(_npc_diplomacy_power(initiator_id), 0)
has_tribute := coalesce(array_length(offered_card_ids, 1), 0) > 0 or offered_territory_id is not null

if has_tribute or ratio < 1.2:
  perform _diplomacy_accept_peace_core(target_npc_id, offer_id)
else:
  perform _diplomacy_reject_peace_core(target_npc_id, offer_id)
```

Each offer resolution is wrapped in its own `begin/exception when others`
block (mirroring `resolve_due_npc_actions()`'s per-NPC error isolation) so
one bad offer (e.g. a race where the war was already resolved) doesn't abort
the whole tick.

### Step B — propose peace for active wars

For every active war row in `diplomacy_relations` where at least one side is
an NPC and the other side is a human (this is every war row today, since
NPC-vs-NPC wars can't exist):

```
skip if the NPC already has a pending outgoing offer to that opponent
  (mirrors the existing unique-pending-offer check diplomacy_propose_peace
   already enforces, checked here first to avoid a raised/caught exception
   on every tick for wars already offered)

ratio := _npc_diplomacy_power(npc_id) / nullif(_npc_diplomacy_power(opponent_id), 0)
lost_recently := exists (
  select 1 from world_events
  where event_type = 'battle_won'
    and payload->>'loser_id' = npc_id::text
    and payload->>'winner_id' = opponent_id::text
    and created_at > now() - interval '24 hours'
)

if ratio < 0.6 or lost_recently:
  if ratio < 0.4:
    card_count := case
      when ratio < 0.2 then 3
      when ratio < 0.3 then 2
      else 1
    end
    offered_card_ids := <card_count weakest currently-stationed unit cards
                          owned by the NPC, ordered by rank asc then by
                          (str+lng+def+hp) asc, id asc for determinism>
    perform _diplomacy_propose_peace_core(npc_id, opponent_id, 'tribute_peace', offered_card_ids, null)
  else:
    perform _diplomacy_propose_peace_core(npc_id, opponent_id, 'white_peace', '{}', null)
```

If an NPC is party to multiple simultaneous wars, each war is evaluated
independently in this loop — there's no "focus" concept needed here (that's
only relevant for the *attack* behavior in Step 4 below); an NPC can propose
peace to more than one opponent in the same tick if more than one qualifies.

Per-war resolution is likewise wrapped in its own exception-isolating block.

## War focus in `resolve_due_npc_actions()`

`resolve_due_npc_actions()` gains a new branch evaluated **before** its
existing adjacent-tier/random-tier expansion+attack selection, for any NPC
with at least one row in `diplomacy_relations`:

1. If the NPC has one or more active wars, roll `v_war_roll := random()`.
2. If `v_war_roll < 0.8`:
   - Pick the "focus enemy" = the opponent (across all the NPC's active
     wars) with the lowest `_npc_diplomacy_power(opponent_id)`.
   - Search for an attack target restricted to territories owned by that
     focus enemy specifically (`target.owner_id = v_focus_enemy_id`),
     anywhere on the map — reusing the existing sampled-candidate +
     nearest-origin-by-distance + `_territory_effective_unit_power(...) >=
     ... * 1.2` eligibility logic, just with the owner filter narrowed to
     one specific player instead of "anyone but me".
   - If a valid target is found, attack it via `_declare_attack_core` and
     skip the rest of the tick's expansion/normal-attack logic entirely.
   - If no valid target is found (e.g. the focus enemy currently has no
     territory the NPC's power ratio allows attacking), fall through to
     the existing normal behavior for this tick unchanged.
3. If `v_war_roll >= 0.8` (20% of war-ticks) or the NPC has no active wars,
   run the existing adjacent-tier/random-tier expansion+attack logic
   completely unchanged.

This only changes the *targeting* of the attack half of existing behavior;
the expansion logic, the 90/10 adjacent-vs-random tiering inside each half,
the `_declare_attack_core` call itself, and the `npc_next_action_at`
rescheduling at the end of the loop are all unchanged.

## Testing

- SQL: extend/add `.verification.sql` files (following the project's
  existing convention, e.g. `0049_npc_diplomacy.verification.sql`) covering:
  `_npc_diplomacy_power` returns 0 for a player with no stationed units and
  correctly sums a small fixture army; the `_core` refactor doesn't change
  behavior for a normal human propose/accept/reject flow (regression); an
  NPC losing a war with `ratio < 0.6` gets a pending white-peace offer
  created after calling `resolve_due_npc_diplomacy()`; an NPC with
  `ratio < 0.4` gets a tribute offer with the right card count; an NPC
  target automatically accepts a tribute offer regardless of ratio; an NPC
  target rejects a white-peace offer when `ratio >= 1.2`; calling
  `resolve_due_npc_diplomacy()` twice within the same hour is a no-op the
  second time; an NPC at war attacks the focus enemy's territory instead of
  expanding when the war-roll favors it (seed the RNG or run enough
  iterations to observe the ~80% split, matching the existing
  `resolve_due_npc_actions` test style if one exists, otherwise a
  statistical/tolerance-based check).
- No TypeScript unit tests are needed for this feature — all new logic is
  server-side SQL (unlike `lib/npc/kingdoms.ts`'s pure-TS helpers, which
  exist to support a client-side preview UI; this feature has no client-side
  preview or TS mirror requirement).

## Rollout

- New migration file(s), e.g. `0049_npc_diplomacy.sql` (+ matching
  `.verification.sql`), following the existing migration-numbering
  convention.
- Applied the same way as prior migrations in this project (Supabase CLI /
  direct SQL apply) — no data backfill needed since `npc_diplomacy_state`
  starts with `last_run_at = null` (tick runs immediately on first
  invocation) and no existing rows need to change.
- No environment/config changes, no new npm dependencies.
