# Coalitions & Extended Kingdom Relations — Design

## Overview

Extend the diplomacy module (backlog #29, shipped in
`2026-08-20-diplomacy-design.md`) to support richer relationships between
players ("kingdoms") beyond the current binary war/peace, and introduce
**coalitions**: named groups of 2-10 players that share an enforced peace
and can act diplomatically as one unit.

This is **phase 1 of 3** in the larger backlog item #30 ("Coalition module:
leader roles, combined armies for bigger battles"). The full backlog scope
is decomposed as follows, each with its own spec/plan:

1. **This spec** — coalition core (membership, leader role, auto-peace
   enforcement, war/peace declared for the whole coalition) plus a new
   `non_aggression` pairwise relation type.
2. **Troop lending** (future spec) — coalition members can lend cards to
   each other for a fixed period, with travel time in both directions.
   Because lent cards physically become part of the destination
   territory's garrison, they fight alongside the owner's own cards in the
   existing battle engine — this is what gives coalitions "combined
   armies for bigger battles" without needing any change to the
   attacker/defender battle model.
3. **Shared map visibility** (future spec) — coalition members see each
   other's movements/territories with extra detail on the map.

**Explicitly out of scope for this spec:**
- Trade agreements between kingdoms — deferred until a card-trading system
  exists outside of battle; without it, this relation type would have no
  mechanical effect.
- Reputation/rating of kingdoms — not requested.
- Troop lending and shared map visibility — phases 2 and 3 above.

## Data Model

### Extending `diplomacy_relations`

The existing table (see prior spec) only ever stores `'war'` rows (no row
= peace). Add a second possible value:

| column | type | notes |
|---|---|---|
| state | text, `'war'` \| `'non_aggression'` | unchanged row-per-unordered-pair model; absence of a row still means plain (unenforced) peace |

Unlike ordinary peace, a `non_aggression` relation **is enforced**: it
blocks attacks between the pair (see Enforcement below), matching the
existing `war` row's uniqueness-per-pair semantics (one row per unordered
pair, `player_a_id < player_b_id`).

### New tables

**`coalitions`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text, unique | |
| leader_id | uuid, references players | |
| created_at | timestamptz | |

**`coalition_members`**
| column | type | notes |
|---|---|---|
| coalition_id | uuid, references coalitions | |
| player_id | uuid, references players, **unique** | a player can only belong to one coalition at a time |
| joined_at | timestamptz | |

PK `(coalition_id, player_id)`; the `unique` constraint on `player_id`
alone enforces the one-coalition-per-player rule at the database level.

**`coalition_invites`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| coalition_id | uuid | |
| invited_player_id | uuid | |
| invited_by | uuid | must be the coalition's current leader at time of invite |
| status | text, `pending` \| `accepted` \| `rejected` \| `cancelled` | |
| created_at | timestamptz | |

**`coalition_join_requests`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| coalition_id | uuid | |
| player_id | uuid | requester |
| status | text, `pending` \| `accepted` \| `rejected` \| `cancelled` | |
| created_at | timestamptz | |

When any invite or join request transitions to `accepted` for a player,
all of that player's other `pending` invites/requests (to any coalition)
are set to `cancelled` in the same transaction — a player can only join
one coalition, so all other pending offers become moot.

### New `world_events` types

`coalition_created`, `coalition_member_joined`, `coalition_member_left`,
`coalition_member_kicked`, `coalition_leadership_transferred`,
`coalition_disbanded`, `coalition_war_declared`, `coalition_peace_signed`,
`non_aggression_signed`. These follow the exact same pattern as the
existing `war_declared`/`peace_signed`/`claim_started` events (insert into
`world_events`, consumed by `WorldEventsFeed`).

## RPCs and Game Logic

### Non-aggression pact (pairwise, outside coalitions)

Mirrors the existing peace-offer flow exactly:
- `diplomacy_propose_non_aggression(p_target_id uuid)`
- `diplomacy_accept_non_aggression(p_offer_id uuid)`
- `diplomacy_reject_non_aggression(p_offer_id uuid)`
- `diplomacy_cancel_non_aggression(p_offer_id uuid)`

Reuses the `diplomacy_offers`-style table/pattern (new `kind` value or a
parallel offers table — implementation plan will decide based on whichever
keeps the existing `diplomacy_offers` code simplest to extend). Same
advisory-lock concurrency pattern as `diplomacy_propose_peace`.

### Coalition lifecycle

- `coalition_create(p_name text)` — creates the coalition, caller becomes
  leader. Fails if the caller is already in a coalition, or if `p_name` is
  taken.
- `coalition_invite(p_coalition_id uuid, p_player_id uuid)` — leader only.
  Fails if the target is already in a coalition or already has a pending
  invite/request for this coalition, or if the coalition already has 10
  members.
- `coalition_request_join(p_coalition_id uuid)` — any player not already
  in a coalition. Fails if the requester is at **war** with any existing
  member of the target coalition (must resolve that war independently
  first — joining does not auto-force peace).
- `coalition_accept_invite(p_invite_id uuid)` — invited player accepts.
- `coalition_accept_request(p_request_id uuid)` — leader approves a join
  request. Same war-check as `coalition_request_join`, re-validated at
  accept time (state may have changed).
- `coalition_reject_invite` / `coalition_reject_request` /
  `coalition_cancel_invite` / `coalition_cancel_request` — standard
  reject/cancel companions.
- `coalition_kick(p_player_id uuid)` — leader only, cannot kick self.
- `coalition_transfer_leadership(p_new_leader_id uuid)` — leader only,
  target must already be a member.
- `coalition_leave()` — any non-leader member leaves freely. If the
  caller is the leader:
  - and there are other members, the call **fails** — the leader must
    `coalition_transfer_leadership` first (explicit, no automatic
    succession, to avoid surprising takeovers).
  - and the leader is the only member, the coalition is **disbanded**
    automatically (nothing left to lead).
- `coalition_disband()` — leader only, deletes the coalition and all
  membership rows.
- `coalition_declare_war(p_target_id uuid)` — leader only. Creates a
  `war` row in `diplomacy_relations` between **every current member** and
  the target, following the same idempotent `insert ... on conflict do
  nothing` pattern as the existing per-player `diplomacy_declare_war`.
- `coalition_declare_peace(p_target_id uuid)` — leader only, symmetric
  teardown (removes war rows between every member and the target; does
  not touch any `diplomacy_offers`/tribute negotiation already in flight
  between individual member pairs, which continue to work exactly as
  today for whichever member started them).

All coalition-mutating RPCs take a transaction-scoped advisory lock keyed
on the coalition id, following the existing concurrency pattern from the
diplomacy spec.

### Enforcement — blocking attacks

The shared attack/claim-start core functions (`_declare_attack_core`,
`_start_claim_core` when the target is player-owned, and any transfer
that targets a hostile territory) gain a new check before proceeding:
if the acting player and the target territory's owner are (a) in the same
coalition, or (b) have an active `non_aggression` row between them, the
action is rejected with a clear error message. This is a pure additive
guard — it does not change any other attack/claim logic.

## UI

- `/diplomacy` page gains a third tab, **"Koalice"**, alongside the
  existing "Moje války" and "Nabídky míru" sections.
  - If the player is not in a coalition: a "➕ Založit vlastní koalici"
    button, plus a list of existing coalitions each with member count and
    a "Požádat o vstup" button.
  - If the player is a member: coalition name, member list (online/offline
    dot, leader badge), and — if the viewer is the leader — inline
    actions per member (kick, transfer leadership) plus coalition-level
    actions (invite player, view pending join requests, declare
    war/peace for the coalition, disband).
- A parallel "Pakty" section for proposing/accepting/rejecting/cancelling
  non-aggression pacts, visually identical to the existing peace-offer
  flow.
- `GarrisonModal`'s owner-info panel: the existing "⚔️ Válka" badge
  becomes relation-aware — shows "🤝 Koalice" or "🕊️ Pakt" when
  applicable, and the "Vyhlásit válku" button is hidden/disabled with an
  explanatory tooltip when the target is a coalition member or under a
  non-aggression pact (since the action would be rejected server-side
  anyway).
- `WorldEventsFeed` gains rendering for all new event types listed above,
  following the exact `formatWorldEventText`/`renderEventText` pattern
  used for `claim_started`/`war_declared`.
- Mobile-first layout (single column, stacked sections, large tap
  targets) confirmed via mockup in this brainstorming session.

## Testing Plan

- SQL migration(s) with a transaction-wrapped, rolled-back verification
  script (matching the `0060`/`0061` pattern), covering: coalition
  creation, invite+accept, request+accept, kick, leadership transfer,
  disband (including auto-disband when the sole leader leaves), join
  blocked while at war with a member, attack blocked between coalition
  members and between non-aggression pact holders, non-aggression
  propose/accept/reject/cancel, coalition-wide war/peace declaration
  applied to every member, and cancellation of a player's other pending
  invites/requests when one is accepted.
- Frontend: Jest coverage for the new "Koalice" and "Pakty" sections in
  `app/diplomacy/page.tsx`, new wrappers in `lib/diplomacy/api.ts`, the
  relation-aware badge/disabled-button behavior in `GarrisonModal`, and
  the new `WorldEventsFeed` event types.
- `tsc --noEmit` and the full Jest suite must be green before commit, per
  existing project convention.

## Process Note

Per user instruction for this feature: keep the implementation plan
lightweight (no phased/chunked execution plan), limit the plan review
loop to a single pass, and hand off directly to implementation after that.
