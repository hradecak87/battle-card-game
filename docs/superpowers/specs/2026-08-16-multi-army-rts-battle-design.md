# Multi-Army RTS Battle — Design Spec

## 1. Overview

This is subsystem #4 of the medieval card-battle web game (Battle Card Game
V2), built on top of subsystem #1 (Card Collection & Combat Core), subsystem
#2 (Players & Accounts), and subsystem #3 (Territory Map), all already
implemented and deployed to a live Supabase project.

This spec covers exactly what subsystem #3 explicitly deferred:

- Declaring an attack against an NPC-garrisoned or player-owned territory
  (including a player's home territory — loot only, never capturable).
- The round-by-round live combat loop: attacker's pool is fixed at
  declaration time, one random attacker card per round vs. any defender
  card the defending player chooses; a 120-second per-round decision
  window with an automatic random pick on timeout.
- Card capture: the loser of each individual duel's card changes ownership
  to the round's winner immediately (not batched to end-of-battle). Both
  cards involved in a round enter a 2-round "rest" cooldown regardless of
  which one won.
- The "must both be online" real-time requirement for player-vs-player
  battles, its 10-day ready timeout, and the "didn't show up at the same
  time" tie-break (attacker wins).
- Territory capture on victory (subject to the existing 32-territory cap —
  an attack that would result in capture is blocked outright if the
  attacker is already at the cap; attacking a target only for loot, e.g. a
  home territory, is never blocked by the cap).
- Contested empty-land claims: a second player attacking a tile another
  player is still occupying (subsystem #3 §6) triggers this same
  battle flow between the two claimants. This requires amending
  subsystem #3's `start_claim` guard (§3.6 below).
- **Bugfix carried over from subsystem #3**: `start_claim` currently only
  checks `owner_id is null and claim_locked_by is null` — it does not
  check for an NPC garrison, so today a player could peacefully "claim" a
  castle/village tile that has NPC defenders stationed on it, with no
  combat at all. This spec closes that gap (§3.6).
- Applying Castle/Village structure bonuses (already computed and sitting
  idle in `lib/territories/structureBonus.ts`) and the four still-unapplied
  nation combat perks (England/Francia/HRE/Byzantium — Mongol Horde and
  Scandinavia were already applied in subsystem #3) to each duel's
  effective stats.

**Out of scope** (explicitly deferred further):

- Trading/exchange of cards outside of combat (subsystem #5).
- Any notification mechanism beyond in-app visibility on the map — no
  email/push (subsystem #6).
- **Interfering** with another pair of players' battle (still not
  allowed, per the original brief: "jiní hráči nemohou zasahovat" — this
  is about *acting*, not viewing; see §3.6's RLS note, which keeps
  battles publicly readable, consistent with `battle_locked_by` being a
  publicly-visible map flag).

## 2. Battle lifecycle

```
declare_attack (attacker picks a fixed roster of unit-card instances
                stationed at one of their own territories, and a target
                territory that is not their own home)
      │
      ▼
troop_movement (kind='attack', same transferHours(distance, nation)
                formula subsystem #3 already uses for regular transfers —
                visible to everyone on the map as "under attack", same
                visual pattern as claim_locked_by)
      │  arrives after transfer time
      ▼
battles row created, status='awaiting_ready' (skipped entirely for NPC
      │  targets — an NPC "defender" is always ready; goes straight to
      │  'active')
      │
      │  10-day ready_deadline. Both players must mark ready while online.
      │    - neither ready in time            → attack lapses, troops return home, no capture, no card loss
      │    - only one ever readied             → that player wins outright (territory captured if applicable)
      │    - both readied but never overlapped → attacker wins outright
      │    - both online & ready at once       → status='active'
      ▼
live round loop (status='active')
      round N: pick 1 random available (not resting) card from the
               attacker's fixed roster that attacker still owns
               → defender picks any available (not resting) unit-card
                 instance they currently own at that territory
                 (120s window; auto-random-pick on timeout)
               → resolveDuel(effectiveStats) with structure/nation bonuses
                 applied to each side's card per its *current* owner
               → loser's card ownership flips to the round's winner
               → both cards enter 2-round rest (battle_unit_rest)
               → if no card is available for whichever side must supply
                 one this round, the round is skipped (no duel), but the
                 round counter still advances (so rests keep ticking down)
      loop until either side has zero cards remaining (period — resting
      still counts as "remaining", only "available this round" excludes it)
      ▼
battle resolved: status='resolved', winner_side set
      - is_home_target=true                  → no ownership change (never capturable); every card_instance currently owned by the attacker and stationed at territory_id (fixed roster survivors *and* any defender cards captured mid-battle) is sent home via a return troop_movement
      - otherwise, attacker wins & not at the 32-territory cap → territory ownership transfers to attacker (owner_id=attacker, claim_locked_by and battle_locked_by both cleared); every card_instance stationed at territory_id simply stays there as the new garrison (all of them are, by the win condition below, already owned by the attacker — no travel needed)
      - otherwise (defender wins, or attacker capped)          → territory stays with defender/NPC; by the win condition below the attacker has zero cards left owned by them at territory_id, so there is nothing left to send home
```

**Contested empty-land claims** (subsystem #3 §6): classification of
what/whom the attacker is fighting happens **at arrival time**
(`resolve_due_movements()`, §3.6), not at `declare_attack` time — the
target territory's state (owner, claim, NPC garrison) can change during
the travel window, so re-checking fresh state on arrival is the only
point that's actually correct. If, on arrival, the territory is
`owner_id is null` and `claim_locked_by is not null and != attacker`,
this is a contested claim: a `battles` row is created with
`defender_id = claim_locked_by` (call them A), `attacker_id` = the
arriving player (B), `is_home_target = false`. A's original claim
`troop_movements` row and `territories.claim_locked_by` are left
completely untouched while the battle plays out:
- **If B wins**: the general resolution rule above already covers this
  — territory ownership transfers to B and `claim_locked_by` is cleared
  as part of that same write, so A's now-stale claim can never later
  complete and clobber B's fresh ownership.
- **If A wins**: nothing about A's claim was ever touched, so it simply
  keeps progressing (or may have already silently completed mid-battle,
  which is harmless) on its own pre-existing schedule via the ordinary
  claim-completion branch of `resolve_due_movements()` — A needs no
  fresh claim or special-cased "resume" logic.
B's committed troops follow the same per-duel card-loss rules as any
other battle regardless of outcome.

## 3. Data model

### 3.1 `battles`

```sql
create table battles (
  id uuid primary key default gen_random_uuid(),
  territory_id integer not null references territories(id),
  attacker_id uuid not null references players(id),
  defender_id uuid references players(id),      -- null = NPC-garrisoned target
  is_home_target boolean not null default false,
  movement_id uuid not null references troop_movements(id),
  status text not null check (status in ('awaiting_ready','active','resolved','expired')),
  attacker_ready_at timestamptz,
  defender_ready_at timestamptz,
  ready_deadline timestamptz not null,          -- arrival + 10 days
  current_round integer not null default 0,
  round_deadline timestamptz,                    -- set once status='active'; null otherwise
  winner_side text check (winner_side in ('attacker','defender')),  -- null until resolved
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
```

`winner_id` is deliberately not a separate column — the winning *player*
(if any; an NPC defender has none) is always derivable as
`case winner_side when 'attacker' then attacker_id when 'defender' then defender_id end`,
and storing it separately would risk it drifting out of sync.

`troop_movements.kind` gains a new allowed value: `'attack'` (alongside the
existing `'transfer'` and `'claim'`), using the exact same
`transferHours(distance, nation)` formula and arrival mechanics subsystem
#3 already built — no new travel-time logic needed, and no
`occupation_hrs` component (that concept is specific to peaceful
empty-land claims, not combat). On arrival, `resolve_due_movements()` (§3.6)
creates the `battles` row (status `awaiting_ready`, or `active` immediately
if `defender_id is null`).

Map visibility: extend `territories` with a new nullable
`battle_locked_by uuid references players(id)` column, set to the
attacker's id the moment `declare_attack` is called (before troops even
arrive — stricter than `claim_locked_by`, which only locks once travel
completes, but appropriate here since the target is already
owned/garrisoned rather than empty land). `get_viewport` /
`get_minimap_overview` already return `claim_locked_by`; extend both to
also return `battle_locked_by` the same way — subsystem #3 already
surfaces the claimant's identity publicly (`claim_locked_by` is a real
player id, not anonymized), so `battle_locked_by` follows the same
existing convention rather than introducing a new privacy stance.
`battle_locked_by` is cleared when the battle resolves or expires.

### 3.2 `battle_attacker_roster`

```sql
create table battle_attacker_roster (
  battle_id uuid not null references battles(id),
  card_instance_id uuid not null references card_instances(instance_id),
  primary key (battle_id, card_instance_id)
);
```

Fixed at `declare_attack` time from the attacker's unit-card instances
stationed at the origin territory. This is the *only* pool the random
per-round attacker pick draws from — and only while the instance is still
owned by the attacker (if it was captured by the defender mid-battle, it
naturally drops out of this pool via the ownership check, and can
resurface in the defender's pool instead — see §3.4).

### 3.3 `battle_rounds`

```sql
create table battle_rounds (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references battles(id),
  round_number integer not null,
  attacker_card_instance_id uuid references card_instances(instance_id),
  defender_card_instance_id uuid references card_instances(instance_id),
  winner_card_instance_id uuid references card_instances(instance_id),
  auto_picked boolean not null default false,   -- defender's pick timed out
  skipped boolean not null default false,       -- no available card for whichever side was due
  resolved_at timestamptz not null default now(),
  unique (battle_id, round_number)
);
```

Full audit trail; also what the live UI polls/subscribes to for the
round-by-round animation (§6).

### 3.4 `battle_unit_rest`

```sql
create table battle_unit_rest (
  battle_id uuid not null references battles(id),
  card_instance_id uuid not null references card_instances(instance_id),
  resting_until_round integer not null,
  primary key (battle_id, card_instance_id)
);
```

Written for *both* cards in every resolved round (winner and loser alike,
confirmed design decision — resting is about the card having just fought,
not about losing). A card is "available" for a given round if it has no
row here with `resting_until_round >= current_round`, or if it does and
`current_round` has advanced past it (rows are cleaned up once passed, or
simply ignored by the availability query — implementation's choice, no
correctness difference).

The **defender's pool is never a fixed roster** — every round it's
recomputed as: unit-category `card_instances` stationed at
`territory_id`, owned by the current `defender_id` (or, for an NPC target,
`owner_id is null`), and not resting. This is what lets a card captured
from the attacker mid-battle immediately become available for the
defender to use in a later round of the *same* battle.

### 3.5 Combat stat computation (per duel, per card, evaluated fresh each round)

```
effective = applyRank(template.baseStats, template.rank)   // subsystem #1
if defending side this round:
  bonus = combinedDefenseBonusPct(territory.castle_rank, territory.village_rank)
  effective.def *= (1 + bonus/100)
  if territory.castle_rank is not null:
    atkBonus = castleAttackBonusPct(territory.castle_rank)
    effective.str *= (1 + atkBonus/100)
    effective.lng *= (1 + atkBonus/100)
apply the current owner's nation perk (whichever side, attacker or
defender — this is about who *owns* the card right now, not its role):
  england:    effective.lng *= 1.15
  francia:    effective.str *= 1.15
  hre:        effective.def *= 1.15
  byzantium:  effective.hp  *= 1.15
  (mongol_horde / scandinavia have no combat-stat perk — already spent on
  transfer/occupation speed in subsystem #3)
resolveDuel(attackerEffective, defenderEffective)   // subsystem #1, unchanged
```

Each multiplication is applied in sequence to the already-integer,
already-rank-scaled stat, then the *combined* result is rounded once
(`Math.round`, floor of 0) right before being passed into `resolveDuel` —
mirroring `applyRank`'s own rounding convention (subsystem #1
§3/`lib/cards/combat.ts`) rather than rounding after every individual
multiplier, which would compound rounding error across up to three
stacked bonuses (structure defense/attack + nation perk).

### 3.6 RPC interfaces and lazy resolution

Mirrors subsystem #3's existing convention exactly: every RPC below calls
a `resolve_due_battles()` function first (analogous to the existing
`resolve_due_movements()`, itself unchanged in signature but extended —
see below), so no cron job is needed; all mutating RPCs are
`security definer` and independently re-check `auth.uid()` against the
relevant participant column.

- **`declare_attack(origin_territory_id integer, target_territory_id integer, card_instance_ids uuid[])`**
  Validates the caller owns `origin_territory_id` and every
  `card_instance_ids` entry is a `status='stationed'`, unit-category card
  the caller owns there (identical validation shape to `start_claim`).
  Does **not** classify the target here — the target's state (owner,
  claim, NPC garrison) can change during the travel window, so
  classification is deferred to arrival time (`resolve_due_movements()`,
  below), the only point where re-checking fresh state is actually
  correct. `declare_attack` only rejects up front the cases that can
  never become valid regardless of what happens during travel: the
  caller's own owned/claimed territory, or a territory that already has
  a non-`resolved`/`expired` `battles` row targeting it
  (`battle_locked_by is not null`) — the caller should
  retry once that resolves. It also does a best-effort 32-territory-cap
  pre-check (§5) using current state and raises the same
  `territory ownership cap (32) reached` error `start_claim` already
  raises if capture is plausible and the caller is already at the cap;
  this is re-verified defensively at arrival too, since the cap could
  change during travel. Otherwise inserts a `troop_movements` row
  (`kind='attack'`, `transfer_arrives_at` per `transferHours`), links
  `card_instance_ids` via the existing `troop_movement_units` table, and
  sets `territories.battle_locked_by = caller` immediately (this alone is
  what makes the attack visible on the map before troops even arrive).

- **`resolve_due_movements()`** (existing function, extended): its
  existing arrival-handling branch (currently keyed on `kind = 'transfer'`
  vs `kind = 'claim'`) gains a third branch for `kind = 'attack'`: on
  arrival, flips the moved `card_instances` to `status='stationed'` at the
  destination (identical to a `transfer`'s arrival — unchanged), marks the
  movement `completed`, then classifies the (now current) state of
  `target_territory_id` into exactly one of:
  - **Occupied**: `owner_id is not null` and `!= attacker` → `defender_id
    = owner_id`, `is_home_target = target.is_home`.
  - **Contested claim**: `owner_id is null`, `claim_locked_by is not
    null`, `claim_locked_by != attacker` → `defender_id =
    claim_locked_by`, `is_home_target = false` (see the dedicated
    walkthrough above).
  - **NPC-garrisoned**: `owner_id is null`, `claim_locked_by is null`,
    and at least one unit-category `card_instances` row with `owner_id is
    null` is stationed there → `defender_id = null`.
  - **Now truly empty** (state changed during travel — e.g. the earlier
    claimant cancelled): re-verifying the 32-cap (defensively, per
    above), it falls back to exactly `start_claim`'s own effect: clears
    `battle_locked_by` (no battle will exist for this arrival) and sets
    `claim_locked_by = attacker`, starting a normal claim occupation
    timer for the arrived troops — no `battles` row, no combat. This is
    the one case where "attack" silently becomes "claim" rather than a
    battle, since there's no one left to fight.
  For the three combat cases, it inserts the `battles` row (`awaiting_ready`
  + `ready_deadline = now() + interval '10 days'`, or `active` +
  `round_deadline = now() + interval '120 seconds'` immediately if
  `defender_id is null`), and populates `battle_attacker_roster` from the
  movement's `troop_movement_units`. For a newly `active` NPC battle, it
  additionally invokes the round-resolution loop below synchronously
  (still one server-side pass, still logs every round to `battle_rounds`
  for client replay — §4).

- **`resolve_due_battles()`** (new function, called at the top of every
  RPC in this section, same lazy-resolution convention):
  1. For `awaiting_ready` battles past `ready_deadline`: resolves per the
     tie-break rules in §2, all no-combat outcomes (no duels ever ran, so
     no card ownership ever changed — only territory ownership and troop
     *location* are at stake):
     - **Neither ever readied**: `status='expired'`, `winner_side = null`,
       no capture, `battle_locked_by` cleared, and the attacker's entire
       roster is sent home via a return `troop_movements` row
       (`kind='transfer'`, same `transferHours` formula, back to
       `origin_territory_id`). The defender's own cards were never
       displaced and are left untouched.
     - **Only the defender ever readied**: defender wins outright — same
       cleanup as "neither ready" above (territory stays with defender,
       attacker's roster returns home, defender's cards untouched); the
       only difference is `winner_side='defender'` is recorded for the
       audit trail.
     - **Only the attacker ever readied, or both readied but their
       `*_ready_at` windows never both fell inside "player is online"**
       (defined identically to subsystem #2's existing convention —
       `players.last_seen_at` within the last 2 minutes, §6 /
       `2026-08-15-players-accounts-design.md` §6 — at the same instant):
       attacker wins outright. If not `is_home_target` and not at the
       32-cap, territory ownership transfers to the attacker exactly as
       in a combat win (§5): `owner_id=attacker`, `claim_locked_by` and
       `battle_locked_by` both cleared. Since no duels ran, no card
       ownership changed — so the defender's own cards, still owned by
       the defender, are no longer on their own territory once it's
       captured: they are sent home via a return `troop_movements` row
       to `(select id from territories where owner_id = defender_id and
       is_home)` (the defender's home territory; this path only occurs
       for PvP battles — an NPC "defender" always fights immediately per
       §4, so it never reaches `awaiting_ready`, let alone this branch).
       The attacker's roster needs no movement — it simply becomes the
       new garrison in place, same as a combat-resolved capture. If
       `is_home_target` or the cap blocks capture, no territory or card
       ownership changes at all; only `battle_locked_by` is cleared
       (nothing to return home in this case, since the "win" here isn't
       a card-loot win — it produced no card captures either).
  2. For `active` battles whose `round_deadline` has passed with the
     current round still missing a `defender_card_instance_id`: auto-picks
     a random available defender card, resolves that round
     (`auto_picked=true`).
  3. After any round resolves (explicit pick, auto-pick, or the NPC loop),
     re-evaluates the win condition — attacker's roster has zero
     rows still owned by the attacker, or the defender/NPC has zero
     unit-category `card_instances` left stationed at the territory
     (checked irrespective of resting status; only *this round's*
     eligibility cares about resting) — and if met, finalizes: sets
     `status='resolved'`, `winner_side`, clears `battle_locked_by`, and
     applies the territory-capture rule (§5). Card-instance cleanup:
     whenever the attacker did **not** end up owning the territory
     (`is_home_target`, or the rare defensively-re-verified cap-block
     case) every `card_instance` *currently owned by the attacker and
     stationed at `territory_id`* — this includes both the attacker's
     original roster survivors and any defender cards captured mid-battle
     that are still attacker-owned at resolution time — is sent home via
     a return `troop_movements` row (`kind='transfer'`, same
     `transferHours` formula, back to `origin_territory_id`, same as case
     1). When the attacker *does* end up owning the territory, no
     movement is needed: by construction of the win condition above, the
     defender/NPC has zero remaining cards at `territory_id`, so every
     card there is already attacker-owned and simply becomes the new
     garrison in place. Symmetrically, when the defender wins a
     non-home-target battle, the win condition guarantees the attacker
     already has zero cards left at `territory_id` — so the "return
     home" step is a no-op, not a special case. If the round wasn't the
     last, instead starts the next round: for `defender_id is null` (NPC),
     immediately continues the loop; otherwise picks the next random
     available attacker card (or marks the round `skipped` per §2's
     skip rule) and sets a fresh `round_deadline`.

- **`mark_ready(battle_id uuid)`** — caller must be `attacker_id` or
  `defender_id`; **idempotent and re-callable**: it always updates the
  caller's own `*_ready_at = now()`, then re-evaluates the joint check
  every time it's called (not just the first time either side calls it).
  If the other side's `*_ready_at` is already set, and both players'
  `players.last_seen_at` are within the last 2 minutes of this call
  (i.e. both are online *right now*, not just at some point since
  `awaiting_ready` began), flips `status='active'` and sets the first
  `round_deadline`. This means if the first call doesn't overlap with the
  other side being online, no state is stuck — either player can simply
  call `mark_ready` again later (e.g. from a "ready" button the client
  keeps showing until `status='active'`), and the join check re-runs
  fresh against current `last_seen_at` values each time, until either it
  succeeds or `ready_deadline` passes and §2's timeout tie-break applies.

- **`pick_defender_card(battle_id uuid, card_instance_id uuid)`** —
  caller must be the battle's current `defender_id`; validates the card
  is currently owned by the caller, stationed at `territory_id`,
  unit-category, and not resting; resolves the pending round exactly as
  in `resolve_due_battles()` case 2/3 above, but via an explicit pick
  instead of a timeout auto-pick.

**Amendments to subsystem #3's territory RPCs** (closing the bugfix noted
in §1, and preventing new conflicts with an in-progress battle):
- `start_claim`: its destination-availability check (`owner_id is null
  and claim_locked_by is null`) gains two further conditions — also
  reject if any unit-category `card_instances` row with `owner_id is
  null` is stationed at the destination (an NPC garrison is present; such
  a tile must go through `declare_attack` instead), and also reject if
  `battle_locked_by is not null` (someone is already fighting over this
  tile).
- `cancel_claim`: additionally rejects if the territory has a non-
  `resolved`/`expired` `battles` row with `defender_id = caller` — a
  claim currently being defended in a contested-claim battle can't be
  unilaterally cancelled out from under the attacker mid-fight.
- `build_structure`: additionally rejects if `territories.battle_locked_by
  is not null` — a territory can't have its castle/village rank changed
  (and its combat bonuses along with it) while a battle targeting it is
  in progress.
- `start_transfer` (reinforcing a territory the caller already owns) is
  deliberately **not** restricted by `battle_locked_by` — if the caller's
  own territory is under attack, sending reinforcements while the battle
  is still `awaiting_ready`/`active` is allowed and expected: the
  defender's per-round pool (§3.4) is recomputed fresh from whatever is
  currently stationed there, so newly-arrived reinforcements simply
  become available to defend in later rounds.

**RLS**: `battles`, `battle_attacker_roster`, `battle_rounds`, and
`battle_unit_rest` all get `enable row level security` plus a public
`select using (true)` policy — identical convention to every existing
table in `0002_territories.sql` (`card_instances`, `troop_movements`,
`territories` are all already publicly readable; nothing in this spec
introduces a new sensitive-data category). Per §1's clarified wording,
"no spectating" only ever meant no *interference*: `mark_ready` and
`pick_defender_card` both check `auth.uid()` against the battle's
`attacker_id`/`defender_id` and raise if the caller is neither, so a third
party can freely read a battle's live state (consistent with
`battle_locked_by` already being a public map flag) but never act on it.

## 4. NPC defense AI

NPC-garrisoned targets never need a human to be online, so their battles
skip `awaiting_ready` entirely and resolve every round automatically and
immediately (no 120-second wait) — the full round sequence plays out in one
server-side pass, but every round is still written to `battle_rounds` so
the client can still show a paced replay animation rather than an instant
jump to the result.

NPC's per-round pick is a **smart counter**: simulate `resolveDuel` between
the attacker's rolled card and every currently-available NPC card, and
pick whichever NPC card wins that simulated duel (falling back to a random
available card if none would win — `resolveDuel` is deterministic given
two stat sets, so this is a plain loop, no extra randomness).

## 5. Territory ownership cap enforcement

`declare_attack` (§3.6) must check, at
declaration time, whether resolving this attack in the attacker's favor
*would* result in a new owned territory (i.e. `is_home_target = false` and
the target isn't already owned by the attacker, which can't happen anyway
since you can't attack your own territory). If so, and the attacker is
already at 32 owned territories, the RPC raises the same
`territory ownership cap (32) reached` error subsystem #3's `start_claim`
already raises — the attack cannot even be declared. Attacking a home
territory (loot-only) is never blocked by the cap, since it can never
result in a capture.

## 6. Real-time delivery

Both the live 120-second per-round window and the map's "under attack"
visibility need to push updates to connected clients without polling.
Reuses the Supabase Realtime channel the stack already depends on
(`@supabase/supabase-js`) — clients subscribe to `postgres_changes` on
`battles` (their own battle) and `battle_rounds` (insert events) for the
territory/battle they're viewing. No new infrastructure needed beyond
enabling replication on these two tables in the migration.

## 7. UI

Approved layout (desktop): attacker's committed roster in a vertical strip
on the left (greyed out while resting), the current round's duel rendered
as two `TradingCard`s facing off in the center with the round countdown
and running score above it, defender's currently-available cards in a
vertical strip on the right (clickable during the defender's own 120s
window), and a collapsible round history log below.

On narrow/mobile viewports, the two card strips collapse from vertical
columns into horizontally-scrollable strips stacked above/below the
central duel instead of beside it — confirmed via the visual companion
mockup.

## 8. Testing strategy

Pure-function unit tests (mirroring subsystem #1/#3's style) for:
combat-stat computation with structure/nation bonuses stacked, NPC
smart-counter card selection, round-resolution/rest-cooldown bookkeeping,
ready-deadline tie-break outcomes, and the 32-territory-cap
attack-blocking check. RPC-level tests follow subsystem #3's existing
Supabase RPC test conventions. UI/component tests follow existing RTL
conventions used throughout the project.
