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
  battle flow between the two claimants.
- Applying Castle/Village structure bonuses (already computed and sitting
  idle in `lib/territories/structureBonus.ts`) and the four still-unapplied
  nation combat perks (England/Francia/HRE/Byzantium — Mongol Horde and
  Scandinavia were already applied in subsystem #3) to each duel's
  effective stats.

**Out of scope** (explicitly deferred further):

- Trading/exchange of cards outside of combat (subsystem #5).
- Any notification mechanism beyond in-app visibility on the map — no
  email/push (subsystem #6).
- Spectating another pair of players' battle (still not allowed, per the
  original brief: "jiní hráči nemohou zasahovat").

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
battle resolved: status='resolved', winner_id set
      - is_home_target=true                  → no ownership change, only the card transfers that already happened during rounds stand
      - otherwise, attacker wins & not at the 32-territory cap → territory ownership transfers to attacker
      - otherwise (defender wins, or attacker capped)          → territory stays with defender/NPC
```

**Contested empty-land claims** (subsystem #3 §6): if player B sends troops
to a tile player A is still mid-occupation on, instead of starting an
independent claim, the system creates a `battles` row with `attacker_id`
= B, `defender_id` = A, `territory_id` = the contested tile, and
`is_home_target = false`. It runs through the exact same
awaiting_ready/active loop as a normal PvP battle. The winner's original
claim timer continues counting down (or begins, if B wins and it was B's
first attempt at this tile) unaffected; the loser's claim attempt is
cancelled and their committed troops follow the same per-duel card-loss
rules as any other battle.

## 3. Data model

### 3.1 `battles`

```sql
create table battles (
  id uuid primary key default gen_random_uuid(),
  territory_id integer not null references territories(id),
  attacker_id uuid not null references auth.users(id),
  defender_id uuid references auth.users(id),   -- null = NPC-garrisoned target
  is_home_target boolean not null default false,
  movement_id uuid not null references troop_movements(id),
  status text not null check (status in ('awaiting_ready','active','resolved','expired')),
  attacker_ready_at timestamptz,
  defender_ready_at timestamptz,
  ready_deadline timestamptz not null,          -- arrival + 10 days
  current_round integer not null default 0,
  round_deadline timestamptz,                    -- set once status='active'; null otherwise
  winner_id uuid references auth.users(id),      -- null until resolved; NPC-target win => null defender means "attacker" or "npc" tracked via winner_side below
  winner_side text check (winner_side in ('attacker','defender')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
```

`troop_movements.kind` gains a new allowed value: `'attack'` (alongside the
existing `'transfer'` and `'claim'`), using the exact same
`transferHours(distance, nation)` formula and arrival mechanics subsystem
#3 already built — no new travel-time logic needed. On arrival, a
`battles` row is created (status `awaiting_ready`, or `active` immediately
if `defender_id is null`).

Map visibility: a battle in `awaiting_ready` or `active` status marks its
`territory_id` as "under attack" the same way subsystem #3 already surfaces
`claim_locked_by` in `get_viewport`/`get_minimap_overview` — extend those
functions to also return an `under_attack` flag (no need to expose *who*,
same privacy stance subsystem #3 took for in-progress claims).

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

`start_attack` (the RPC that declares an attack) must check, at
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
