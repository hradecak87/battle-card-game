# Coalitions & Extended Kingdom Relations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the approved spec at `docs/superpowers/specs/2026-08-21-coalitions-design.md` for full rationale — this plan is the "how", the spec is the "why".

**Goal:** Add a `non_aggression` pairwise relation and a full coalition system (create/invite/join/leave/kick/transfer/disband, leader-driven war/peace, enforced no-attack between members) to the diplomacy module, per the approved spec.

**Architecture:** Four sequential Postgres migrations (schema+RLS, non-aggression RPCs + `diplomacy_declare_war` extension, coalition lifecycle RPCs, attack-enforcement guard), each applied live to Supabase and verified via a transaction-wrapped rollback script — mirroring the exact pattern of `0044`-`0061`. Frontend: extend `lib/diplomacy/types.ts`/`api.ts`, add a `CoalitionPanel` and `PactList` to `app/diplomacy/page.tsx` behind a simple tab switcher, make `GarrisonModal` relation-aware, extend `WorldEventsFeed`.

**Tech Stack:** Next.js 14 + TypeScript, Supabase Postgres (plpgsql RPCs, RLS), Jest + Testing Library.

---

## Reference patterns (read before starting)

- `supabase/migrations/0044_diplomacy.sql` — table/RLS pattern to copy.
- `supabase/migrations/0046_diplomacy_rpcs.sql` — `diplomacy_require_player()`, `diplomacy_lock_pair()`, propose/accept/reject/cancel peace pattern to copy for non-aggression.
- `supabase/migrations/0061_diplomacy_declare_war.sql` — the RPC this plan extends.
- `supabase/migrations/0060_claim_started_event.sql` + `.verification.sql` — the exact "widen CHECK constraint, add world_event, verify via rollback" pattern to copy for every migration in this plan.
- `lib/diplomacy/api.ts`, `lib/diplomacy/types.ts`, `app/diplomacy/page.tsx`, `components/diplomacy/WarList.tsx`, `components/diplomacy/PeaceOfferList.tsx` — frontend patterns to copy.
- `components/territories/GarrisonModal.tsx` — already has the "⚔️ Vyhlásit válku" button (search for `onDeclareWar`) to make relation-aware.
- `components/world/WorldEventsFeed.tsx`, `lib/world/api.ts` (`WorldEventType`) — event-type wiring pattern (see how `claim_started` was added).
- Live DB access: this project applies migrations via a temporary Node+`pg` script reading `.env.local` (see prior session pattern — split env file on `/\r?\n/`, never `'\n'` alone, to avoid a CRLF regex bug) — write, run, delete each temp script; never leave one behind.

---

## Task 1: Migration — schema + RLS

**Files:**
- Create: `supabase/migrations/0062_coalitions_schema.sql`
- Create: `supabase/migrations/0062_coalitions_schema.verification.sql`

- [ ] **Step 1**: Write `0062_coalitions_schema.sql`:
  - Widen `world_events.event_type` CHECK (drop/re-add, copy `0060`'s pattern) to add: `coalition_created`, `coalition_member_joined`, `coalition_member_left`, `coalition_member_kicked`, `coalition_leadership_transferred`, `coalition_disbanded`, `coalition_war_declared`, `coalition_peace_signed`, `non_aggression_signed`, `non_aggression_broken`.
  - Widen `diplomacy_relations` CHECK: drop `check (state = 'war')`, re-add `check (state in ('war', 'non_aggression'))`.
  - Widen `diplomacy_offers` CHECK: drop `check (kind in ('white_peace', 'tribute_peace'))`, re-add `check (kind in ('white_peace', 'tribute_peace', 'non_aggression'))`.
  - Create `coalitions` (id uuid pk default gen_random_uuid(), name text not null, leader_id uuid not null references players(id), created_at timestamptz not null default now(), disbanded_at timestamptz). Name uniqueness is enforced only among **active** coalitions via a partial unique index (see Indexes below), not a plain column `unique` constraint — a disbanded coalition's name becomes reusable.
  - Create `coalition_members` (coalition_id uuid not null references coalitions(id), player_id uuid not null unique references players(id), joined_at timestamptz not null default now(), primary key (coalition_id, player_id)).
  - Create `coalition_invites` (id uuid pk default gen_random_uuid(), coalition_id uuid not null references coalitions(id), invited_player_id uuid not null references players(id), invited_by uuid not null references players(id), status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')), created_at timestamptz not null default now()).
  - Create `coalition_join_requests` (same shape as invites but `player_id` instead of `invited_player_id`/`invited_by`).
  - Indexes: `coalition_members(coalition_id)`, partial unique/plain indexes on `coalition_invites(coalition_id, invited_player_id) where status='pending'`, `coalition_join_requests(coalition_id, player_id) where status='pending'`, and a **partial unique** index `coalitions(name) where disbanded_at is null` (this is the sole enforcement of name uniqueness — see the `coalitions` table note above).
  - Enable RLS on all four new tables; `revoke all ... from public, anon, authenticated`; grant `select` to `authenticated`.
  - Policies: `coalitions` — select to everyone authenticated (no `using` restriction beyond auth). `coalition_members` — select to everyone authenticated. `coalition_invites` — select `using (auth.uid() = invited_player_id or auth.uid() in (select leader_id from coalitions where id = coalition_id))`. `coalition_join_requests` — analogous with `player_id`.
- [ ] **Step 2**: Write `0062_coalitions_schema.verification.sql` (transaction-wrapped, `rollback` at the end, per `0060`'s pattern): create two test players, insert a coalition + membership + invite + join request row, assert each new CHECK-widened value inserts without error (one `war`, one `non_aggression` relations row; one `white_peace`, one `non_aggression` offer row), assert RLS policies exist via `pg_policies` lookup, then `rollback`.
- [ ] **Step 3**: Apply the migration live via a temp Node+`pg` script (see Reference patterns), run the verification script, confirm success, delete the temp script.
- [ ] **Step 4**: Commit: `git add supabase/migrations/0062_coalitions_schema.sql supabase/migrations/0062_coalitions_schema.verification.sql && git commit -m "feat(db): add coalitions schema, non_aggression relation state"`.

## Task 2: Migration — non-aggression RPCs + extend `diplomacy_declare_war`

**Files:**
- Create: `supabase/migrations/0063_non_aggression.sql`
- Create: `supabase/migrations/0063_non_aggression.verification.sql`

- [ ] **Step 1**: Write `0063_non_aggression.sql`:
  - `diplomacy_propose_non_aggression(p_target_id uuid) returns uuid` — copy `diplomacy_propose_peace`'s shape but: reject self-target and NPC target (copy `diplomacy_declare_war`'s checks), lock pair, reject if a `war` row exists ("resolve the war first"), reject if a `non_aggression` row already exists, reject if caller/target already share a coalition, reject if a pending `non_aggression` offer already exists for this pair (either direction), insert a `diplomacy_offers` row with `kind = 'non_aggression'`, empty `offered_card_ids`, null `offered_territory_id`.
  - `diplomacy_accept_non_aggression(p_offer_id uuid) returns void` — copy `diplomacy_accept_peace`'s locking/re-validation shape (lock pair, re-check offer is pending + caller is target + no war row + no existing non_aggression row + not already in same coalition), delete any stray `diplomacy_relations` row for the pair defensively, insert `state='non_aggression'` row, mark offer `accepted`, cancel other pending offers between the pair, insert `non_aggression_signed` world_event (mirror `peace_signed`'s payload shape: both player ids/names/home coords).
  - `diplomacy_reject_non_aggression(p_offer_id uuid)` / `diplomacy_cancel_non_aggression(p_offer_id uuid)` — copy `diplomacy_reject_peace`/`diplomacy_cancel_peace` verbatim, swapped table filter to `kind = 'non_aggression'` (or no filter needed if offer id already scopes it).
  - `diplomacy_list_non_aggression_pacts()` — copy `diplomacy_list_wars`'s shape exactly (source: `diplomacy_relations where state = 'non_aggression'`, joined to the other player), returning **active pacts only**. Pending pact proposals are deliberately **not** duplicated into this RPC — the existing `diplomacy_list_offers()` already returns every pending offer involving the caller regardless of `kind`, so the frontend's Pakty tab (Task 8) combines `listNonAggressionPacts()` (active) with `listOffers()` filtered client-side to `kind === 'non_aggression'` (pending), exactly mirroring how the existing Nabídky míru section already works off the same `listOffers()` call filtered to peace kinds. This satisfies the spec's "active pacts + pending proposals" requirement without a second RPC duplicating `diplomacy_list_offers`' logic.
  - Extend `diplomacy_get_relation(p_other_player_id uuid)`: after the existing `war` check, add a check for a `non_aggression` relations row (return `'non_aggression'`), then a check for shared active coalition membership (return `'coalition'`, checked first/highest precedence — reorder so coalition check runs before war/non_aggression checks since it takes precedence per spec), else `'peace'`.
  - Modify (`create or replace`) `diplomacy_declare_war(p_target_id uuid)`: add a check before the existing `insert ... on conflict do nothing` — if caller and target share an active coalition, raise exception "cannot declare war on a coalition member". Add handling for an existing `non_aggression` row: if found, delete it first, insert a `non_aggression_broken` world_event (mirror `peace_signed`'s payload shape), then proceed with the existing war-row insert/event/notify logic unchanged (delete-then-insert instead of `on conflict do nothing` erroring, since a `non_aggression` row for this pair must be removed either way before the war row can be inserted — the pair's primary key is unaffected, so this is a plain `delete ... ; insert ...` sequence, no upsert needed here specifically for the pact-breaking case).
- [ ] **Step 2**: Write `0063_non_aggression.verification.sql` (rollback-wrapped): propose/accept a pact between two test players, assert `diplomacy_get_relation` returns `non_aggression` both directions; assert `diplomacy_propose_non_aggression` rejects self/NPC/already-at-war/already-pact/already-coalition; assert `diplomacy_reject_non_aggression` and `diplomacy_cancel_non_aggression` each correctly flip status and are rejected for the wrong caller (non-target rejecting, non-initiator cancelling); assert `diplomacy_declare_war` on a pact-holder deletes the pact, logs `non_aggression_broken` and `war_declared`, and results in `war` state; assert `diplomacy_declare_war` rejects targeting a coalition member (insert a minimal coalitions/coalition_members row pair directly for this check, since Task 3's RPCs don't exist yet in this migration's scope — fine to use raw inserts here).
- [ ] **Step 3**: Apply live, run verification, delete temp scripts.
- [ ] **Step 4**: Commit: `git commit -m "feat(db): non-aggression pact RPCs, extend diplomacy_declare_war"`.

## Task 3: Migration — coalition lifecycle + read RPCs

**Files:**
- Create: `supabase/migrations/0064_coalition_rpcs.sql`
- Create: `supabase/migrations/0064_coalition_rpcs.verification.sql`

- [ ] **Step 1**: Write `0064_coalition_rpcs.sql`. Add a helper `coalition_lock(p_coalition_id uuid)` (copy `diplomacy_lock_pair`'s shape, single-arg `pg_advisory_xact_lock(hashtext(p_coalition_id::text))`). Implement, each `security definer`, `set search_path = public`, revoke from `public, anon`, grant to `authenticated`:
  - `coalition_get_mine()` — returns the caller's active coalition (id, name, leader_id, leader_display_name, created_at) plus a `jsonb` array of members (player_id, display_name, joined_at, is_leader, is_online — join `players`) or a single null row if not a member. Also lazily require an active coalition filter (`disbanded_at is null`).
  - `coalition_list()` — all active coalitions: id, name, leader_display_name, member_count (subquery), capped implicitly at 10 by the schema, ordered by member_count desc, name asc.
  - `coalition_list_invites()` — pending invites where `invited_player_id = caller`, joined to coalition name/leader.
  - `coalition_list_join_requests(p_coalition_id uuid)` — leader-only (raise if caller isn't the coalition's leader), pending requests for that coalition joined to requester display name.
  - `coalition_create(p_name text) returns uuid` — reject if caller already in an active coalition (`exists (select 1 from coalition_members where player_id = caller)`), reject if `p_name` taken by an active coalition, insert coalition row + membership row for caller, insert `coalition_created` world_event.
  - `coalition_invite(p_coalition_id uuid, p_player_id uuid) returns uuid` — `coalition_lock`, verify caller is the coalition's leader, verify coalition is active and below 10 members, verify target not already in a coalition and has no existing pending invite/request for this coalition, insert invite row.
  - `coalition_request_join(p_coalition_id uuid) returns uuid` — verify caller not already in a coalition, verify target coalition active + below 10 members, verify caller is not at `war` with any current member (loop `coalition_members` and check `diplomacy_relations`), insert request row.
  - `coalition_accept_invite(p_invite_id uuid)` — look up invite, `coalition_lock`, verify caller is `invited_player_id` and status pending; then acquire `diplomacy_lock_pair` for the caller against every current member **in a fixed order** (`order by player_id`) before final validation; re-validate not-in-coalition / below-10 / not-at-war-with-any-member; on success insert membership row, mark invite `accepted`, cancel all other pending invites/requests for this caller (any coalition), delete any `non_aggression` relations rows between the caller and every current member, insert `coalition_member_joined` world_event; on any validation failure mark the invite `cancelled` and re-raise the specific error.
  - `coalition_accept_request(p_request_id uuid)` — same shape as `coalition_accept_invite` but caller must be the coalition's leader, request's `player_id` is the one joining.
  - `coalition_reject_invite` / `coalition_cancel_invite` / `coalition_reject_request` / `coalition_cancel_request` — straightforward status-flip companions (copy `diplomacy_reject_peace`/`diplomacy_cancel_peace` shape: reject = only the invited player / request's leader; cancel = only the leader who sent the invite / only the requester).
  - `coalition_kick(p_player_id uuid)` — `coalition_lock` on caller's coalition, verify caller is leader, verify target is a member and not the caller, delete membership row, insert `coalition_member_kicked` world_event.
  - `coalition_transfer_leadership(p_new_leader_id uuid)` — `coalition_lock`, verify caller is leader, verify target is a current member, update `coalitions.leader_id`, insert `coalition_leadership_transferred` world_event.
  - `coalition_leave()` — `coalition_lock`, if caller is not the leader: delete membership row, insert `coalition_member_left` event. If caller is the leader: if other members exist, raise exception "transfer leadership before leaving"; else call the same logic as `coalition_disband()` (extract disband's body into a private helper `_coalition_disband_core(p_coalition_id uuid)` called by both `coalition_leave` and `coalition_disband` to avoid duplicating the disband steps).
  - `coalition_disband()` — verify caller is leader, call `_coalition_disband_core`: delete all `coalition_members` rows for the coalition, set `disbanded_at = now()`, mark every pending invite/request for the coalition `cancelled`, insert `coalition_disbanded` world_event.
  - `coalition_declare_war(p_target_id uuid)` — verify caller is leader, reject if target is a member of caller's own coalition (including target = caller, though caller can't target themself as a non-member anyway), reject if target is NPC, loop every current member and reuse `diplomacy_declare_war`'s core logic (extract that RPC's body below the initial self/NPC checks into a private helper `_diplomacy_declare_war_core(p_caller uuid, p_target_id uuid)` in this migration via `create or replace function diplomacy_declare_war` calling the shared core — this migration modifies `diplomacy_declare_war` again to delegate to the new shared core, and `coalition_declare_war` calls the same core per member). Each per-member call to `_diplomacy_declare_war_core` still logs its own individual `war_declared` world_event and both `_notify()` calls exactly as `diplomacy_declare_war` already does today (unchanged — no special-casing for the coalition-triggered case) — in addition, `coalition_declare_war` inserts **one extra** `coalition_war_declared` world_event after the loop, summarizing all affected members (member ids/names + target id/name) in a single payload, so the world feed shows one coalition-level headline plus the existing per-pair `war_declared` entries underneath (not one event per member for the coalition-level event, to avoid feed spam).
  - `coalition_declare_peace(p_target_id uuid)` — verify caller is leader. **Correction (confirmed against live repo): `_diplomacy_propose_peace_core(p_caller_id uuid, p_target_id uuid, p_kind text, p_offered_card_ids uuid[] default '{}'::uuid[], p_offered_territory_id integer default null) returns uuid` already exists** (created in `supabase/migrations/0050_npc_diplomacy.sql` for NPC diplomacy, with `execute` already revoked from `public, anon, authenticated` — i.e. callable only from other `security definer` functions, which is exactly what's needed here). Do **not** re-extract or redefine it. `coalition_declare_peace` simply loops every current member currently at `war` with the target and calls the existing `_diplomacy_propose_peace_core(member_id, p_target_id, 'white_peace', '{}'::uuid[], null)` for each, skipping any pair that already has a pending offer (the core's own duplicate-offer check already handles this — catch and swallow only that specific exception per member, re-raising any other exception). Insert one `coalition_peace_signed` world_event summarizing which members had a peace offer proposed (this event name denotes "coalition-initiated peace proposal", not final signature — actual acceptance remains per-member and asynchronous, per the spec). Before writing this RPC, fetch the live definition of `_diplomacy_propose_peace_core` via `pg_get_functiondef` to confirm its exact signature/behavior/exception shape (e.g. what it raises on duplicate offer) rather than relying on this plan's paraphrase.
- [ ] **Step 2**: Write `0064_coalition_rpcs.verification.sql` (rollback-wrapped): create 3+ test players; exercise: create, invite+accept, request+accept, capacity rejection at 10 (create 9 more dummy players cheaply or lower a local check — simplest: verify the capacity check logic directly against a coalition seeded with 10 `coalition_members` rows inserted directly, then assert `coalition_invite`/`coalition_request_join`/`coalition_accept_invite` all reject), a player with a pending invite to coalition A and a pending join request to coalition B — accepting one cancels the other (assert both end up non-pending), kick, transfer leadership, leave (non-leader), leave-as-sole-leader auto-disbands, disband cancels pending invites/requests and sets `disbanded_at` without deleting the row (and a new coalition can immediately reuse the disbanded one's name), kicking or a member leaving does **not** touch that member's unrelated pending invites/requests to any *other* coalition (only actions on *this* coalition's own pending rows are affected), join blocked while at war with a member, join allowed with an existing pact (and pact deleted after join), `coalition_declare_war` rejects targeting own member, `coalition_declare_war` creates war rows for every member plus one `coalition_war_declared` event in addition to each member's own `war_declared` event, `coalition_declare_peace` creates individual pending `white_peace` offers per at-war member without deleting any war row (and skips a member that already has a pending peace offer for that target instead of erroring).
- [ ] **Step 3**: Apply live, run verification, delete temp scripts.
- [ ] **Step 4**: Commit: `git commit -m "feat(db): coalition lifecycle RPCs (create/invite/join/leave/kick/war/peace)"`.

## Task 4: Migration — attack/claim enforcement guard

**Files:**
- Modify: `supabase/migrations/0065_coalition_attack_enforcement.sql` (new file; `create or replace function` on the existing `_declare_attack_core` and `_start_claim_core` — fetch their live current bodies via a temp `pg_get_functiondef` script first, exactly as done for `_start_claim_core` in `0060`, then add the new guard without altering any other existing logic).
- Create: `supabase/migrations/0065_coalition_attack_enforcement.verification.sql`

- [ ] **Step 1**: Fetch live bodies of `_declare_attack_core` and `_start_claim_core` via a temp Node+`pg` script (`select pg_get_functiondef(oid) from pg_proc where proname = '...'`), save locally for diffing, delete the temp script after.
- [ ] **Step 2**: Write `0065_coalition_attack_enforcement.sql`: `create or replace` both functions, inserting one new check near the top (after existing null/self checks, before any locking/mutation) that raises `'cannot attack/claim: target is a coalition member or under a non-aggression pact'` when the acting player and the target territory's `owner_id` (a) share an active coalition, or (b) have a `non_aggression` relations row. Diff the new body against the fetched original byte-for-byte except for the inserted guard, to confirm no other behavior changed. **Before writing this step**, grep the migrations directory for any additional function that initiates a hostile troop movement against another player's territory outside of `_declare_attack_core`/`_start_claim_core` (e.g. check whether "transfer to a hostile territory" mentioned in the spec is actually a distinct code path or just routes through `_declare_attack_core` already) — if a third function is found, add the same guard to it; if not, note in the migration's comment header that transfers to hostile territory are confirmed to route through `_declare_attack_core` and need no separate guard.
- [ ] **Step 3**: Write `0065_coalition_attack_enforcement.verification.sql` (rollback-wrapped): two players in the same coalition — attacking/claiming each other's territory raises the expected exception; two players with a `non_aggression` pact — same; two players with neither — attack/claim proceeds as before (smoke check that normal behavior is unaffected).
- [ ] **Step 4**: Apply live, run verification, delete temp scripts.
- [ ] **Step 5**: Commit: `git commit -m "feat(db): block attacks/claims between coalition members and pact holders"`.

## Task 5: Frontend types + API wrappers

**Files:**
- Modify: `lib/diplomacy/types.ts`
- Modify: `lib/diplomacy/api.ts`
- Modify: `lib/diplomacy/api.test.ts`

- [ ] **Step 1**: In `types.ts`: widen `DiplomacyRelationState` to `'war' | 'non_aggression' | 'peace' | 'coalition'`; widen `PeaceOfferKind` to include `'non_aggression'`; add `CoalitionMember`, `CoalitionSummary` (list-view shape), `CoalitionDetail` (mine-view shape with members array), `CoalitionInviteRow`, `CoalitionJoinRequestRow` interfaces matching the RPC return shapes from Task 3.
- [ ] **Step 2**: In `api.ts`, add wrapper functions (copy the existing `supabase.rpc(...)` wrapper shape exactly) for every new RPC: `proposeNonAggression`, `acceptNonAggression`, `rejectNonAggression`, `cancelNonAggression`, `listNonAggressionPacts`, `getMyCoalition`, `listCoalitions`, `listCoalitionInvites`, `listCoalitionJoinRequests`, `createCoalition`, `inviteToCoalition`, `requestJoinCoalition`, `acceptCoalitionInvite`, `acceptCoalitionJoinRequest`, `rejectCoalitionInvite`, `cancelCoalitionInvite`, `rejectCoalitionJoinRequest`, `cancelCoalitionJoinRequest`, `kickCoalitionMember`, `transferCoalitionLeadership`, `leaveCoalition`, `disbandCoalition`, `declareCoalitionWar`, `declareCoalitionPeace`.
- [ ] **Step 3**: Add Jest tests in `api.test.ts` for each new wrapper (copy the existing `declareWar` test shape — assert the correct RPC name and params are passed).
- [ ] **Step 4**: Run `npx jest lib/diplomacy/api.test.ts` — expect all pass.
- [ ] **Step 5**: Commit: `git commit -m "feat(frontend): diplomacy/coalition API wrappers and types"`.

## Task 6: `GarrisonModal` relation-aware badge/button

**Files:**
- Modify: `components/territories/GarrisonModal.tsx`
- Modify: `components/territories/GarrisonModal.test.tsx`

- [ ] **Step 1**: Locate the existing war badge/`onDeclareWar` button block. Extend the relation-state handling to branch on `'coalition'` (render a "🤝 Koalice" badge, hide the declare-war button entirely) and `'non_aggression'` (render a "🕊️ Pakt" badge, keep the button visible but change its label to "⚔️ Zrušit pakt a vyhlásit válku" and tooltip explaining it will break the pact).
- [ ] **Step 2**: Add/adjust tests in `GarrisonModal.test.tsx` covering both new states (badge text, button presence/label per state).
- [ ] **Step 3**: Run `npx jest components/territories/GarrisonModal.test.tsx` — expect all pass.
- [ ] **Step 4**: Commit: `git commit -m "feat(frontend): relation-aware badge/button in GarrisonModal"`.

## Task 7: `WorldEventsFeed` new event types

**Files:**
- Modify: `lib/world/api.ts` (`WorldEventType` union)
- Modify: `components/world/WorldEventsFeed.tsx`
- Modify: `components/world/WorldEventsFeed.test.tsx`

- [ ] **Step 1**: Add all ten new event type strings to `WorldEventType` (see Task 1's list).
- [ ] **Step 2**: In `WorldEventsFeed.tsx`, add a Czech rendering case for each new type in both `formatWorldEventText`/`renderEventText` (copy the `claim_started`/`war_declared` pattern; suggested Czech phrasing: "založil korunu Koalice X", "vstoupil do koalice X", "opustil koalici X", "byl vyhozen z koalice X", "předal vedení koalice X hráči Y", "rozpustil koalici X", "koalice X vyhlásila válku hráči Y", "koalice X navrhla mír hráči Y", "uzavřel pakt o neútočení s hráčem X", "zrušil pakt o neútočení s hráčem X").
- [ ] **Step 3**: Add tests for each new event type's rendering.
- [ ] **Step 4**: Run `npx jest components/world/WorldEventsFeed.test.tsx` — expect all pass.
- [ ] **Step 5**: Commit: `git commit -m "feat(frontend): render coalition/pact world events"`.

## Task 8: Diplomacy page — tabs, Koalice section, Pakty section

**Files:**
- Modify: `app/diplomacy/page.tsx`
- Create: `components/diplomacy/DiplomacyTabs.tsx`
- Create: `components/diplomacy/CoalitionPanel.tsx`
- Create: `components/diplomacy/PactList.tsx`
- Create: `components/diplomacy/CoalitionPanel.test.tsx`
- Create: `components/diplomacy/PactList.test.tsx`
- Modify: `app/diplomacy/page.test.tsx`

- [ ] **Step 1**: Create `DiplomacyTabs.tsx` — a small presentational tab switcher (`'wars' | 'peace' | 'coalition' | 'pacts'`) matching the approved mockup's pill style (`rounded-xl bg-zinc-900 p-1`, active tab `bg-amber-600 text-white`).
- [ ] **Step 2**: Create `CoalitionPanel.tsx` — props: `myCoalition: CoalitionDetail | null`, `coalitions: CoalitionSummary[]`, `invites`, `joinRequests`, `currentPlayerId`, and callbacks for every coalition action. Renders the two states from the approved mockup (member list with leader actions; browse-and-request-join list with create button). Mobile-first single-column layout per the mockup.
- [ ] **Step 3**: Create `PactList.tsx` — copy `PeaceOfferList.tsx`'s structure/props shape, adapted for non-aggression pacts (propose/accept/reject/cancel). Data source: combine `listNonAggressionPacts()` (active pacts, rendered as an always-on relation, no action buttons besides "view on map") with `listOffers()` filtered client-side to `offer.kind === 'non_aggression'` (pending proposals, rendered with accept/reject/cancel exactly like `PeaceOfferList` already does for peace offers) — mirrors how the existing "Nabídky míru" section already gets its data from the one `listOffers()` call.
- [ ] **Step 4**: Wire all of the above into `app/diplomacy/page.tsx`: add state + `load()` calls for the new data (`getMyCoalition`, `listCoalitions`, `listCoalitionInvites`, `listNonAggressionPacts`), add the `DiplomacyTabs` switcher, render `CoalitionPanel`/`PactList` in their tabs, wire every callback to its `api.ts` function followed by `await load()` (copy the existing `handleAccept`/`handleReject` pattern), and pass `relationState`/badge data through to `GarrisonModal` call sites in `app/map/page.tsx` (extend the existing `getRelation` usage to handle the two new states).
- [ ] **Step 5**: Write/extend tests: `CoalitionPanel.test.tsx`, `PactList.test.tsx` (new), extend `app/diplomacy/page.test.tsx` for the new tabs and data loading.
- [ ] **Step 6**: Run `npx jest components/diplomacy app/diplomacy` — expect all pass.
- [ ] **Step 7**: Commit: `git commit -m "feat(frontend): coalition and non-aggression pact UI on diplomacy page"`.

## Task 9: Final verification and PROGRESS.md update

- [ ] **Step 1**: Run `npx tsc --noEmit` — expect no errors.
- [ ] **Step 2**: Run the full Jest suite (`npx jest`) — expect all green (aside from the already-known pre-existing flaky `app/catalog/page.test.tsx` timing test).
- [ ] **Step 3**: Update `docs/superpowers/PROGRESS.md` — mark backlog #30 phase 1 (coalitions core) done, note phases 2 (troop lending) and 3 (shared visibility) as the remaining follow-on work, per the spec's phase breakdown.
- [ ] **Step 4**: Commit: `git commit -m "docs: update PROGRESS.md for coalitions core completion"`.
- [ ] **Step 5**: Report back with a summary of what was built and ask whether to push.
