# World Activity Feed ("Dění ve světě") Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new public `/world` page showing live attacks-in-transit,
claims-in-progress, and active-battles lists, plus a paginated "recently
happened" history feed backed by a new append-only `world_events` log
table, with map deep-links from every player/territory reference.

**Architecture:** New `world_events` table + `security definer` writer
inserts added to the existing canonical SQL functions that already perform
each action (attack declare, claim completion, battle finalize/surrender,
recall, abandon, king relocate, XP award, new-player trigger). Three new
public read RPCs derive live-section data directly from current table
state (no new tables needed for those); one new public read RPC serves
the paginated history feed from `world_events`. Client: one API wrapper
module, four presentational list components, one page, plus a small
`?x=&y=` deep-link addition to the existing map page.

**Tech Stack:** Next.js 14 (App Router) + TypeScript, Supabase/Postgres
(SQL migrations applied live via `pg.Client`/`SUPABASE_DB_URL`, established
pattern — see any `supabase/migrations/00NN_*.sql` + matching
`.verification.sql`), Jest + Testing Library, Tailwind.

**Read first:** `docs/superpowers/specs/2026-08-20-world-activity-feed-design.md`
(the approved design — has the full event-type table, RPC list, and the
important review-driven corrections about per-row claim logging,
surrender/win de-duplication, pagination clamping, and canonical function
ownership). Do not skip re-verifying "canonical owner" function locations
via `grep -n "create or replace function <name>"` across
`supabase/migrations/*.sql` before editing — migration numbers may have
shifted since the spec was written.

---

## Chunk 1: `world_events` table + RLS + grants

**Files:**
- Create: `supabase/migrations/0034_world_events.sql`
- Create: `supabase/migrations/0034_world_events.verification.sql`

- [ ] **Step 1: Write the migration**

```sql
-- World activity feed: append-only event log + RLS lockdown.
-- No deletion/pruning for now (future admin cap tool is out of scope).

create table world_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'attack_declared', 'territory_claimed', 'battle_won',
    'battle_surrendered', 'territory_abandoned', 'attack_recalled',
    'king_relocated', 'player_leveled_up', 'player_joined'
  )),
  created_at timestamptz not null default now(),
  payload jsonb not null
);

create index world_events_created_at_idx on world_events (created_at desc, id desc);

alter table world_events enable row level security;
-- Intentionally no insert/update/delete policy for anon/authenticated —
-- all writes go through security-definer functions only. Reads happen
-- exclusively via the world_list_events() RPC (also security definer),
-- so no select policy is needed either.

revoke all on world_events from public, anon, authenticated;
```

- [ ] **Step 2: Write the verification script**

Follow the pattern in `supabase/migrations/0029_card_limit_deposit.verification.sql`
(begin/rollback transaction). Assert the table + index + check constraint
exist (`to_regclass('world_events')`, query `pg_indexes`, try inserting an
invalid `event_type` and expect it to raise), then roll back.

- [ ] **Step 3: Apply live and verify**

Apply via `pg.Client`/`SUPABASE_DB_URL` (see any prior migration's
application for the exact node snippet pattern used in this repo's
history). Run the verification script's assertions against the live DB
inside a rolled-back transaction. Confirm success before proceeding.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0034_world_events.sql supabase/migrations/0034_world_events.verification.sql
git commit -m "Add world_events log table (backlog #13)"
```

---

## Chunk 2: Wire event logging into existing write paths

**Files:**
- Create: `supabase/migrations/0035_wire_world_events.sql`
- Create: `supabase/migrations/0035_wire_world_events.verification.sql`

Before writing any code in this chunk, run:
```
grep -n "create or replace function declare_attack" supabase/migrations/*.sql
grep -n "create or replace function resolve_due_movements" supabase/migrations/*.sql
grep -n "create or replace function _finalize_battle" supabase/migrations/*.sql
grep -n "create or replace function recall_attack" supabase/migrations/*.sql
grep -n "create or replace function abandon_territory" supabase/migrations/*.sql
grep -n "create or replace function relocate_home" supabase/migrations/*.sql
grep -n "create or replace function _award_xp" supabase/migrations/*.sql
grep -n "create or replace function handle_new_user" supabase/migrations/*.sql
```
For each, take the **last** matching file (highest migration number) as the
canonical current definition, and copy its full body verbatim into this new
migration's `create or replace function ...` block, adding only the new
`insert into world_events (...)` statement(s) at the appropriate point.
Do not restructure existing logic. Do not change existing behavior.

- [ ] **Step 1: `declare_attack` → `attack_declared`**

Confirm there is exactly one canonical implementation (the spec notes a
JSONB-array overload as canonical with a possible legacy-array overload
that just delegates to it as of 2026-08-20 — re-verify this is still true).
Add the insert **only** inside the canonical implementation (or a shared
`_declare_attack_core` if one exists), immediately before the successful
return, with payload: attacker id/display_name/home x/y, target territory
id/x/y.

- [ ] **Step 2: `resolve_due_movements` → `territory_claimed` (per-row, not set-based)**

This is the trickiest one. The claim-completion branch currently does a
set-based `UPDATE ... where claim_transfer_arrives_at <= now() and
claim_occupation_completes_at <= now()` (verify exact condition in the
current code) that can complete multiple claims in one invocation. Convert
this specific `UPDATE` to use a `RETURNING` clause (or wrap it in a `for
row in ... loop` if the existing code structure makes that cleaner) so one
`world_events` row gets inserted per completed claim, with payload:
claiming player id/display_name/home x/y, territory id/x/y. Do not change
which rows get updated or the update's actual column assignments — only
add the ability to observe which rows were affected.

- [ ] **Step 3: `_finalize_battle` → `battle_won` / `battle_surrendered` (single event, no double-log)**

`surrender_battle()` calls `_finalize_battle()` — do **not** add a second
insert inside `surrender_battle()`, or every surrender produces two feed
rows. Inside `_finalize_battle` itself, determine the winner and whether
this resolution was a surrender (using the existing
`p_defender_surrendered` parameter — check if there's also a way to detect
an *attacker* surrender/walkover path in the same function, since the
event type differs semantically for "X vzdal se" vs a real fight); insert
exactly one `world_events` row per battle resolution with `event_type =
'battle_won'` for normal resolutions or `'battle_surrendered'` when a
surrender occurred, payload: winner id/display_name/home x/y, loser
id/display_name/home x/y, territory id/x/y.

- [ ] **Step 4: `recall_attack` → `attack_recalled`**

Insert after the recall succeeds, payload: player id/display_name/home
x/y, target territory id/x/y.

- [ ] **Step 5: `abandon_territory` → `territory_abandoned`**

Insert after the abandon succeeds, payload: player id/display_name/home
x/y, abandoned territory id/x/y.

- [ ] **Step 6: `relocate_home` → `king_relocated`**

Insert after the relocation succeeds, payload: player id/display_name, old
home x/y, new home x/y.

- [ ] **Step 7: `_award_xp` → `player_leveled_up`**

Only insert when the level actually increases (compare level-before vs
level-after using the existing `_level_for_xp` helper) — do not log every
XP award, only ones that cross a level boundary. Payload: player
id/display_name, new level.

- [ ] **Step 8: `handle_new_user` trigger function → `player_joined`**

This one has no `auth.uid()` — it fires from Supabase auth on signup, not
a player RPC call. Insert after the new `players` row is created, payload:
new player id/display_name.

- [ ] **Step 9: Write verification script**

Extend the pattern from `0029_card_limit_deposit.verification.sql`: for
each of the 8 write paths above, perform the action inside the transaction
and assert exactly one new `world_events` row of the expected
`event_type` appears with sane payload fields, then roll back everything.

- [ ] **Step 10: Apply live and verify**

Apply via `pg.Client`, run the verification script's assertions live
(rolled back), confirm success.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0035_wire_world_events.sql supabase/migrations/0035_wire_world_events.verification.sql
git commit -m "Wire world_events logging into existing action RPCs"
```

---

## Chunk 3: Live-state + history-feed read RPCs

**Files:**
- Create: `supabase/migrations/0036_world_read_rpcs.sql`
- Create: `supabase/migrations/0036_world_read_rpcs.verification.sql`

- [ ] **Step 1: `world_list_attacks_in_transit()`**

```sql
create or replace function world_list_attacks_in_transit()
returns table (
  movement_id uuid,
  attacker_id uuid,
  attacker_display_name text,
  attacker_home_x integer,
  attacker_home_y integer,
  target_territory_id integer,
  target_x integer,
  target_y integer,
  arrives_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  return query
  select
    tm.id,
    tm.player_id,
    p.display_name,
    home.x::integer,
    home.y::integer,
    tm.destination_territory_id,
    dest.x::integer,
    dest.y::integer,
    tm.transfer_arrives_at
  from troop_movements tm
  join players p on p.id = tm.player_id
  left join territories home on home.owner_id = tm.player_id and home.is_home = true
  join territories dest on dest.id = tm.destination_territory_id
  where tm.kind = 'attack'
    and tm.status = 'in_transit'
  order by tm.transfer_arrives_at asc;
end;
$$;

revoke execute on function world_list_attacks_in_transit() from public, anon;
grant execute on function world_list_attacks_in_transit() to authenticated;
```

(Verify the exact `troop_movements` column names — `status`, `id`,
`player_id`, `destination_territory_id`, `transfer_arrives_at` — against
the live schema/migrations before finalizing; adjust if names differ.)

- [ ] **Step 2: `world_list_claims_in_progress()`**

Same auth-required pattern. Select from `territories` where
`claim_locked_by is not null`, joining `players` for the claimant's
display name and their home territory's x/y, returning the claimed
territory's own id/x/y and `claim_occupation_completes_at`.

- [ ] **Step 3: `world_list_active_battles()`**

Same auth-required pattern. Select from `battles` where `status in
('awaiting_ready', 'active')`, joining `players` twice (attacker/defender,
defender may be null for NPC/empty-territory battles — use left join) for
display names and home coordinates, joining `territories` for the
contested territory's x/y, returning `status` too.

- [ ] **Step 4: `world_list_events(p_page integer default 0, p_page_size integer default 10)`**

```sql
create or replace function world_list_events(
  p_page integer default 0,
  p_page_size integer default 10
)
returns table (
  event_type text,
  created_at timestamptz,
  payload jsonb,
  total_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 0), 0);
  v_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 10);
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select least(count(*), 50) into v_total from world_events;

  -- Clamp so no combination of inputs can page past the most-recent-50 window.
  if v_page * v_page_size >= v_total then
    return;
  end if;

  return query
  select we.event_type, we.created_at, we.payload, v_total
  from world_events we
  order by we.created_at desc, we.id desc
  limit v_page_size
  offset v_page * v_page_size;
end;
$$;

revoke execute on function world_list_events(integer, integer) from public, anon;
grant execute on function world_list_events(integer, integer) to authenticated;
```

Double-check the `least(count(*), 50)` semantics only bound the *reported
total* — also confirm the underlying `order by ... limit ... offset` query
itself is additionally bounded so a caller can never actually retrieve
row 51+ even with a large `p_page`/`p_page_size` (the early-return above
handles this, but write a verification test that tries `p_page=10,
p_page_size=10` and asserts zero rows come back once there are fewer than
101 total events).

- [ ] **Step 5: Write verification script**

Create a few scratch `world_events` rows (various types/timestamps) inside
the transaction, call all 4 RPCs, assert expected shapes/ordering/pagination
clamping, then roll back.

- [ ] **Step 6: Apply live and verify**

Apply via `pg.Client`, run verification live (rolled back).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0036_world_read_rpcs.sql supabase/migrations/0036_world_read_rpcs.verification.sql
git commit -m "Add public world_list_* read RPCs for the world activity feed"
```

---

## Chunk 4: Client API wrappers

**Files:**
- Create: `lib/world/api.ts`
- Create: `lib/world/api.test.ts`

- [ ] **Step 1: Write failing tests** for 4 thin wrapper functions
  (`listAttacksInTransit`, `listClaimsInProgress`, `listActiveBattles`,
  `listWorldEvents(page, pageSize)`), mocking the Supabase client the same
  way `lib/admin/api.test.ts` does (check that file for the exact mock
  pattern used in this repo). Assert each calls
  `supabase.rpc('world_list_...', ...)` with the right args and returns
  `{ data, error }` passthrough.

- [ ] **Step 2: Run tests, confirm they fail** (functions don't exist yet).

- [ ] **Step 3: Implement `lib/world/api.ts`**

Thin wrappers only — no business logic, mirroring `lib/admin/api.ts`'s
style (typed row interfaces + `supabase.rpc(...)` calls, `as unknown as
Promise<{...}>` casts as needed for RPC typing, same as the existing file).

- [ ] **Step 4: Run tests, confirm they pass.**

- [ ] **Step 5: Commit.**

```bash
git add lib/world/api.ts lib/world/api.test.ts
git commit -m "Add client API wrappers for world activity feed RPCs"
```

---

## Chunk 5: List/feed components

**Files:**
- Create: `components/world/AttacksInTransitList.tsx` + `.test.tsx`
- Create: `components/world/ClaimsInProgressList.tsx` + `.test.tsx`
- Create: `components/world/ActiveBattlesList.tsx` + `.test.tsx`
- Create: `components/world/WorldEventsFeed.tsx` + `.test.tsx`

Each component takes its already-fetched row array as a prop (parent page
owns fetching/polling — keeps these components pure/testable, matching
existing patterns like `BattleHistoryList`/`MyMovementsPanel`).

- [ ] **Step 1: `AttacksInTransitList`** — TDD: write test first (renders
  rows with attacker name linking to `/map?x=<home_x>&y=<home_y>`, target
  linking to `/map?x=<target_x>&y=<target_y>`, ETA via the existing
  `formatEta` helper from `lib/time/formatEta.ts`; empty state text when
  the array is empty), then implement. Single-column stacked row layout on
  mobile (check `MyMovementsPanel.tsx` for the existing responsive
  row-wrap pattern and reuse the same Tailwind breakpoints/classes).

- [ ] **Step 2: `ClaimsInProgressList`** — same pattern, ETA from
  `claim_occupation_completes_at`.

- [ ] **Step 3: `ActiveBattlesList`** — same pattern, two player links
  (attacker/defender, defender link omitted/labeled "NPC" when null) +
  territory link + status label (`awaiting_ready` → "Čeká na ready",
  `active` → "Probíhá kolo N" using `current_round` if available on the
  RPC row — add it to the RPC in Chunk 3 if not already included).

- [ ] **Step 4: `WorldEventsFeed`** — takes `page`, `onPageChange`,
  `events`, `totalCount`, `pageSize` props. Renders each event's payload
  into the human-readable Czech sentence per the event-type table in the
  spec (one small pure helper function `formatWorldEventText(event)`,
  colocated in the same file or a sibling `formatWorldEventText.ts` if it
  grows — test it directly with all 9 event types). Shows relative
  timestamp (reuse or extend `formatEta`/existing relative-time helper if
  one exists — check `lib/time/` first) with the exact time as a `title`
  attribute for hover. Pagination controls (Předchozí/Další, disabled at
  edges, page indicator "Strana X / Y" computed from `totalCount`/`pageSize`).

- [ ] **Step 5: Run all new component tests, confirm pass.**

- [ ] **Step 6: Commit.**

```bash
git add components/world/
git commit -m "Add world activity feed presentational components"
```

---

## Chunk 6: Page + nav + map deep-link

**Files:**
- Create: `app/world/page.tsx` + `app/world/page.test.tsx`
- Modify: `components/navigation/MainNav.tsx` (+ its test)
- Modify: `app/map/page.tsx:64-65` (+ `app/map/page.test.tsx`)

- [ ] **Step 1: Add nav link** — add `{ href: '/world', label: 'Dění ve
  světě' }` to the logged-in `baseLinks` array in `MainNav.tsx` (no badge
  needed). Update `MainNav.test.tsx` if it asserts the exact link list.

- [ ] **Step 2: Map deep-link — write failing test first**

In `app/map/page.test.tsx`, add a case: render the page with
`useSearchParams` (or however Next's router is mocked elsewhere in this
test file — check existing mocks) returning `x=100&y=50`, assert
`centerX`/`centerY` end up as 100/50 (however that's observably testable
in this file already, e.g. via what gets passed to `MapViewport` mock, or
via the initial viewport-load call args).

- [ ] **Step 3: Implement the map deep-link**

In `app/map/page.tsx`, near the `centerX`/`centerY` `useState`
declarations (currently defaulting to 128/128), read `x`/`y` from
`useSearchParams()` on mount and use them as the initial state instead of
128/128 when both are present and parse as valid integers in range
[0, 255]; fall back to 128/128 otherwise. Keep this a one-time
initial-mount read, not a live sync (don't fight the existing "jump to
coordinates" input state).

- [ ] **Step 4: Run map page tests, confirm pass.**

- [ ] **Step 5: `app/world/page.tsx` — write failing test first**

In `app/world/page.test.tsx`: mock the 4 `lib/world/api.ts` functions,
render the page, assert all 4 sections render with mock data and that a
sample link's `href` is correct (e.g. `/map?x=12&y=34`).

- [ ] **Step 6: Implement `app/world/page.tsx`**

Composes the four components. On mount and every 30s thereafter
(`window.setInterval`, cleared on unmount — mirror `MainNav`'s existing
`pendingCount` polling `useEffect` exactly), re-fetch
`listAttacksInTransit`/`listClaimsInProgress`/`listActiveBattles` in
parallel (`Promise.all`). The events feed has its own `page` state,
fetches `listWorldEvents(page, 10)` on mount and whenever `page` changes
(not on the 30s timer). Mobile: single-column stacked sections (no
side-by-side grid at small breakpoints — check `app/collection/page.tsx`
for the existing responsive container pattern and reuse it).

- [ ] **Step 7: Run all tests, confirm pass.**

- [ ] **Step 8: Commit.**

```bash
git add app/world/ components/navigation/MainNav.tsx components/navigation/MainNav.test.tsx app/map/page.tsx app/map/page.test.tsx
git commit -m "Add /world page, nav link, and map ?x=&y= deep-link support"
```

---

## Chunk 7: Final verification + docs

- [ ] **Step 1: Run the full suite**

```
npx jest --runInBand --silent
```
Expected: all suites pass (baseline was 58/58, 442/442 before this
feature — expect the new suites on top of that).

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Build**

```
npm run build
```
Expected: succeeds (pre-existing unrelated warnings, if any, are fine).

- [ ] **Step 4: Re-confirm all live migrations (0034-0036) are applied**
  and re-run each `.verification.sql`'s assertions one final time against
  the live DB (rolled back), now that all chunks are in place together.

- [ ] **Step 5: Update `docs/superpowers/PROGRESS.md`** with a dated entry
  describing what was built (mirror the style of recent entries — see the
  top of the file for the format), including the new migration numbers,
  new route `/world`, and the map `?x=&y=` addition.

- [ ] **Step 6: Clean up any scratch/temp files** created during live-DB
  verification (check `git status` for stray untracked files before the
  final commit).

- [ ] **Step 7: Final commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "Finalize world activity feed: verified, docs updated"
```

Do **not** push — this project's convention is that push only happens
after explicit human approval.
