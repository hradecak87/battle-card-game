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

### Extending `diplomacy_relations` and `diplomacy_offers`

The existing `diplomacy_relations` table (see prior spec) only ever
stores `'war'` rows (no row = peace), enforced today by a `CHECK (state =
'war')` constraint from migration `0044`. Add a second possible value —
this **requires a migration that widens that CHECK constraint** to
`CHECK (state in ('war', 'non_aggression'))`, exactly like how `0060`
widened the `world_events.event_type` CHECK:

| column | type | notes |
|---|---|---|
| state | text, `'war'` \| `'non_aggression'` | unchanged row-per-unordered-pair model; absence of a row still means plain (unenforced) peace |

Unlike ordinary peace, a `non_aggression` relation **is enforced**: it
blocks attacks between the pair (see Enforcement below), matching the
existing `war` row's uniqueness-per-pair semantics (one row per unordered
pair, `player_a_id < player_b_id`).

Similarly, `diplomacy_offers.kind` is constrained today to `CHECK (kind
in ('white_peace', 'tribute_peace'))` (per `0044`). This **also needs
widening** to add `'non_aggression'` before any pact can be proposed.

### New tables

**`coalitions`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text, unique | |
| leader_id | uuid, references players | ignored once `disbanded_at` is set |
| created_at | timestamptz | |
| disbanded_at | timestamptz, nullable | set instead of deleting the row (see `coalition_disband` below); an "active" coalition is `disbanded_at is null` |

**`coalition_members`**
| column | type | notes |
|---|---|---|
| coalition_id | uuid, references coalitions | |
| player_id | uuid, references players, **unique** | a player can only belong to one coalition at a time |
| joined_at | timestamptz | |

PK `(coalition_id, player_id)`; the `unique` constraint on `player_id`
alone enforces the one-coalition-per-player rule at the database level.
Rows are hard-deleted on leave/kick/disband — membership itself has no
history requirement (unlike invites/requests below, which are kept for
audit as soft-cancelled rows).

**`coalition_invites`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| coalition_id | uuid, references coalitions | no cascade delete — see below |
| invited_player_id | uuid | |
| invited_by | uuid | must be the coalition's current leader at time of invite |
| status | text, `pending` \| `accepted` \| `rejected` \| `cancelled` | |
| created_at | timestamptz | |

**`coalition_join_requests`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| coalition_id | uuid, references coalitions | no cascade delete — see below |
| player_id | uuid | requester |
| status | text, `pending` \| `accepted` \| `rejected` \| `cancelled` | |
| created_at | timestamptz | |

Neither invites nor join requests are ever hard-deleted; they are always
transitioned to a terminal status (`accepted`/`rejected`/`cancelled`) so
the coalition's history stays queryable. This is also why `coalitions`
rows are never hard-deleted (see `disbanded_at` above) — a `references
coalitions` FK on these two tables would otherwise be violated by a
disband that deletes the parent row.

When any invite or join request transitions to `accepted` for a player,
all of that player's other `pending` invites/requests (to any coalition)
are set to `cancelled` in the same transaction — a player can only join
one coalition, so all other pending offers become moot.

### New `world_events` types

`coalition_created`, `coalition_member_joined`, `coalition_member_left`,
`coalition_member_kicked`, `coalition_leadership_transferred`,
`coalition_disbanded`, `coalition_war_declared`, `coalition_peace_signed`,
`non_aggression_signed`, `non_aggression_broken`. These follow the exact
same pattern as the existing `war_declared`/`peace_signed`/`claim_started`
events (insert into `world_events`, consumed by `WorldEventsFeed`). As
with the `0060` migration, this requires a migration that **widens the
`world_events.event_type` CHECK constraint** to add every one of these
new values before any RPC can insert them.

### RLS

All four new tables follow the same visibility rule already used for
`diplomacy_relations`/`diplomacy_offers`: a row is selectable by any
player who is a party to it.
- `coalitions`: selectable by everyone (coalition browsing/join list is
  public — matches the "Existující koalice" UI list). Mutable only via
  `security definer` RPCs, never directly.
- `coalition_members`: selectable by everyone (membership is public
  information, shown as leader/member badges). Mutable only via RPCs.
- `coalition_invites`: selectable only by the invited player and the
  coalition's current leader. Mutable only via RPCs.
- `coalition_join_requests`: selectable only by the requesting player and
  the coalition's current leader. Mutable only via RPCs.

No table is ever written to directly by client code — every mutation
goes through a `security definer` RPC, exactly as the existing diplomacy
tables work today.

## RPCs and Game Logic

### Non-aggression pact (pairwise, outside coalitions)

**Storage decision**: `diplomacy_offers.kind` gains a new value
`'non_aggression'` (alongside existing `white_peace`/`tribute_peace`) —
no parallel table. A pact is proposed as an offer row exactly like a
peace proposal (never carries `offered_card_ids`/`offered_territory_id`,
mirroring `white_peace`'s empty-payload validation). Once accepted, the
pact's *active* state lives in `diplomacy_relations` as a
`state = 'non_aggression'` row for that pair — same one-row-per-unordered-
pair model as `war`. A pair can have at most one `diplomacy_relations`
row at a time (`war` XOR `non_aggression` XOR no row/plain peace); the
accept RPC deletes any pre-existing row for the pair before inserting the
new one (there should never be one, since `propose` blocks while a `war`
row exists, but the delete-then-insert keeps the invariant safe under
races).

RPCs (same advisory-lock-on-ordered-pair concurrency pattern as
`diplomacy_propose_peace`, i.e. `pg_advisory_xact_lock(hashtext(least(a,b)
|| greatest(a,b)))` as the first step of every one of these):
- `diplomacy_propose_non_aggression(p_target_id uuid)` — rejects if a
  `war` row already exists for the pair (must be at peace first) or if a
  `non_aggression` row already exists (already in a pact) or if either
  player is in the other's coalition already (redundant — coalition
  membership is a stronger relation).
- `diplomacy_accept_non_aggression(p_offer_id uuid)` — re-validates the
  same conditions (state may have changed since proposal), then writes
  the `diplomacy_relations` row and logs `non_aggression_signed`.
- `diplomacy_reject_non_aggression(p_offer_id uuid)` /
  `diplomacy_cancel_non_aggression(p_offer_id uuid)` — standard
  companions, identical shape to the existing peace-offer reject/cancel.

**Breaking an accepted pact**: reuses the existing
`diplomacy_declare_war(p_target_id uuid)` RPC (shipped in
`0061_diplomacy_declare_war.sql`, prior to this spec). That RPC is
extended so that, when a `non_aggression` row already exists for the
pair, it deletes it, logs `non_aggression_broken`, and inserts the `war`
row instead of only handling the "no row" case; it continues to log
`war_declared` as it already does today (both events are logged in the
same call). No separate "break pact" RPC is needed.

**New guard on `diplomacy_declare_war`**: this RPC now also rejects if
the caller and target share a coalition (same check as `coalition_declare_war`
below) — coalition members can never be at war with each other; leaving
the coalition is required first. This closes the gap where a member
could otherwise individually declare war on a coalition-mate.

### Read/listing RPCs (new — required by the UI, not covered by the prior spec)

- `diplomacy_get_relation(p_other_player_id uuid)` — extended to return
  `'war'` \| `'non_aggression'` \| `'peace'` \| `'coalition'` (the last
  when both players share a coalition; coalition membership takes
  precedence over any stale relation row).
- `diplomacy_list_non_aggression_pacts()` — all active pacts involving
  the caller, plus pending proposals sent/received (mirrors
  `diplomacy_list_wars`/offer-listing shape from the prior spec).
- `coalition_list()` — all **active** (`disbanded_at is null`) coalitions
  with id, name, leader name, member count, capped at 10; used for the
  "Existující koalice" browse list.
- `coalition_get_mine()` — the caller's own coalition (name, leader,
  full member list with online status) or null if not a member.
- `coalition_list_invites()` — pending invites addressed to the caller.
- `coalition_list_join_requests(p_coalition_id uuid)` — leader only;
  pending join requests for their coalition.

### Coalition lifecycle

All coalition RPCs below (`coalition_invite` through `coalition_declare_peace`)
implicitly require the referenced coalition to be active
(`disbanded_at is null`) — a disbanded coalition is inert history, not a
valid target for any further action.

- `coalition_create(p_name text)` — creates the coalition, caller becomes
  leader and its sole member. Fails if the caller is already in a
  coalition, or if `p_name` is taken. Note the 2-10 member range
  described in the Overview describes the intended lifecycle range once
  others join — a freshly created coalition legitimately has exactly 1
  member (the leader) until someone else joins; there is no minimum
  enforced beyond that.
- `coalition_invite(p_coalition_id uuid, p_player_id uuid)` — leader only.
  Fails if the target is already in a coalition or already has a pending
  invite/request for this coalition, or if the coalition already has 10
  members.
- `coalition_request_join(p_coalition_id uuid)` — any player not already
  in a coalition. Fails if the requester is at **war** with any existing
  member of the target coalition (must resolve that war independently
  first — joining does not auto-force peace). An existing
  `non_aggression` pact with a member does **not** block joining (it's a
  weaker relation than coalition membership, so joining is simply
  strictly upgrading it); once the join is accepted, any existing pact
  rows between the joiner and **every current member** of the coalition
  are deleted as redundant (coalition membership's auto-peace now covers
  all of them — see Enforcement below). A pact between the joiner and a
  player outside this coalition is left untouched (pacts are pairwise,
  unrelated to coalition membership except with members of this specific
  coalition).
- `coalition_accept_invite(p_invite_id uuid)` — invited player accepts.
  To close a race where a war could be declared against a member between
  the check and the write, this RPC acquires the pair-level advisory lock
  (`pg_advisory_xact_lock(hashtext(least(a,b) || greatest(a,b)))`) for
  the caller paired with **every current member**, in a fixed order
  (sorted by member `player_id`) to avoid deadlocking against a
  concurrent `diplomacy_declare_war`/coalition-war RPC doing the same
  pairwise locking — then, holding all those locks, re-validates: caller
  still not a member of any coalition, target coalition still below 10
  members, and caller not at war with any current member (checked freshly
  under lock). Any failure marks the invite `cancelled` (not left
  `pending`) so it doesn't linger as stale/actionable. This same fixed
  member-count cap (10) also naturally bounds the number of locks taken
  (at most 10).
- `coalition_accept_request(p_request_id uuid)` — leader approves a join
  request. Same locking and re-validations as `coalition_accept_invite`.
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
    automatically (nothing left to lead) — see `coalition_disband` below
    for exactly what that means.
- `coalition_disband()` — leader only. Deletes all rows from
  `coalition_members` for this coalition, sets `disbanded_at = now()` on
  the `coalitions` row (the row itself is never hard-deleted, per the
  Data Model section), and marks every still-`pending` invite/request
  for this coalition as `cancelled`.
- `coalition_declare_war(p_target_id uuid)` — leader only, target is a
  single player (not a coalition — coalition-vs-coalition war is out of
  scope for this phase). Rejects if the target is already a member of the
  caller's own coalition (including targeting self) — coalition members
  can never be at war with each other. If the target player happens to
  be in a *different* coalition, this does not cascade to their
  coalition-mates. Otherwise creates a `war` row in `diplomacy_relations`
  between **every current member** and the target, following the same
  idempotent `insert ... on conflict do nothing` pattern, pair-level
  locking, and non_aggression-breaking behavior as the existing
  per-player `diplomacy_declare_war` (shipped in
  `0061_diplomacy_declare_war.sql`) — this RPC simply loops that same
  logic over every coalition member.
- `coalition_declare_peace(p_target_id uuid)` — leader only. Unlike
  `coalition_declare_war`, this does **not** unilaterally delete war
  rows — the prior diplomacy spec requires mutual consent (an offer the
  target must accept) and blocks peace while an unresolved battle exists
  for that pair, and this spec does not relax either rule. Instead, for
  every current member still at war with the target, this RPC internally
  reuses the same `diplomacy_offers`-insert logic that backs
  `diplomacy_propose_peace(kind='white_peace')`, creating one offer row
  per member as if that member had proposed it themselves (since the
  actual `diplomacy_propose_peace` RPC is scoped to `auth.uid()` as the
  proposer, this is implemented as a shared internal helper function
  called once per member, not a literal RPC call on their behalf; only
  proposes for pairs that don't already have a pending peace offer, to
  avoid duplicate offers) — the target must still individually accept
  each one via `diplomacy_accept_peace`. This keeps the
  coalition-wide action fully consistent with the unchanged one-on-one
  peace flow; it does not touch any `diplomacy_offers`/tribute
  negotiation already in flight between individual member pairs, which
  continue to work exactly as today for whichever member started them.

**Concurrency**: all coalition-mutating RPCs (`coalition_invite` through
`coalition_declare_peace`) take a transaction-scoped advisory lock keyed
on the coalition id first, exactly like the diplomacy spec's per-pair
lock — this serializes concurrent invites/accepts against the 10-member
cap and against concurrent leave/kick/disband. In addition, any RPC that
also mutates a `diplomacy_relations` row for a specific pair (the
non-aggression flow, and each per-member war/peace write inside
`coalition_declare_war`/`coalition_declare_peace`) takes the existing
pair-level advisory lock (`pg_advisory_xact_lock(hashtext(least(a,b) ||
greatest(a,b)))`) around that specific row's read-modify-write, exactly
as `diplomacy_declare_war` already does — so a coalition-wide war
declaration and an individual member's own pact/peace action on the same
pair can never race each other.

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
- `GarrisonModal`'s owner-info panel already has an "⚔️ Vyhlásit válku"
  button (added this session, calling the existing
  `diplomacy_declare_war` RPC). This spec makes that panel
  relation-aware: the badge shows "🤝 Koalice" or "🕊️ Pakt" instead of
  "⚔️ Válka"/"🕊️ Mír" when applicable. The button is hidden entirely when
  the target is a **coalition member** (the action is now permanently
  rejected server-side — must leave the coalition first, which isn't a
  diplomacy action). When the target is under a **non-aggression pact**,
  the button stays visible but its label/tooltip changes to make clear
  it will break the pact (e.g. "⚔️ Zrušit pakt a vyhlásit válku"), since
  `diplomacy_declare_war` legitimately handles that case per the RPC
  section above.
- `WorldEventsFeed` gains rendering for all new event types listed above,
  following the exact `formatWorldEventText`/`renderEventText` pattern
  used for `claim_started`/`war_declared`.
- Mobile-first layout (single column, stacked sections, large tap
  targets) confirmed via mockup in this brainstorming session.

## Testing Plan

- SQL migration(s) with a transaction-wrapped, rolled-back verification
  script (matching the `0060`/`0061` pattern), covering: coalition
  creation, invite+accept, request+accept, kick, leadership transfer,
  disband (including auto-disband when the sole leader leaves, and
  confirming the `coalitions` row survives with `disbanded_at` set rather
  than being deleted), join blocked while at war with a member (but not
  blocked by a non-aggression pact, with the pact row deleted once
  joined), attack blocked between coalition members and between
  non-aggression pact holders, a coalition member cannot be individually
  declared war on by a coalition-mate (`diplomacy_declare_war` rejects
  it) nor can `coalition_declare_war` target a member of the caller's own
  coalition, non-aggression propose/accept/reject/cancel, breaking an
  accepted pact via `diplomacy_declare_war` (logs both
  `non_aggression_broken` and `war_declared`), `coalition_declare_peace`
  creating individual `white_peace` offers per member still at war
  (never unilaterally deleting war rows, and still respecting the
  existing unresolved-battle guard on `diplomacy_accept_peace` for each
  of them), coalition-wide war declaration applied to every member, and
  cancellation of a player's other pending invites/requests when one is
  accepted.
- Additional edge cases to cover explicitly: a player with a pending
  invite to coalition A and a pending request to coalition B — accepting
  one cancels the other; an invite/request that becomes stale because the
  coalition filled up to 10 members before it was accepted (rejected at
  accept time, not left dangling); an invite/request that becomes stale
  because a war started against a member after it was sent, verified as
  actually blocked under concurrent load (two transactions racing
  `diplomacy_declare_war` against a pending `coalition_accept_invite` for
  the same pair, only one outcome should be possible); kicking or the
  leaving of a member cleans up (cancels) any of that member's own
  pending invites/requests to other coalitions only if relevant to this
  coalition (i.e. no cross-coalition side effects beyond what's already
  covered by the one-coalition-per-player unique constraint); disbanding
  a coalition cancels all of its own pending invites/requests.
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
