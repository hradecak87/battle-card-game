# Diplomacy Module Implementation Plan

> **For agentic workers:** Implement this plan end-to-end in your own git worktree/branch, TDD throughout, committing after each chunk.

**Goal:** Add a war/peace diplomacy layer on top of the existing PvP conquest system, per the approved design spec.

**Architecture:** Two new tables (`diplomacy_relations`, `diplomacy_offers`) + RPCs following the existing trade-offer/world-events conventions; a war row is created automatically when one player attacks another player's occupied territory; peace (white or tribute) is negotiated via propose/accept/reject/cancel RPCs with pair-level advisory locking; a new `/diplomacy` page plus war badges on `/map`/profile and two new world-feed event types.

**Tech Stack:** Next.js 14 + TypeScript + Tailwind, Supabase/Postgres (SQL migrations, `security definer` RPCs, RLS), Jest + React Testing Library.

Source spec: `docs/superpowers/specs/2026-08-20-diplomacy-design.md` — **read it in full before starting**, it contains all validation/concurrency rules this plan references but doesn't repeat verbatim.

---

## Parallel-work note

This plan may execute alongside other background agents in sibling
worktrees. Reserve migration numbers starting at **0043** — before applying
anything live, run `git log --all --oneline -- supabase/migrations` and
`ls supabase/migrations` **on `main`** (fetch latest first) to confirm 0043+
is still free; if not, pick the next free number and document the deviation.
Do not touch any files belonging to other in-flight features.

## Setup

- Create worktree `.worktrees/diplomacy` on branch `feat/diplomacy`, branched
  from current `main`.
- Do all work inside that worktree.
- Follow TDD: write failing tests, then implement, for every chunk. Commit
  after each chunk. Run `npx jest` and `npx tsc --noEmit` after each
  code-touching chunk. Do not push — leave the branch local for the
  orchestrating session to review/merge.

## Chunk 1 — Schema + RLS migration

File: `supabase/migrations/00NN_diplomacy.sql` (NN = verified free number),
plus `00NN_diplomacy.verification.sql`.

- Before writing anything, inspect the live `world_events` table's
  `event_type` CHECK constraint (`\d+ world_events` or query
  `information_schema`/`pg_constraint`) to get its exact current definition,
  then write a statement that drops and recreates it with `'war_declared'`
  and `'peace_signed'` added to the allowed list (don't hand-copy the list
  from `0034_world_events.sql` blindly — it may have changed since).
- Create `diplomacy_relations` and `diplomacy_offers` exactly per the
  spec's Data Model section (columns, PK, unique constraints — including
  the partial unique index enforcing at most one pending offer per
  initiator/target pair).
- Enable RLS on both tables per the spec's RLS section. `revoke all ...
  from public, anon` on both.
- Verification script: confirm a third player cannot select another pair's
  relation/offer row; confirm the partial unique index actually rejects a
  second pending offer from the same initiator to the same target; confirm
  the `world_events` CHECK now accepts `'war_declared'`/`'peace_signed'`
  (insert-then-rollback a row of each type). Roll back at the end.

## Chunk 2 — War creation wired into attack declaration

File: `supabase/migrations/00NN_diplomacy_war_creation.sql` +
`.verification.sql`.

- First, grep fresh for the canonical `declare_attack` function — do not
  trust that it's still in `0027_npc_kingdoms.sql`; check every migration
  that redefines it (search `create or replace function declare_attack`)
  and confirm which one is live by checking `pg_proc`/`information_schema.routines`
  against the actual DB, or simply re-run the search across all migration
  files and take the highest-numbered one as canonical (matches the
  project's own established pattern of superseding redefinitions).
- Redefine that function (in this new migration, not by editing the old
  file) to add: when the attack target territory has a non-null
  `owner_id` that is a real player (not an NPC account — check how NPCs
  are distinguished, e.g. a flag on `players` or a known NPC id set; look
  at `0027_npc_kingdoms.sql` for how NPC ownership is identified) and is
  not the caller, insert into `diplomacy_relations`
  (`player_a_id/player_b_id` as `least/greatest` of caller and owner)
  `on conflict do nothing`, and if a row was actually inserted (use
  `insert ... returning` or check `found`), log a `world_events` row
  (`event_type = 'war_declared'`) reusing the exact logging helper/pattern
  already used for `attack_declared` events in
  `0035_wire_world_events.sql`.
- Verification script: attacking a player you're not yet at war with
  creates exactly one `diplomacy_relations` row and one `world_events` row;
  attacking the same player again does not create a duplicate row or a
  second `war_declared` event; attacking an NPC-owned or empty territory
  creates no relation row.

## Chunk 3 — Core diplomacy RPCs

File: `supabase/migrations/00NN_diplomacy_rpcs.sql` + `.verification.sql`.

Implement, all `security definer` with a pinned `search_path`, `revoke ...
from public, anon`, `grant execute to authenticated`:

- `diplomacy_get_relation(p_other_player_id uuid)`
- `diplomacy_list_wars()`
- `diplomacy_propose_peace(p_target_id uuid, p_kind text, p_offered_card_ids uuid[] default '{}', p_offered_territory_id int default null)`
- `diplomacy_accept_peace(p_offer_id uuid)`
- `diplomacy_reject_peace(p_offer_id uuid)`
- `diplomacy_cancel_peace(p_offer_id uuid)`

Implement every validation rule and the concurrency/locking approach
exactly as specified in the spec's "Backend RPCs" section (advisory lock
first in propose/accept/reject/cancel, `for update` row locks on
cards/territory/offers, lazy-expiry of stale pending offers before the
uniqueness check, in-battle rejection on accept, deck-limit-aware card
destination on accept — reuse the existing deposit-routing function from
`0029_card_limit_deposit.sql` rather than reimplementing it, exact
`world_events` logging on peace signed).

Verification script covering (at minimum):
- Proposing peace with no existing war is rejected.
- Tribute proposal is rejected for: a card the caller doesn't own, a card
  stationed on a battle-locked territory, a home territory, an occupied
  territory, a territory under claim/battle lock or with an incoming
  movement, a territory the caller doesn't own.
- A second pending offer to the same target while one is already pending
  is rejected; after the first expires (test by backdating
  `expires_at`), a new proposal succeeds.
- Accepting peace transfers the cards (verify deck-limit vs. deposit
  routing both paths) and the territory, deletes the war row, cancels
  other pending offers between the pair, logs `peace_signed`.
- Accepting peace is rejected while an unresolved battle exists between
  the pair.
- A third player cannot accept/reject/cancel an offer they're not party to.

## Chunk 4 — Client API wrappers

File: `lib/diplomacy/api.ts` (+ `lib/diplomacy/api.test.ts`, mirror the
mocking pattern used in `lib/trading/api.test.ts` or `lib/world/api.test.ts`),
types in `lib/diplomacy/types.ts`.

Thin 1:1 wrappers for each RPC (`getRelation`, `listWars`,
`proposePeace`, `acceptPeace`, `rejectPeace`, `cancelPeace`), typed
request/response shapes matching the RPC outputs.

## Chunk 5 — Presentational components

Files under `components/diplomacy/` (follow the structure/testing
conventions of `components/chat/` or `components/world/` — co-located
`.test.tsx` per component):

- `WarList` — active wars with other player name/kingdom, home-coordinate
  map link (`mapLink` pattern from `components/world/WorldEventsFeed.tsx`),
  time started, "Navrhnout mír" button.
- `PeaceProposalForm` — white peace vs. tribute toggle, card picker (check
  whether an existing generic card-picker component from
  `components/trading/` can be reused as-is or via a thin wrapper before
  building a new one), territory picker limited to the caller's non-home,
  garrison-free territories (fetch via a lightweight query — check if an
  existing "my territories" list API already exposes garrison/home status
  to filter client-side, e.g. `getMyTerritories`/`MyTerritory` type from
  `app/map/page.tsx`'s imports).
- `PeaceOfferList` — incoming/outgoing pending offers with
  accept/reject/cancel actions and a clear description of what's offered.
- Each gets a mobile-portrait-viewport test case (check how existing
  responsive components in this repo test that, e.g. chat components).

## Chunk 6 — Page, nav entry, war badges, world-feed event types

- New route `app/diplomacy/page.tsx`: two sections ("Moje války" /
  "Nabídky míru") from chunk 5's components. Mobile portrait: both
  sections full-width stacked (not side-by-side); `PeaceProposalForm` opens
  as a fullscreen overlay on mobile, reusing the same overlay pattern as
  `components/chat/ChatWidget.tsx`. Polling via
  `components/chat/useVisiblePolling.ts` (reuse directly, it's already
  generic), ~10–15s interval while visible.
- Add "Diplomacie" to `MainNav` alongside the existing `/world` and `/chat`
  entries (check `components/navigation/MainNav.tsx` current state — other
  features may have added entries since this plan was written; add yours
  independently, don't assume a specific prior line to anchor on).
- War badge: small "⚔️ Válka" indicator on `/map` tile detail view and on
  player profile pages (`app/profile/[id]/page.tsx` or similar — check
  current structure) when `diplomacy_get_relation` returns `'war'` for the
  viewed player; links to `/diplomacy`.
- `WorldEventsFeed` (`components/world/WorldEventsFeed.tsx`): add renderers
  for `war_declared` and `peace_signed`, following the exact same
  `mapLink`/message-composition pattern already used for other event types
  in that file.

## Chunk 7 — Final verification & docs

- Full suite: `npx jest`, `npx tsc --noEmit`, `npm run build`.
- Apply all migrations live via a scratch Node script using
  `SUPABASE_DB_URL` from `.env.local` (strip trailing `\r` per the
  documented gotcha), run each `.verification.sql` rolled back, then delete
  the scratch script.
- Update `docs/superpowers/PROGRESS.md` with a dated entry: migration
  numbers actually used, canonical `declare_attack` location found (in case
  it differs from what earlier chunks assumed), polling interval chosen,
  any deviations from this plan and why.
- Do not push. Report back with: migration numbers used, test counts,
  deviations, and current branch/worktree state.
