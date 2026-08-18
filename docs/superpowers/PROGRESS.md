## Latest update — 2026-08-18k (battle round hash fallback fixed on `fix/battle-round-hash`)

Battle round history no longer leaks raw card `instance_id` / UUID-like hashes
when a historical defender card was already captured earlier in the battle.

- Root cause: `components/battles/RoundHistory.tsx` still rendered round card
  names by searching only the **live** `attackerRoster` / `defenderPool`
  arrays. That breaks specifically for defeated defender cards, because
  `_resolve_round()` immediately transfers the losing card's `owner_id`, so
  the recomputed live `defenderPool` stops containing that historical card.
  The component then fell back to the raw `instance_id` string.
- Fix: `RoundHistory` now prefers the historical `round.attacker_card` /
  `round.defender_card` snapshots already returned by `get_battle()` (added in
  `0005_battle_round_breakdown.sql` exactly for post-capture historical
  rendering), only falling back to live roster lookup for legacy/missing data.
  If neither source is available, the UI now shows **`Neznámá jednotka`**
  instead of exposing a hash to the player.
- Added Jest coverage in `components/battles/RoundHistory.test.tsx` for the
  captured-defender scenario that previously rendered the UUID.

## Latest update — 2026-08-18 (exchange accepted-offer visibility bug fixed on `fix/exchange-accepted-offer`)

- Root cause confirmed: `listMyOffers()` intentionally returns all direct offers
  regardless of status, and `/exchange` rendered that array directly in
  **Moje nabídky**. The action handlers (`acceptOffer` / `rejectOffer` /
  `cancelOffer`) already awaited `loadAll()`, so the refetch path was not the
  primary bug; the stale visibility came from the missing client-side status
  filter after a successful refresh.
- `app/exchange/page.tsx` now derives an `activeMyOffers` view limited to
  `pending` + `countered`, uses that filtered array for the **Moje nabídky**
  tab, and clears the selected-offer detail when an offer leaves the active
  list after resolution.
- `app/exchange/page.test.tsx` now covers both:
  1. accepted offers fetched from `listMyOffers()` are hidden from
     **Moje nabídky** but still visible in **Historie**
  2. accepting a pending offer triggers the existing refetch path and the
     refreshed resolved offer disappears from **Moje nabídky**
- Verification in this worktree:
  - Full Jest suite: **337/337 passing**
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

## Backlog — 2026-08-18 (owner's overnight ideas + open roadmap items)

Owner sent a large batch of bugs/ideas after a sleepless night. Assessed by
the assistant with a difficulty (1=easiest .. 10=hardest) and priority
(1=lowest .. 10=highest) score. Nothing here is implemented yet except
where explicitly marked done below. Do NOT re-triage from scratch — update
status inline as items are picked up.

| # | Item | Difficulty | Priority | Status | Note |
|---|---|---|---|---|---|
| 1 | Battle results occasionally show a hash code instead of the opposing card | 2 | 9 | done | Fixed 2026-08-18k — `RoundHistory` now uses historical round card snapshots instead of leaking raw `instance_id` when a defender card was captured |
| 2 | Trading offers: show card thumbnails + tap-to-zoom detail (like on map territories) | 3 | 6 | pending | Reuse existing `CardZoomOverlay`/`TradingCard` |
| 3 | Show ETA / estimated battle duration before sending troops (claim/transfer/attack) | 4 | 7 | pending | Transfer ETA formula already exists; surface it in UI before confirming |
| 4 | Notification badge should be on "Směnárna" nav item, not "Profil" | 1 | 5 | **done** (`ed036a0`) | Fixed 2026-08-18 directly |
| 5 | Accepted trade offer still shows in the offer list | 2 | 8 | done | Fixed on `fix/exchange-accepted-offer`: "Moje nabídky" now filters to active (`pending`/`countered`) offers only; accepted offers remain discoverable in `Historie` |
| 6 | Allow selecting attacking troops from multiple owned territories at once (dropdown multi-check); total ETA = slowest/farthest | 6 | 5 | pending | Changes attack-declaration rules + aggregation logic + UI |
| 7 | Battle history in profile: one compact row per battle with drill-down to details | 3 | 4 | pending | UI refactor of existing component |
| 8 | Mobile card collection shows 1 card per row (portrait) — should be 3 per row | 2 | 7 | **done** (`ed036a0`) | Fixed 2026-08-18 directly |
| 9 | Multiple game servers via separate Supabase DBs per region (Europe/USA/Asia), chosen at login | 9 | 2 | pending | Major infra change; not needed at current player count |
| 10 | Attacks must go through adjacent/border territory — can't target a territory fully surrounded by another player's land | 7 | 6 | pending | Needs adjacency/reachability graph per player |
| 11 | Territory difficulty shown via terrain texture (1/5 grass .. 5/5 rock/sea) as tile background, castle/village drawn on top | 5 | 3 | pending | Mostly art asset work + render layering |
| 12 | New unit attribute: Speed (movement speed); group speed = slowest unit | 6 | 5 | pending | New stat, migration, affects all ETA formulas + balancing |
| 13 | "News feed" module: recent + upcoming attacks visible to all players | 6 | 4 | pending | Needs its own brainstorming session |
| 14 | Ability to recall/cancel an attack in transit; recalled troops must travel back the same duration | 6 | 5 | pending | New state-machine transition on movements/battles |
| 15 | Dynamic growth of rare/epic/legendary card supply as player count grows | 4 | 3 | pending | Adjust `total_supply` formula + one-off recompute migration |
| 16 | Limit on number of territories a player can be actively claiming at once | 3 | 5 | pending | Validation in `start_claim` |
| 17 | Limit on using the same card multiple times within one battle (e.g. max 3-5×) | 4 | 6 | pending | Battle-round card-selection logic change; real balance fix |
| 18 | Periodic audits: UX, architecture, security | — | 7 | pending | Process, not a feature — schedule recurring, not one-off |
| 19 | Ability to abandon/give up a territory (becomes unclaimed again) | 3 | 4 | pending | New action, clears `owner_id` |
| 20 | Show potential attacker the castle/village buffs before attacking | 2 | 6 | **done** (`27cc205`) | Fixed 2026-08-18: `DeclareAttackModal` now shows defender's castle/village bonus panel, reusing existing `structureBonus.ts` helpers |
| 21 | Estimated battle-success probability shown while selecting attack cards | 6 | 7 | pending | Can reuse `/arena` combat-probability logic, but N-card battle simulation is more complex |
| 22 | Ability to surrender mid-battle with whatever side currently holds | 5 | 5 | pending | New battle state + return-trip logic for attacker's remaining troops |
| 23 | Show attacker if defender is sending reinforcements; lock out reinforcements (and recall in-transit ones) once the battle arena is ready | 7 | 6 | pending | Complex state machine + race-condition handling; closes a real "wait out the timer" exploit |
| 24 | Timeout to auto-start a battle if nobody connects within e.g. 1 hour of arrival | 4 | 5 | pending | Extension of the existing `ready_deadline` pattern |
| 25 | Open question: does the attacker actually need to be online during battle, given defender cards are auto-picked? | 2 | 8 | pending | Foundational design question — resolving it simplifies items 3, 21, 23, 24 |
| 26 | Boost cards: split into territorial/defensive vs. offensive/military; opponent sees only count + rarity, not which cards (e.g. a "Rat" card that can flip an enemy unit without a combat round) | 8 | 6 | pending | Extends the already-planned `boost-cards-module` roadmap item |
| 27 | Card limit per player scaling with level; ability to "return a card to the central deck" (common/uncommon burn, rare+ recycles back into circulation since supply is limited) | 6 | 5 | pending | New card-economy mechanic |
| 28 | Add a "King" card that establishes a royal home city | 5 | 3 | pending | New special card + home-territory logic |
| 29 | Diplomacy module: default neutral relations, attacking declares war, diplomacy resolves it (e.g. tribute) | 8 | 3 | pending | Idea only, needs its own brainstorming, large scope |
| 30 | Coalition module: leader roles, combined armies for bigger battles | 9 | 2 | pending | Large scope, depends on diplomacy |
| 31 | Chat / messaging module between players/kingdoms | 5 | 4 | pending | Medium scope, needs realtime infra |

**Also still open from earlier roadmap discussions** (tracked in the session
`todos` table, not yet started):
- **Boost cards module** — new card type: territory-stationed % stat
  multipliers. Needs its own brainstorming (persistent/consumable, stacking,
  acquisition). Overlaps with/extends item 26 above.
- **Notifications module** — attack alerts + trade offer notifications,
  delivery mechanism TBD (email/push/in-app). Not designed yet. Overlaps
  with items 4, 13, 23 above.
- **Autonomous NPC world simulation** — scheduled server job (pg_cron/edge
  function) reusing existing claim/battle mechanics for NPC expansion and
  attacks. Most complex of the three; do last.

**Recommended order** (per assistant's assessment, not yet actioned):
1. Quick bugfixes first: items 1, 4, 5, 8, 20 (low difficulty, high impact).
2. Resolve open design question #25 (attacker online requirement) — affects
   items 3, 21, 23, 24.
3. ETA + battle-success-probability surfacing (3, 21) — high player value.
4. Remaining game-balance/mechanics items (6, 10, 12, 17, 22, 23, 24, 27).
5. Larger modules (13, 26, 29, 30, 31) — each through its own brainstorming
   session, same as always.
6. Infra (9) and audits (18) — later, not urgent at current scale.

## Latest update — 2026-08-18k (attack buff preview in declare-attack modal)

Task #20 from the backlog is now implemented in this worktree branch:

- `components/territories/DeclareAttackModal.tsx` now shows a compact
  defender-bonus panel whenever the target territory has a castle and/or
  village, before the attacker commits troops.
- The panel reuses the existing `lib/territories/structureBonus.ts` logic
  rather than duplicating new game rules: castle lines show their defense
  and defender attack bonus (`str` + `lng`), village lines show their
  defense bonus, and a total row summarizes the defender's combined bonus.
- No combat logic changed; this is UI-only surfacing of already-existing
  territory structure effects.
- `components/territories/DeclareAttackModal.test.tsx` now verifies both
  cases: the panel appears with representative castle/village data and stays
  hidden when the target has no structures.

Verification in this worktree so far:
- Full Jest suite: **337/337 passing**
- `npx tsc --noEmit` ✅
- `npm run build` ✅

## Latest update — 2026-08-17j (trading/exchange module shipped on `feature/trading-exchange`)

Trading / Exchange ("Směnárna") is now implemented on this worktree branch:

- New migration **`supabase/migrations/0014_trading_exchange.sql`** adds the
  `trade_offers` table, pending/accepted/etc. status lifecycle, lazy
  `resolve_expired_trade_offers()` resolution, atomic SQL accept/reject/cancel
  RPCs, public-listing responses, counter-offer chaining, and read RPCs for
  "my offers", marketplace, and accepted trade history.
- Companion manual verification script:
  **`supabase/migrations/0014_trading_exchange.verification.sql`**.
- New typed client wrappers in **`lib/trading/api.ts`** plus Jest coverage in
  **`lib/trading/api.test.ts`**.
- New exchange UI at **`app/exchange/page.tsx`** with tabs for
  **Moje nabídky / Tržnice / Historie**, a create-offer modal in
  **`components/exchange/CreateTradeOfferModal.tsx`**, offer-list rendering in
  **`components/exchange/TradeOfferList.tsx`**, and related component/page
  tests.
- Added a shared top navigation component
  **`components/navigation/MainNav.tsx`** (mounted from `app/layout.tsx`) with
  a simple pending-offer badge beside **Můj profil** driven by
  `listMyOffers()`.

Verification on this branch:
- Full Jest suite: **335/335 passing**
- `npx tsc --noEmit` ✅
- `npm run build` ✅ with placeholder public Supabase env vars
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

## 2026-08-17i — Illustrated castle/village artwork + bigger structure icons

Project owner's feedback on the just-shipped SVG structure icon set: too
small, and didn't like the flat SVG look. Owner then generated a 3x2
illustrated reference sheet (3 castle designs, 3 village designs) via an
external image tool and dropped it in the repo root as `icons.png`.

- Cropped it into 6 individual 512x512 transparent PNGs at
  `public/icons/structures/{castle,village}-{1,2,3}.png` (Python/PIL,
  verified `alpha=0` at background sample points beforehand — no manual
  background removal needed, already transparent).
- `components/territories/icons/StructureIcons.tsx`: `CastleIcon` /
  `VillageIcon` now render these illustrations via a plain `<img>` (not
  `next/image` — many render at once in the map grid, per-instance
  lazy-load machinery isn't worth it for a small local asset) instead of
  the flat single-tone SVG paths from the prior commit. `HomeIcon` is
  unchanged (still SVG) since no artwork was provided for it. Renamed the
  variant identifiers from architectural labels (`ruin`/`chateau`/`tower`,
  `stone`/`romanesque`/`timber` — none of which matched the actual
  supplied artwork content) to sheet-position keys (`castle-1/2/3`,
  `village-1/2/3`); purely an internal `pickVariant` key, never
  user-facing (the `title` prop stays `Hrad`/`Vesnice` either way).
  `GarrisonModal.tsx`'s two non-random build-UI icon instances now use
  `castle-2`/`village-2` as a fixed default (previously `chateau`/`stone`).
- `MapViewport.tsx`: added `getStructureIconSize` — structure icons now
  size at up to ~82% of the measured tile size (was capped ~34px via the
  shared `getIconFontSize`, which is still used for the small
  claim/battle-lock emoji overlays, untouched) so they fill most of the
  tile as requested. Multi-structure tiles still shrink to ~72% of that
  to fit multiple icons side by side.

Verification: `npx jest StructureIcons MapViewport GarrisonModal` 46/46;
full suite **305/305 passing**; `npx tsc --noEmit` clean; `npm run build`
clean. Committed directly to `main` (`89fe886`) and pushed — visual-only
change directly requested and iterated live with the owner, no separate
worktree/agent needed for this follow-up tweak (the size fix + artwork
swap took priority over the in-flight `structure-icons-realism` SVG
redesign agent, which was told to stop mid-task and whose worktree/branch
will be discarded unused).

## Latest update — 2026-08-17h (structure icons worktree `feature/structure-icons`)

Map structure markers no longer use plain emoji for home / castle /
village in the `bcg-structure-icons` worktree. New inline SVG icon set in
`components/territories/icons/StructureIcons.tsx` adds:

- `HomeIcon` (single medieval homestead design)
- `CastleIcon` variants: `ruin`, `chateau`, `tower`
- `VillageIcon` variants: `stone`, `romanesque`, `timber`
- deterministic `pickVariant(seed, variants)` using the same `hash =
  (hash * 31 + charCode) | 0` pattern already used in `MapViewport`

`components/territories/MapViewport.tsx` now renders those SVGs instead
of `🏠 / 🏰 / 🏘️`, preserving the existing compact array-driven render path,
the exact accessible titles `Domov` / `Hrad` / `Vesnice`, the under-attack
dimming, and the old size-shrink behavior by translating the computed
`structureFontSize` into explicit SVG `width`/`height`. Castle and village
variants are stable per tile id (pure hash-based selection, no random).

`components/territories/GarrisonModal.tsx` now uses the new icons in the
build-structure UI and in the non-unit structure-card placeholder tiles
(`chateau` castle default, `stone` village default).

Tests:
- New `components/territories/icons/StructureIcons.test.tsx`
- `MapViewport.test.tsx` updated for SVG sizing semantics
- `GarrisonModal.test.tsx` extended to assert the new build-row icons

Verification in this worktree:
- Baseline Jest count before changes: **297**
- Final Jest count: **300/300**
- `npx tsc --noEmit` ✅
- `npm run build` ✅ (with placeholder public Supabase vars in `.env.local`)

## Latest update — 2026-08-17h (shared card zoom overlay shipped on `feature/card-zoom`)

Compact `TradingCard` views across the app can now be tapped/clicked to
open a shared, enlarged card modal for mobile readability:

- New `components/cards/CardZoomOverlay.tsx` provides a reusable local
  `useCardZoom()` hook, a full-screen dark-backdrop modal that reuses the
  same `TradingCard` component at `w-[min(88vw,380px)]`, closes on
  backdrop click / ✕ / `Escape`, and now includes basic modal semantics
  (`role="dialog"`, `aria-modal`) plus focus handoff/return.
- **Whole-card zoom** added in pure-viewing contexts:
  `components/territories/GarrisonModal.tsx`, `app/collection/page.tsx`,
  `app/catalog/page.tsx`.
- **Separate corner zoom button** added in selection contexts so primary
  click-to-select behavior stays intact:
  `components/territories/TransferModal.tsx`,
  `components/territories/DeclareAttackModal.tsx`,
  `components/battles/RosterStrip.tsx`.
- While implementing, the same zoom affordance was also added to the
  already-prominent duel/result views
  (`components/battles/DuelStage.tsx`,
  `components/battles/RoundResultPopup.tsx`) so live battle cards remain
  readable on small screens as well.
- `DeclareAttackModal` now mirrors `TransferModal`'s stale-request guard:
  quickly switching or clearing the origin territory cannot leave the UI
  showing the wrong troop list or a stuck loading state.
- Tests added/updated across the shared overlay, garrison, transfer,
  declare-attack, roster strip, duel stage, round-result popup,
  collection, catalog, and the existing map integration test that
  exercises transfer selection through `TransferModal`.

Verification in this worktree:
- baseline Jest count before edits: **297 total** (1 pre-existing failing
  suite at baseline)
- final Jest count after feature/tests: **314/314 passing**
- `npx tsc --noEmit` ✅
- `npm run build` ✅ (with temporary placeholder public Supabase vars in
  `.env.local`)

## Latest update — 2026-08-17c (claim-completion XP migration prepared in feature/claim-xp)

**Territory-claim XP follow-up implemented in this worktree** (not applied
live here): new migration `supabase/migrations/0011_claim_xp.sql` adds a
shared `_award_xp(player_id, amount)` helper so the existing 50-XP
battle-win path and the new peaceful claim-completion path both reuse the
same XP + level-milestone structure-card grant logic. `_finalize_battle`
now calls `_award_xp(..., 50)` and keeps the battle-only 1% random
structure-card bonus unchanged. `resolve_due_movements()` now awards **15
XP** when an empty-territory claim actually completes (not at claim start)
— deliberately much lower than a battle win because the claim flow costs
time but has no combat risk.

Also added `supabase/migrations/0011_claim_xp.verification.sql`, a manual
scratch-DB checklist that starts a real claim, fast-forwards the claim
timers, calls `resolve_due_movements()`, and asserts the claimant's XP
increases by exactly 15 while the territory owner flips to `auth.uid()`.
No TypeScript/UI files changed; this is SQL-only.

---
# Progress & Source of Truth — Battle Card Game V2

## Latest update — 2026-08-17g (first admin dashboard shipped on `feature/admin-dashboard`)

A first internal-only `/admin` dashboard is now implemented in the
`bcg-admin-dashboard` worktree branch for test/scenario setup:

- New migration **`supabase/migrations/0011_admin_dashboard.sql`** adds
  `players.is_admin boolean not null default false` (no seed admin), plus
  admin-gated `security definer` RPCs:
  `admin_list_online_players()`, `admin_list_active_battles()`,
  `admin_list_player_cards(p_player_id uuid)`,
  `admin_grant_card(p_player_id uuid, p_template_id text, p_territory_id integer)`,
  `admin_remove_card(p_card_instance_id uuid)`, and
  `admin_grant_xp(p_player_id uuid, p_amount integer)`.
- Online status reuses the already-established **2 minute** freshness window
  from `mark_ready()` / `PlayerProfileCard` (`last_seen_at >= now() - interval
  '2 minutes'`).
- `admin_remove_card` is deliberately conservative: it blocks deletion when a
  card instance is already referenced by battle or troop-movement history, to
  avoid breaking FK-backed combat/audit state.
- Companion manual smoke-test script added:
  `supabase/migrations/0011_admin_dashboard.verification.sql`.
- New client wrappers in `lib/admin/api.ts` centralize `/admin` data access.
- New `app/admin/page.tsx` provides: online players overview, active battles
  overview, card grant/remove tooling, and XP grant tooling. Access flow:
  logged-out users follow the existing redirect-to-`/login` pattern; logged-in
  non-admins see **"Nemáte oprávnění"** and no admin data fetches run before the
  admin check resolves.
- Tests added in `lib/admin/api.test.ts` and `app/admin/page.test.tsx`.
  Baseline Jest count in this worktree before the feature: **282**.
  Final verification: **297/297** tests passing, `npx tsc --noEmit` clean,
  and `npm run build` succeeds with placeholder public Supabase env vars
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

---
**This file is the single source of truth for what to do and why.** It must
be self-sufficient: everything needed to resume work — full context, every
brainstorming decision, the full implementation plan, and exact current
status — lives here. Always read this file first when resuming work
(especially after a context compaction or in a new session), and always
update it as work progresses (not just at the end of a session).

---

## Latest update — 2026-08-18f (incoming battle alerts now player-scoped, no manual refresh needed)

**Bug 3 from the TODO batch is now fixed on branch
`feature/incoming-battle-realtime`**: the defending player no longer has
to have the attacked tile inside the current viewport (or manually
refresh) to notice an incoming PvP attack while sitting on the map page.

- Root cause confirmed in code: `app/map/page.tsx` only mounted
  `useTerritoryBattleChannel(...)` for the **currently rendered viewport
  ids**, so an owned territory outside the player's current pan/zoom
  never emitted a map-page realtime refresh when `battle_locked_by`
  changed.
- Fix implemented with a second, independent hook:
  `lib/battles/useMyTerritoriesBattleChannel.ts`. It subscribes to
  `territories` `UPDATE` events filtered by the caller's **owned**
  territory ids from the already-loaded `getMyTerritories(...)` result
  (no duplicate fetch). To avoid assuming `payload.old` / REPLICA
  IDENTITY FULL, it tracks the previous `battle_locked_by` values from
  that owned-territory list and only fires when a territory transitions
  from unlocked to locked.
- `getMyTerritories(...)` now also selects `battle_locked_by`, and
  `lib/territories/api.ts` gained a small
  `getActiveBattleForTerritory(territoryId)` helper used only to resolve
  the actual `battle_id` for banner navigation (the realtime payload only
  carries real `territories` columns, not the computed `battle_id` from
  `get_viewport` / `get_minimap_overview`).
- `app/map/page.tsx` now renders a stacked, dismissible red alert banner
  list above the map, e.g. "Vaše území (X, Y) bylo napadeno!", with a
  `Přejít do bitvy` CTA that routes to `/battles/<id>` once a matching
  non-resolved battle exists. Multiple simultaneous attacks stack
  cleanly; dismissing one does not affect the others.
- Existing viewport-scoped `useTerritoryBattleChannel(...)` was left
  intact. This fix is additive, not a replacement.
- Test count: baseline **274**, final **277/277**. `tsc`/build clean.

---

## Latest update — 2026-08-18e (round-result popup timer reset fixed)

**Bug 1 from the TODO batch is now fixed** on worktree branch
`feature/popup-timer-reset`:
- Root cause: `BattleScreen.tsx` keeps rendering the same
  `RoundResultPopup` component instance while `popupQueue[0]` advances
  from one historical round to the next, and `RoundResultPopup.tsx`'s
  `useCountdownSeconds` interval-setup effect was mounted with `[]`
  dependencies — the 20s countdown was tied to the popup's first mount,
  not to the currently displayed round, so manually dismissing round N
  and immediately showing round N+1 reused the partially-spent timer.
- Fix: `useCountdownSeconds(...)` now receives the displayed round's
  unique `round.id` as a reset key, so the timer fully resets whenever the
  shown round changes. Duration remains 20s; manual-close behavior
  unchanged.
- Two new regression tests in `RoundResultPopup.test.tsx` cover both the
  manual-close and auto-timeout handoff paths. Test count: baseline
  **274**, final **276/276**. `tsc`/build clean.

---

## Latest update — 2026-08-18d (roster selection ring tightened to avoid edge clipping)

**Bug batch item 2 fixed in `feature/roster-highlight-fix`**: the battle /
transfer card-selection highlight in `components/battles/RosterStrip.tsx`
was defined directly on the clickable card wrapper button (not inside
`components/cards/TradingCard.tsx`). The old classes were:
`ring-2 ring-amber-400` for the active/committed card and
`ring-2 ring-sky-400` for the defender's preview card. The mobile roster
strip already uses `overflow-x-auto`, not `overflow-hidden`, so the real
issue was the ring painting outside the button's border box near the scroll
edge. Fix: changed both highlight variants to use an **inset** ring —
`ring-2 ring-inset ring-amber-400` / `ring-2 ring-inset ring-sky-400` — so
the highlight hugs the card edge instead of extending outward and getting
visually clipped.

Added a focused regression test in
`components/battles/RosterStrip.test.tsx` asserting the selected cards now
carry `ring-inset` and do **not** use `ring-offset-*`. Test count in this
worktree: baseline **274/274**, final **275/275**. `tsc`/build clean.

---

## Latest update — 2026-08-18c (map drag frame fixed in worktree `feature/map-drag-frame`)

User-reported **map drag-frame bug fixed** in
`components/territories/MapViewport.tsx` without changing non-drag sizing:

- Added a new static `data-testid="map-frame"` wrapper around the grid, so
  the viewport now has a fixed outer frame and the translated map content
  moves *inside* it instead of the whole visible box sliding with the
  finger/mouse.
- Moved the live drag translation to the inner `data-testid="map-grid"`
  layer only; the outer frame now owns the drag mouse/touch handlers and
  never receives a transform.
- Added a **visual-only drag clamp** (`~45%` of one tile's pixel size, with
  a `24px` fallback before measurement) so the temporary drag-follow effect
  cannot reveal blank space at the trailing edge. Important: the existing
  release-time `pxToTileDelta(...)` / `onPan(...)` logic still uses the full
  raw drag distance, so actual viewport tile jumps remain unchanged.
- Tests in `components/territories/MapViewport.test.tsx` now explicitly
  cover the new frame wrapper staying static during drag and the inner
  grid's clamped translate behavior, while the pre-existing pan/tap/click
  tests still pass unchanged.

Verification in this worktree:
- baseline before change: **274/274**
- final full Jest count: **276/276**
- `npx tsc --noEmit` ✅
- `npm run build` ✅ **when the required public Supabase env vars are set for
  the command** (the worktree currently has no `.env.local`, so a plain
  env-less build still fails with the pre-existing `supabaseUrl is required`
  prerender error unrelated to this map change)

---

**Building-cards module merged** (`feature/building-cards`, commit
`fb4fdcd`, merged `793607e`): 50 XP per battle win (skips NPC "winners"),
a level-milestone (every 5 levels) `castle-common`/`village-common` card
grant, a 1% per-win random structure-card bonus, a starter-kit
castle+village grant added to `complete_kingdom_onboarding`, a new
`xp_level(xp)` SQL helper mirroring `lib/players/leveling.ts`, and a
"Postavit hrad/vesnici" build action wired into `GarrisonModal.tsx` via
the pre-existing `build_structure` RPC.
`supabase/migrations/0009_structure_card_rewards.sql` **applied to the
live Supabase project** (verified `xp_level` function exists). One merge
conflict in `lib/territories/api.test.ts` (two independent new
`describe` blocks added by both branches) resolved by keeping both.
274/274 tests, `tsc`/build clean.

**Item 5 (bug batch, above) now resolved for battle wins** — XP is
awarded on win. The territory-capture-XP half of item 5 is still
outstanding (not in this agent's scope).

**Item 7 (rank color swap) done**: `components/cards/TradingCard.tsx`
`RANK_FRAME` — `uncommon` is now green (`border-green-500`), `rare` is
now blue (`border-blue-500`) (previously the reverse). No tests asserted
the specific Tailwind color classes, so no test changes needed.

---

## Latest update — 2026-08-18 (territory-name display bug fully fixed; new bug/idea batch logged as TODO)

**Territory rename display bug — now actually fully fixed** (earlier
session-summary fix only solved half of it):
- Root cause found: `get_viewport()` (redefined in `0003_battles.sql` with
  an explicit `returns table (...)` column list, not `setof territories`)
  was never updated by `0008_territory_names.sql` to include the new
  `name` column. So the map's main tile fetch (used to populate
  `selectedTile`/`GarrisonModal`) never returned `name` in production at
  all — only an optimistic client-side patch (added in the prior fix,
  commit `7454847`) made a freshly-renamed territory's name appear, and
  only until the next real refetch (page refresh, pan, revisit), at which
  point it silently vanished again.
- Fix: `supabase/migrations/0010_fix_viewport_name.sql` adds `name text`
  to `get_viewport`'s returned columns (mirrors what `getMyTerritories`/
  `get_territory` already had). **Applied to the live Supabase project**
  (verified via direct query: `get_viewport` now returns a `name` column).
  Commit `07f239d`, pushed directly to `main` (small, isolated SQL-only
  fix, no worktree needed). 266/266 tests, `tsc`/build clean (no
  TypeScript changes needed — `Territory` interface already declared
  `name`).
- **Lesson for future migrations**: when adding a column to `territories`
  (or any table with multiple explicit-column-list RPC wrappers), always
  grep for every `returns table (...)` function that selects from that
  table — `select *`/`setof` wrappers auto-propagate new columns, but
  explicit-column-list wrappers (like `get_viewport`,
  `get_minimap_overview`) do not and must be updated in the same
  migration. `get_minimap_overview` was checked and does not need `name`
  (no UI currently shows per-tile names at minimap zoom).

### New TODO batch from user (2026-08-18) — bugs + feature ideas to triage/implement

User sent 8 items in one message, explicitly requesting they all be logged
here. None are implemented yet except where noted. Answers to the two
direct questions are given inline; the rest need code changes.

1. **Bug — round-result popup timeout doesn't reset on manual close.**
   `RoundResultPopup`'s ~20s auto-close timer, when browsing historical
   battle rounds, does not restart when the user manually closes one
   round's popup — so viewing e.g. 20 rounds only gives ~20s total instead
   of ~20s per popup. Expected: timer should reset every time a popup is
   dismissed (manually or by timeout) and a new one is shown. Not yet
   investigated in code (`components/battles/RoundResultPopup.tsx` /
   `BattleScreen.tsx` are the likely owners of the timer).
2. **Graphical bug — card selection highlight ring too large/clipped.**
   When picking troop cards for attack/transfer, the selection ring around
   a chosen card is bigger than the card and gets visually clipped for
   cards near the edge of the scroll area. Should hug the card's own
   border tightly instead. Not yet investigated (`RosterStrip.tsx` likely
   owner — a `ring`/`box-shadow` sizing or offset issue).
3. **Bug — defender must manually refresh browser to see/join an incoming
   battle.** No realtime push notifies a defending player that they've
   been attacked; they can lose to timeout without ever knowing. Note:
   `useTerritoryBattleChannel` already gives the **map page** a realtime
   subscription on `territories` UPDATEs (so the "under attack" tile
   highlight itself should already update live on the map) — the gap is
   likely that this alone isn't enough to get the player *into* the
   battle screen/ready-up flow without a manual page load, or the
   subscription isn't actually mounted/effective everywhere a player might
   be sitting (e.g., not on other pages, no toast/redirect). Needs
   investigation of `app/map/page.tsx`'s wiring of this hook plus whether
   a global (layout-level) notification is needed for players not
   currently on the map page at all.
4. **Idea (open discussion) — more ways to get common/uncommon troop
   cards** beyond PvP combat and attacking NPC garrisons. Assistant's
   suggestions to discuss with user: daily login streak rewards; XP-level
   milestone grants (mirrors the structure-card level-reward pattern in
   the building-cards module); a card shop/market tied to the
   not-yet-designed trading/exchange subsystem; timed quests/challenges
   (already in the original game vision, not yet built); or a
   territory-capture-specific card drop distinct from combat capture.
5. **Bug — no XP awarded for battle wins at all**, confirmed root cause:
   `0001_players.sql` explicitly deferred XP-mutation to "later
   subsystems" and none ever implemented it. Currently being fixed by the
   in-flight `building-cards-module` background agent (50 XP/win via
   `_finalize_battle`). **New requirement not in that agent's scope: XP
   should also be awarded for successfully occupying/capturing an empty
   territory** (claim completion) — needs a separate small follow-up once
   `building-cards-module` merges.
6. **UX complaint — map drag-pan "feels wrong".** User's description is
   ambiguous ("mapa by při tažení zůstala na svém místě a jen by byl vidět
   pohyb těch políček") — needs a clarifying question before any redesign
   of the just-shipped touch/mouse pan feature. Not yet asked.
7. **Small tweak — swap uncommon/rare border colors.** `uncommon` should
   become green, `rare` should become blue. Not yet located in code
   (likely a rank→color map in `components/cards/TradingCard.tsx` or a
   shared constant) — quick grep-and-swap once picked up.
8. **Answered directly (no code change needed, but worth noting as a
   possible future improv.ment):** does the defender's win-probability
   preview (shown before defender confirms a card) include the attacking/
   defending player's nation combat perk (e.g., English +15% ranged)?
   **No — confirmed by reading `BattleScreen.tsx`: `previewProbability`
   is computed client-side using only `applyRank(baseStats, rank)` on the
   two cards, with no nation-perk or territory/castle bonus factored in.**
   This is intentional/labeled: the UI text next to it literally says
   "Odhad šance obránce na výhru" (i.e. an *estimate*), precisely because
   only the server-side round resolution (which does include nation/
   territory modifiers) is authoritative. Possible future improvement:
   thread the acting players' nation perks into the client preview calc
   too so the "estimate" is closer to the real server outcome — not
   requested yet, just noting the option.
9. **Future TODO (not urgent) — admin card-grant tool.** Once the admin
   dashboard exists, add a way for the admin to manually grant/add
   specific troop cards to specific players'/territories' garrisons, for
   testing without asking the assistant to run ad-hoc DB scripts. Folds
   into the already-planned admin-dashboard module.

---

## Latest update — 2026-08-17 (roadmap items 1-2 shipped: touch pan + territory names)

Both delegated to background agents in parallel git worktrees, merged into
`main`, migration applied to the live Supabase project, and pushed:

1. **Map touch/mouse drag panning** (`feature/map-touch-pan`, commit
   `91d2de9`, merge `7723895`): `MapViewport.tsx` grid now supports
   `onTouchStart/Move/End` mirroring the existing mouse-drag handlers
   (single-touch only, multi-touch ignored), plus live visual feedback —
   a CSS `transform: translate(...)` on the grid container follows the
   pointer/finger during an active drag instead of only jumping on
   release, snapping back with a short ease-out. Shared `pxToTileDelta`
   helper keeps mouse/touch math in one place. A small/no-movement
   interaction still triggers `onSelectTile` as before. 255/255 tests,
   `tsc`/build clean.
2. **Custom territory/castle/village names** (`feature/territory-names`,
   commit `8aec5b7`, merge with `feature/map-touch-pan` auto-resolved
   cleanly): design = single `name text` column on `territories` (one name
   per territory regardless of whether it has a castle/village), nullable,
   1-40 char constraint. `supabase/migrations/0008_territory_names.sql`
   adds the column + a `security definer` `rename_territory(territory_id,
   new_name)` RPC (owner-only; empty string clears the name back to null;
   raises on non-owner or >40 chars). **Migration applied to the live
   Supabase project** (verified: column exists, function exists, empty-
   string constraint rejects as expected). `lib/territories/api.ts` gained
   `name` on `Territory` + a `renameTerritory(...)` wrapper.
   `GarrisonModal.tsx` shows the name as a heading when set, and — when the
   viewer owns the territory — a ✏️ button reveals an inline rename input
   (Save/Cancel); new required `onRename` prop wired through
   `app/map/page.tsx` (calls `renameTerritory` then reloads the viewport).
   `MapViewport.tsx`'s hover tooltip shows the name too. 265/265 tests
   (after merging both features), `tsc`/build clean.

Both worktrees (`C:\Users\z0040m9d\Documents\Projects\bcg-touch-pan` and
`C:\Users\z0040m9d\Documents\Projects\bcg-territory-names`) can be removed
(`git worktree remove ...`) — their branches are fully merged into `main`.

Roadmap items 3-8 (notifications, admin dashboard, boost cards, building-
cards wiring, trading/exchange, autonomous NPC — see the roadmap section
right below this one for full detail) are still pending, in that order.

## Latest update — 2026-08-17 (roadmap: modules 5-6 revisited + new module requests)

**Roadmap going forward** (agreed with user): after subsystem #4 (RTS battle),
the original 6-subsystem plan still has **two undesigned subsystems**:
5 (Trading/Exchange — offer/counter-offer/accept/reject a card) and
6 (Notifications — attack alerts, trade offers). The user also requested
several new modules in this session. Combined priority order (user approved):

1. Map touch/mouse drag panning (UX fix) — **in progress**, background agent,
   worktree `C:\Users\z0040m9d\Documents\Projects\bcg-touch-pan`, branch
   `feature/map-touch-pan`.
2. Custom territory/castle/village names — **in progress**, background
   agent, worktree `C:\Users\z0040m9d\Documents\Projects\bcg-territory-names`,
   branch `feature/territory-names`. Design: single `name text` column on
   `territories`, RPC `rename_territory`, owner-only.
3. Notifications (subsystem 6) — not started.
4. Admin dashboard (online players, activities, active battles) — not
   started. Needs a new `is_admin`/role concept; none exists yet anywhere in
   the schema.
5. Boost cards module (territory-stationed % stat multipliers, e.g. "Vařna
   energetického nápoje") — not started, needs a short rules brainstorm
   before implementation (persistent vs. consumable, stacking, how players
   acquire them).
6. **Building cards module — MAJOR DISCOVERY, scope now much smaller than
   expected**: while investigating whether castle/village-building cards
   existed, found that the backend and even a full UI for this **already
   exist but are disconnected from the live app**:
   - `supabase/migrations/0002_territories.sql` already defines
     `build_structure(territory_id, card_instance_id)` — a `security
     definer` RPC that consumes a `castle`/`village` category card instance
     the caller owns and sets `territories.castle_rank`/`village_rank`
     (only if not already present), then deletes the consumed card
     instance.
   - `lib/territories/api.ts` already exports `buildStructure(...)`, a thin
     wrapper around that RPC.
   - `scripts/seed-card-templates.ts` already seeds real castle/village
     card templates (5 ranks each, with `defense_bonus_pct`/
     `attack_bonus_pct` from `STRUCTURE_BONUS_TABLE`) into `card_templates`.
   - `components/territories/TerritoryDetailPanel.tsx` is a **fully built
     and tested** component (see `TerritoryDetailPanel.test.tsx`) with a
     complete "Postavit stavbu" (build structure) UI flow, an
     `onBuildStructure` prop, and card-instance selection filtered to
     structure cards — but **it is never imported/mounted anywhere in
     `app/`** (confirmed via repo-wide search — only referenced by its own
     test file and old plan docs). The live map page (`app/map/page.tsx`)
     uses `GarrisonModal.tsx` instead, which shows `castle_rank`/
     `village_rank` read-only and lists structure card instances with a
     🏰/🏘️ icon, but has **no build action at all**.
   - **Remaining work for this module is therefore just wiring**: either
     mount `TerritoryDetailPanel`'s build flow into the live page, or (more
     consistent with current UI, since `GarrisonModal` is the actual live
     popup) add a "Postavit" action directly to `GarrisonModal` following
     the same pattern `TerritoryDetailPanel` already proves out, plus
     verify players can actually acquire castle/village card instances in
     practice (loot table / starter kit / drop rules — needs checking,
     may itself be a small gap).
7. Trading/Exchange (subsystem 5) — not started, needs brainstorm + spec
   (bigger, standalone module).
8. Autonomous NPC world simulation — not started, most complex; plan is a
   scheduled server job (Supabase `pg_cron` or edge function) that reuses
   the **existing** claim/battle RPCs for NPC expansion/attacks (no new
   battle logic needed), building on the existing reactive
   `lib/battles/npcAi.ts:pickNpcDefenderCard`. Deliberately last, so it can
   reuse boost/building modules and be monitored via the admin dashboard.

Per user instruction this session: delegate implementation work to
background agents and parallelize via git worktrees wherever tasks don't
touch the same files; keep spec/review cycles lightweight (no multi-round
spec review loops) for these smaller follow-up modules — only the bigger,
genuinely new subsystems (trading/exchange, admin dashboard, NPC sim) may
warrant a short brainstorming pass first.

## Latest update — 2026-08-17

- Map territory popup now supports both missing live UX pieces that still
  lacked a wired frontend despite the backend already existing:
  1. **Other-player owner info in `GarrisonModal`**: `app/map/page.tsx`
     now fetches the selected enemy/other owner's public `players` row via
     the new `lib/territories/api.ts:getPlayerPublicInfo`, derives the
     owner's level with `levelForXp`, and passes it to `GarrisonModal`.
     The modal renders owner name, nation, kingdom name (if present), and
     level directly inside the popup, so it works on mobile too.
  2. **Troop transfer UI for owned destination territories**: added
     `components/territories/TransferModal.tsx`, opened from
     `GarrisonModal`'s new **"Přesunout vojska"** button when the selected
     territory belongs to the viewer. The modal lists the player's other
     owned territories (excluding the destination), loads stationed cards
     at the chosen origin, filters to unit cards only, supports
     multi-select, and calls the pre-existing `startTransfer(...)` RPC
     wrapper. On success, `app/map/page.tsx` refreshes the viewport and
     bumps `movementsRefreshKey`, matching the existing attack flow.
- `GarrisonModal` also now shows the expected territory metadata block
  (`difficulty`, coordinates, castle/village rank) plus graceful
  owner-info loading/error text.
- Test coverage added/updated:
  - `components/territories/TransferModal.test.tsx`
  - `lib/territories/api.test.ts`
  - `components/territories/GarrisonModal.test.tsx`
  - `app/map/page.test.tsx`
- Post-review follow-up fix: `TransferModal` now guards against stale async
  origin loads in both quick-switch (`A → B`) and deselect (`A → empty`)
  cases, so an outdated response can no longer overwrite the current origin
  troops or leave the modal stuck on "Načítám vojska…".
- Fresh verification in this worktree after the change:
  - `npx tsc --noEmit` ✅
  - `npm test` ✅ **222/222 tests passing across 35 suites**
  - `npm run build` ✅ (only repeated existing Supabase/Node 20 deprecation
    warnings during static generation; build still completed cleanly)

## 1. Big picture: this is subsystem #1 of a much larger game

The user's full vision (from the original brainstorming conversation) is a
medieval web card game with: card collection & combat, player accounts with
"nation" classes and XP/levels, a 256×256 territory map with occupation and
castles/villages, real-time multi-army RTS battles between players, a card
trading exchange, and notifications. That whole vision was judged **too
large for one spec** and was explicitly decomposed into independent specs,
each with its own spec → plan → implementation cycle:

1. **Card Collection & Combat Core** ← **✅ FULLY IMPLEMENTED AND VERIFIED** (all 9 plan steps done, 30/30 tests pass, `npm run build` clean, viewable at `/`, `/collection`, `/arena`)
2. Players & Accounts (registration, nation classes/perks, XP/levels, matchmaking by level) ← **✅ FULLY IMPLEMENTED** — data/logic layer + Supabase migration applied to a live project + all pages (register/login/reset-password/onboarding/profile/leaderboard) built and tested (61/61 tests); manual browser verification with the user still pending (see §7 below)
3. Territory Map (256×256 grid, occupation timers, castles/villages, troop transfers) ← **✅ FULLY IMPLEMENTED** — migration applied to the live project, world generated (65,536 territories), all pages built and tested (119/119 tests at the time); see §8 below
4. Multi-army RTS Battle (real-time, both players online, timeouts, rest-area cooldowns, reuses subsystem #1's `resolveDuel` as its per-duel building block) ← **✅ FULLY IMPLEMENTED, MIGRATION DEPLOYED & LIVE-SMOKE-TESTED** — full plan (21 tasks / 8 chunks) implemented, `tsc` clean, 171/171 tests; `0003_battles.sql` applied to the live project and both an NPC-attack and a full PvP round-loop smoke test passed end-to-end (test data fully cleaned up afterward); nothing committed yet — awaiting the user's explicit review/sign-off before commit; see §9 below
5. Trading/Exchange (offer a card, others counter-offer with cards, accept/reject)
6. Notifications (attack alerts, trade offers — email and/or push, mechanism not yet decided)

Subsystems 2-6 are **not designed yet** — do not build anything for them.
Now that subsystem #1 is fully implemented and verified, the next step is to
run the `brainstorming` skill again for subsystem #2, following the same
process (explore → clarify → propose approaches → design → spec → review →
plan → implement).

## 2. Where things live

- **Project root**: `C:\Users\z0040m9d\Documents\Projects\Battle card game V2`
  — this is also the git repo root (`git init` was run directly here, no
  prior history).
- **Previous related project** (for reference/consistency, NOT part of this
  repo): `C:\Users\z0040m9d\Documents\Projects\Battle card game` — a simpler
  Napoleonic-themed Durak-like card game (Next.js 14 + TS + Tailwind + Jest,
  no backend). This V2 project intentionally reuses its tech stack and MVP
  philosophy (local logic first, backend added only when a later subsystem
  actually needs it).
- **Spec** (approved, reviewed by spec-document-reviewer subagent, committed):
  `docs/superpowers/specs/2026-08-15-card-collection-combat-core-design.md`
- **Implementation plan** (committed):
  `docs/superpowers/plans/2026-08-15-card-collection-combat-core-plan.md`
  (the `writing-plans` skill was unavailable in this environment, so the
  plan was authored directly following the same principles — small
  verifiable steps, tests alongside code, explicit verification commands)
- **Session todos**: tracked in the SQL `todos`/`todo_deps` tables (session
  DB, not in the repo — if a new session starts, these will be gone and
  must be inferred from the "Step-by-step plan & status" section below
  instead).
- **Git commit trailer** required on every commit:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

## 3. All brainstorming decisions for subsystem #1 (the "why" behind the spec)

These are the actual answers the user gave during brainstorming, preserved
here so nothing gets silently re-litigated or forgotten:

- **Scope decomposition approved as listed in section 1 above.**
- **Visual companion**: offered and enabled, but never actually used — all
  questions for this subsystem turned out to be conceptual/textual, not
  visual. The brainstorming visual-companion server was started once at
  `http://localhost:56949` (ephemeral, session-only, long since stopped —
  do not try to reuse it; start a fresh one if a genuinely visual question
  comes up in a future subsystem).
- **Number of unit types**: user chose **8-10** (not 15-20, not fewer) —
  landed on exactly 8.
- **Rank vs. unit type relationship**: user chose **"unique_per_rank"** —
  each rank tier of a unit type has its own uniquely-named cards (not just
  one archetype scaled up). Explicit requirement: cards must have "honosné"
  (honorific/grand) original names, e.g. common archer = "Práčata", legend
  archer = "Nejostřejší šípy". **Duplicates in battle allowed** — a player
  can own a Common and a Legend version of the same unit type
  simultaneously; they're independent cards.
- **Collector feel is a first-class requirement**: the user explicitly said
  the collection must satisfy the feeling of owning something legendary,
  and rarity must be visible (e.g. "how many of this named card exist in
  the game").
- **Rank multiplier scaling**: user chose **"mild"** — Common ×1.0,
  Uncommon ×1.15, Rare ×1.35, Epic ×1.6, Legend ×2.0. Rank is a bonus;
  which stats a unit type has (its archetype) matters more for outcomes
  than raw rarity.
- **Combat/duel resolution approach**: user was offered 3 options (A:
  phased ranged-then-melee simulation, B: single formula/no phases, C:
  phased with initiative/multiple volleys) and **chose B**. This led to the
  time-to-kill (TTK) "damage race" formula in the spec (§7) — a single
  closed-form calculation, no round-by-round simulation, that still
  naturally produces the desired archer-beats-fragile-melee-unit dynamic
  because the archer's TTK against a low-HP target is much lower than the
  melee unit's TTK against the archer.
- **Card instance/supply source**: user was offered 3 options for how new
  card copies enter the game (A: all pre-exist at world start held by NPCs,
  B: generated continuously as reward drops, C: hybrid) and **chose B, with
  an explicit amendment: new card instances must only be minted by an
  admin action**, not by any automatic algorithm. This produced the
  `CardInstance.mintedBy: 'admin'` field and the rule that reward systems
  (in later specs) draw from an already-minted, unclaimed pool — they never
  auto-generate new instances themselves.
- **Rarity/supply hybrid model confirmed**: Common/Uncommon = uncapped
  supply (never a bottleneck). Rare/Epic/Legend = fixed `totalSupply` cap
  per named card, chosen at content-authoring time within: Rare 20-50
  (inclusive), Epic 5-15 (inclusive), Legend 1-5 (inclusive).
- **Named variants per rank per unit type**: user was offered
  3-4/2-3/2/1-2/1 (common/uncommon/rare/epic/legend) and explicitly asked
  for **3× those numbers** "aby sbírka karet nebyla zas moc malá" (so the
  collection isn't too small) → landed on **10/8/6/4/3**, giving 31
  variants/type × 8 types = **248 unique card templates** total.
  Each variant within a rank gets a fixed **±10% flavor stat variance**
  baked in permanently at authoring time (not re-rolled per physical copy).
- **Demo output scope**: user was offered "logic + tests only" vs. "logic +
  a simple interactive demo UI" and **chose the demo UI** — a
  Next.js/Tailwind app with a collection browser and a duel arena, no
  accounts/backend, so balance/content can be validated visually before
  building anything else.
- User confirmed every section of the spec explicitly (data model, 8 unit
  types + stats table, naming/variant-count approach, the TTK formula, and
  the overall tech stack/demo summary) before it was written and
  spec-reviewed.
- Spec review loop: 4 iterations with the `spec-document-reviewer` subagent
  (issues found → fixed → re-reviewed) until **Approved** on iteration 4.
  Fixed issues included: clarifying `totalSupply` as a content-authored cap
  vs. runtime `mintedCount`, clarifying "rank" vs "rarity" were the same
  concept (removed duplicate terminology), defining the `EffectiveCard`
  type explicitly, changing "1-10 scale" wording to "0-10 scale" (Siege
  Engines has `str: 0`), and clarifying that unit-type "roles" (e.g.
  "anti-cavalry" for Spearmen) are flavor-only — there is no mechanical
  counter/bonus system, everything emerges from the raw 4 stats via the TTK
  formula.
- User approved the final spec as-is ("ne, je to dobré") and then said
  **"začni"** (start) to authorize beginning implementation — this
  authorization covers the current 9-step plan below; do not need to
  re-ask permission for each step of executing this already-approved plan,
  but DO surface/mention what was done, and still follow the repo's
  git commit policy (see section 5).
- User asked whether this can run on Vercel again: **yes** — plain
  Next.js on Vercel works the same as the previous project; a real
  backend/DB will only become relevant once subsystem #2+ needs persistent
  accounts/real-time state.
- User asked to **write this very progress file** proactively before a
  context compaction, then asked for confirmation that the new
  `.github/copilot-instructions.md` file was scoped to **this project
  only**, not global (confirmed: it is local to this repo, the global
  `~/.copilot/copilot-instructions.md` was not touched). User then asked to
  make this progress file comprehensive enough to be used **on its own** to
  know exactly what to do (including the full plan and every Q&A decision)
  — hence this full rewrite, done in anticipation of an imminent context
  compaction so nothing has to be re-asked or re-derived.

## 4. Full implementation plan (all 9 steps) — status inline

Each step below is from `docs/superpowers/plans/2026-08-15-card-collection-combat-core-plan.md`,
copied in full here (not just referenced) so this file alone is sufficient.

### Step 1 — Project scaffold — ✅ DONE

- `create-next-app@14` (App Router, TypeScript, Tailwind, no `src/`,
  ESLint) — scaffolded into a temp directory
  (`C:\Users\z0040m9d\Documents\Projects\battle-card-game-v2-scaffold`)
  because the target folder name "Battle card game V2" contains
  spaces/capitals, which `create-next-app`/npm reject as a package name.
  Files were then moved into the real project root and the temp dir
  deleted; `package.json`'s `"name"` field manually fixed to
  `battle-card-game-v2`.
- Jest + React Testing Library added: `jest`, `@types/jest`, `ts-node`,
  `jest-environment-jsdom`, `@testing-library/react`,
  `@testing-library/jest-dom`. Config: `jest.config.js` (uses `next/jest`,
  `testEnvironment: 'jest-environment-jsdom'`, `moduleNameMapper` for the
  `@/*` alias), `jest.setup.ts` (imports `@testing-library/jest-dom`).
  `package.json` `"test"` script added (`jest`).
- Verified: `npm run build` succeeds (static pages generated). `npm test`
  runs cleanly (was fixed after an initial config typo —
  `setupFilesAfterEach` should not have existed, only `setupFilesAfterEnv`).
- `.gitignore`: default Next.js ignores kept, plus `/.superpowers/` added
  (brainstorming skill artifacts — these got committed once by accident and
  were then `git rm --cached` to untrack them).
- Committed across a few small commits (scaffold; package name/jest config
  fix; untracking `.superpowers/`).

### Step 2 — Card types — ✅ DONE

- `lib/cards/types.ts`: `UnitType` (union of the 8 unit type string
  literals) + `UNIT_TYPES` array constant; `Rank` (5 literals) + `RANKS`
  array constant; `VARIANTS_PER_RANK` (`{common:10, uncommon:8, rare:6,
  epic:4, legend:3}`); `SUPPLY_RANGE` (`{rare:[20,50], epic:[5,15],
  legend:[1,5]}`); `RawStats` interface (`str, lng, def, hp`);
  `CardTemplate` interface (`id, unitType, rank, name, flavorText,
  baseStats, totalSupply: number|null`); `CardInstance` interface
  (`instanceId, templateId, ownerId: string|null, mintedAt, mintedBy:
  'admin'`) — defined for forward-compatibility with later specs, not used
  by this subsystem's demo UI; `EffectiveCard` interface (`str, lng, def,
  hp` — post-rank-scaling numbers used in combat).
- Verified: `npx tsc --noEmit` clean.
- Committed together with combat-logic and unit-type-baselines (see below).

### Step 3 — Combat logic — ✅ DONE

- `lib/cards/combat.ts`:
  - `RANK_MULTIPLIER: Record<Rank, number>` = `{common:1.0, uncommon:1.15,
    rare:1.35, epic:1.6, legend:2.0}`.
  - `applyRank(baseStats: RawStats, rank: Rank): EffectiveCard` — multiplies
    each of the 4 attributes by the rank multiplier, rounds to nearest
    integer (`Math.round`), clamps to a minimum of 0 (`Math.max(0, ...)`).
  - `resolveDuel(attacker: EffectiveCard, defender: EffectiveCard):
    'attacker' | 'defender'` and the more detailed
    `resolveDuelWithBreakdown(...)` which also returns `{atk, dmgDealt, ttk}`
    for each side. Exact algorithm (spec §7):
    1. `atkA = max(attacker.str, attacker.lng)`, `atkD = max(defender.str,
       defender.lng)` — each side attacks with its stronger stat.
    2. `dmgToDefender = max(0, atkA - defender.def)`, `dmgToAttacker =
       max(0, atkD - attacker.def)`.
    3. `ttkAttackerWins = dmgToDefender > 0 ? defender.hp / dmgToDefender :
       Infinity` (same pattern for `ttkDefenderWins`).
    4. Lower TTK wins. **Tie (including both-Infinity) → defender wins.**
- `lib/cards/combat.test.ts` — 12 tests, all passing:
  - `applyRank`: exact expected output for all 5 ranks against a fixed base
    stat object, plus a defensive negative-clamp case.
  - `resolveDuel`/`resolveDuelWithBreakdown`: attacker decisive win,
    defender decisive win, an explicit "archer vs. fragile spearman"
    scenario proving the intended dynamic (archer's high LNG punches
    through low DEF for large damage against low HP, giving a much lower
    TTK than the spearman achieves back), both-sides-zero-damage (mutual
    Infinite TTK → defender wins), one-side-zero-damage (attacker can't
    penetrate but neither can defender in that specific fixture → defender
    wins), and an exact-tie-TTK case (defender wins).
- Verified: `npm test -- combat` → 12/12 pass. `npx tsc --noEmit` clean.

### Step 4 — Unit type baseline data — ✅ DONE

- `lib/cards/unit-types.ts`: `UNIT_TYPE_BASELINES` — a `Record<UnitType,
  {stats: RawStats; role: string}>` with the exact spec §5 numbers:

  | Unit Type | str | lng | def | hp | role (flavor only, no mechanical effect) |
  |---|---|---|---|---|---|
  | archers | 1 | 8 | 2 | 4 | Glass-cannon ranged |
  | crossbowmen | 1 | 7 | 5 | 4 | Slower-firing but better shielded ranged |
  | spearmen | 4 | 1 | 7 | 5 | Anti-cavalry, strong defense |
  | swordsmen | 7 | 1 | 4 | 5 | Balanced melee striker |
  | halberdiers | 6 | 1 | 8 | 8 | Tank, holds the line |
  | knights | 8 | 1 | 5 | 7 | Heavy melee spearhead |
  | lightCavalry | 5 | 4 | 2 | 4 | Flexible hybrid, fragile |
  | siegeEngines | 0 | 10 | 1 | 3 | Extreme ranged, dies to anything in melee |

  This is the reference baseline that `scripts/generate-catalog-data.js`
  (step 5) varies ±10% per named variant — it is NOT consumed at runtime by
  combat/UI code, only by that generation script.
- Verified: `npx tsc --noEmit` clean.

### Step 5 — Catalog content authoring — ✅ DONE

- `scripts/generate-catalog-data.js` — a one-off, **not shipped with the
  app**, Node content-authoring script (run manually with
  `node scripts/generate-catalog-data.js`, writes
  `lib/cards/catalog-data.json`). Contains:
  - `NAMES`: hand-curated Czech honorific names per unit type × rank,
    following a "common folk → legendary named individuals" progression
    (exact arrays are in the script file itself — do not re-derive them,
    just read the script if the actual name list is needed). Counts match
    `VARIANTS_PER_RANK` exactly (10/8/6/4/3) for every one of the 8 types.
  - `TIER_FLAVOR`: 5 template functions (one per rank) producing a short
    Czech flavor sentence per card, personalized with the card's name and a
    Czech plural label for its unit type (e.g. "lučištníci", "rytíři").
  - `seededFactor(seed)`: a simple deterministic string-hash → `[0.9, 1.1]`
    mapping, used to generate a **reproducible** ±10% variance per stat per
    template (seeded by `"{id}:{statName}"`), so re-running the script
    produces byte-identical output.
  - `supplyForIndex(rank, index, count)`: spreads `totalSupply` values
    evenly across each capped rank's range (e.g. 6 rare variants spread
    across 20-50).
  - Output: exactly 248 `CardTemplate` objects written as pretty-printed
    JSON to `lib/cards/catalog-data.json`.
- **One bug found and fixed during authoring**: the name "Ocelový hrom" was
  originally used for both a knights-epic card and a siegeEngines-rare
  card (duplicate names are invalid per the catalog validator in step 6).
  Fixed by renaming the knights-epic one to "Hromobití kopyt". Verified
  with an ad-hoc Node one-liner that all 248 names in the generated JSON
  are unique before re-running the full test suite.
- Verified: manual duplicate-check script confirmed 248 total / 248 unique
  names after the fix; full catalog validation (step 6's `catalog.ts`)
  passes on this data.

### Step 6 — Catalog loader — ✅ DONE

- `lib/cards/catalog.ts`:
  - Imports `catalog-data.json` (via `resolveJsonModule`, already enabled
    in `tsconfig.json`), casts to `CardTemplate[]`.
  - `validateCatalog(templates)`: runs once at module import time (top level
    of the file, not inside a function called later) and **throws
    synchronously** if any of these fail: total count !== 248; duplicate
    `id`; duplicate `name`; any `baseStats` attribute is negative;
    `totalSupply` is not `null` for common/uncommon; `totalSupply` is
    missing or out of its rank's `[min,max]` range for rare/epic/legend;
    per-unit-type-per-rank counts don't match `VARIANTS_PER_RANK`.
  - Exported accessors: `getAllTemplates()`, `getTemplatesByType(unitType)`,
    `getTemplatesByRank(rank)`, `getTemplateById(id)`.
- `lib/cards/catalog.test.ts` — 12 tests, all passing:
  - Against the **real** `catalog-data.json`: exactly 248 templates;
    correct per-type-per-rank counts for every combination; unique
    ids/names across the whole catalog; `totalSupply` null-vs-in-range
    correctness; no negative `baseStats` anywhere; `getTemplatesByType`
    returns only matching templates (31 for archers); `getTemplatesByRank`
    returns only matching templates (24 for legend = 3×8 types);
    `getTemplateById` finds "archers-common-01" → "Práčata" and returns
    `undefined` for an unknown id.
  - Against **malformed in-memory fixtures** (using `jest.doMock` +
    `jest.resetModules()` + `require('./catalog')` fresh each time, then
    `jest.dontMock` to restore): wrong total count throws
    `/expected 248 templates/`; duplicate id throws `/duplicate id/`;
    out-of-range `totalSupply` on a legend card throws
    `/totalSupply must be within/`; negative `baseStats.str` throws
    `/negative baseStats/`.
- Verified: `npm test -- catalog` → 12/12 pass. Full suite (`npm test`) →
  24/24 pass across both test files. `npx tsc --noEmit` clean project-wide.

### Step 7 — Collection browser page — ✅ DONE

- `app/collection/page.tsx` — client component (`'use client'`):
  - Reads `getAllTemplates()` from `lib/cards/catalog.ts` once via
    `useMemo`.
  - Two `<select>` filters: unit type (8 options + "Vše"/all) and rank (5
    options + "Vše"/all) — exactly the two filter dimensions from the
    spec, no separate "rarity" filter (rank IS rarity).
  - Each card shows: name, unit-type label (Czech), rank badge (color
    per rank), flavor text, **effective stats** via
    `applyRank(t.baseStats, t.rank)` (STR/LNG/DEF/HP grid — NOT raw
    baseStats), and `totalSupply` as static text ("Neomezeno" for
    null/common/uncommon, "Existuje jen N×" otherwise). No live
    claimed-count (no persistence in this demo).
  - Header shows "`{filtered.length} z {allTemplates.length} karet`" —
    doubles as a simple filter-count sanity display and a test hook.
  - Dark theme (zinc/amber/blue/purple/emerald palette for rank badges),
    responsive grid (1/2/3/4 columns by breakpoint).
- `app/collection/page.test.tsx` — 4 RTL tests, all passing: shows all 248
  by default; filtering by unit type narrows to 31 (archers); filtering by
  rank narrows to 24 (legend); combining both filters narrows to 3
  (archers × legend).
- Added `@testing-library/user-event` as a new devDependency (was missing;
  needed for `userEvent.setup()` + `selectOptions` in the new tests).
- Verified: `npx jest app/collection` → 4/4 pass.

### Step 8 — Duel arena page — ✅ DONE

- `app/arena/page.tsx` — client component:
  - Two `<select>` card pickers ("Útočník"/"Obránce"), each listing all 248
    templates as `"{name} — {unitTypeLabel} ({rankLabel})"`; picking the
    same template on both sides is allowed (no restriction).
  - "Souboj!" button: applies `applyRank` to both picked templates'
    `baseStats`, then calls `resolveDuelWithBreakdown` from
    `lib/cards/combat.ts`.
  - Displays a two-column breakdown (`SideResult` sub-component): ATK / DMG
    / TTK for both attacker and defender, with the winning side highlighted
    (amber border/background + "VÍTĚZ" label). `TTK=Infinity` renders as
    "∞"; finite values are `.toFixed(2)`.
  - Changing either select clears the previous result (`setResult(null)`)
    so stale breakdown numbers are never shown for a different matchup.
- `app/arena/page.test.tsx` — 2 RTL tests, both passing: (1) picks
  `archers-common-01` ("Práčata", str=1/lng≈8.7→9/def≈2.2→2/hp=4) vs.
  `spearmen-common-01` ("Rolníci s kopím", str≈4.3→4/lng=1/def=7/hp≈4.7→5),
  clicks fight, and asserts the exact expected numbers (attacker atk=9,
  dmg=2, ttk=2.50; defender atk=4, dmg=2, ttk=2.00; **defender wins**
  since 2.00 < 2.50) — this doubles as a regression check on the
  `resolveDuelWithBreakdown` math itself, wired through real catalog data;
  (2) no "VÍTĚZ" text is present before fighting.
- Verified: `npx jest app/arena` → 2/2 pass.

### Step 9 — Final verification — ✅ DONE

- `npm test` (full suite): **30/30 pass** across 4 test files
  (`combat.test.ts`, `catalog.test.ts`, `app/collection/page.test.tsx`,
  `app/arena/page.test.tsx`).
- `npx tsc --noEmit`: clean, no errors.
- `npm run build`: initially **failed** on pre-existing ESLint errors
  surfaced by the Next.js build's lint step (not caused by the new pages):
  - `lib/cards/catalog.test.ts` had 4× `@typescript-eslint/no-require-imports`
    errors on the `require('./catalog')` fresh-reimport-after-
    `jest.resetModules()` pattern — fixed with targeted
    `// eslint-disable-next-line` comments (the pattern itself is correct
    and needed; only the lint rule needed a documented exception).
  - `lib/cards/combat.test.ts` had an unused `spearman` variable (dead
    leftover from an earlier edit where `fragileSpearman` replaced it as
    the actually-used fixture) — removed.
  - After both fixes: `npm run build` **succeeds cleanly** — 3 routes
    prerendered as static content (`/`, `/collection` @ 1.32 kB,
    `/arena` @ 1.52 kB), no lint/type errors.
- Manual smoke check: started `npm run dev` (detached background process),
  confirmed HTTP 200 from `/`, `/collection`, and `/arena` via
  `Invoke-WebRequest`. **This is the first point where the app is actually
  viewable in a browser** — `http://localhost:3000` (home page with links),
  `http://localhost:3000/collection`, `http://localhost:3000/arena`.
- Also rewrote `app/page.tsx` (previously the default create-next-app
  boilerplate) into an actual landing page: title, short description, and
  two buttons linking to `/collection` and `/arena`. Updated
  `app/layout.tsx` metadata (title/description) and forced a dark theme on
  `<body>` (`bg-zinc-950 text-zinc-100`) so it's visually consistent with
  the card-grid pages (which assume dark zinc/amber colors regardless of
  OS light/dark preference).

## 5. Process/policy reminders (from the custom project instructions, not spec-specific)

- **No implementation without explicit user instruction.** This plan's
  execution was explicitly authorized by the user's "začni" — continuing
  through this same already-approved plan does not require re-asking, but
  do not start subsystem #2 (or any new unapproved scope) without a fresh
  explicit go-ahead following its own brainstorming/spec/approval cycle.
- **Git commits**: only after a meaningfully-sized, tested functional unit
  is complete (not tiny/untested changes). So far every commit in this repo
  has been either docs-only, scaffold/config, or a tested code unit (types +
  combat logic + tests; catalog content + loader + tests) — keep following
  that granularity: commit after each completed, verified plan step, not
  mid-step.
- **Git push**: not done yet, and requires explicit user approval before
  ever pushing to a remote (none configured yet, in fact — this is a local
  git repo only so far).
- **Destructive operations**: never delete/modify anything outside this
  project directory or outside its git repo without explicit permission.
  (The only reference reads outside this directory so far were read-only
  views of the sibling `Battle card game` project for context, and of the
  global Copilot session-recall/skills files — no writes/deletes outside
  this project's folder have occurred.)
- `.github/copilot-instructions.md` in **this project only** (not global)
  tells future sessions to read and continuously update this very file.

## 6. Addendum: subsystem #1 visual polish (trading-card design) — ✅ DONE

After subsystem #1 was fully implemented and verified (section 4 above),
the user asked for a visual-design pass on top of it — not a new
subsystem, an enhancement to the existing `/collection` and `/arena` pages.
This was iterated live with the user via a temporary `/mockup` page and is
now finished and approved.

- **No image-generation tool is available** in this environment — checked
  via `tool_search_tool`, none found. All card art is therefore
  hand-authored SVG vector line-art (emblems: bow, crossbow, spear+shield,
  crossed swords, halberd, winged helm, horse+saber, trebuchet), not
  raster/painted illustration. User was told this and accepted it, and
  explicitly preferred the simple "symbol" emblem style over a more
  detailed full-character SVG figure that was also prototyped (only for
  archers, as a proof-of-concept, in `unit-art.tsx`'s unused
  `variant="figure"` path — kept in code but not used anywhere).
- **New files**:
  - `lib/cards/unit-art-theme.ts` — gradient + accent color per `UnitType`.
  - `components/cards/unit-art.tsx` — `UnitArt` component: CSS gradient
    background (as a plain `<div style>`, NOT inside the SVG — see bug
    note below) + a square-viewBox `<svg>` with the emblem line art on top.
  - `components/cards/TradingCard.tsx` — the reusable card component now
    used by both `/collection` (full mode) and `/arena` (`compact` mode,
    which hides flavor text and totalSupply to save space). Rank-colored
    border frame (common=gray, uncommon=blue, rare=green, epic=purple,
    legend=gold+glow), fixed `aspect-[5/7]` shape (2.5"×3.5" poker-card
    ratio — width alone determines height, independent of grid stretch
    behavior or how much text is inside).
  - `app/mockup/page.tsx` — **kept intentionally** (user's explicit choice,
    not deleted) as a permanent design-reference page showing: one unit
    type across all 5 ranks, a stat-alignment check (short vs. long name),
    a stress test with the catalog's single longest flavor text (94 chars)
    at the narrowest supported card width, and one example of each of the
    8 unit types cycling through all 5 ranks for variety.
- **Two real bugs hit and fixed during iteration** (useful if similar
  patterns recur):
  1. **SVG letterboxing**: a square `viewBox` SVG inside a non-square
     container, with default `preserveAspectRatio="xMidYMid meet"`, scales
     the *entire* SVG content (including any background `<rect>` drawn
     inside it) to fit and centers it — leaving visible empty gaps on the
     sides where the background rect doesn't reach. Fix: put the
     background as a plain CSS background on the parent `<div>` (which
     naturally fills its own box regardless of aspect ratio) and keep only
     the foreground artwork (no background) inside the letterboxed SVG.
  2. **Tailwind 3.4.19 has no built-in `@container` utility** (container
     queries are a *separate* `@tailwindcss/container-queries` plugin, not
     a core feature in this version) — using the class `@container`
     compiled to nothing, so `cqw`-unit font sizes had no query container
     to size against and fell back to the viewport, making text huge.
     Fixed by using an arbitrary-property utility instead, which needs no
     plugin: `[container-type:inline-size]` directly on the card's root
     div.
- **Typography approach**: all font sizes/paddings/gaps inside
  `TradingCard` are set in `cqw` (container query width) units, sized
  against that `[container-type:inline-size]` root div — so text scales
  proportionally with each card's own rendered width (not the viewport),
  and the same relative layout holds whether a card is shown large (full
  `/collection` grid) or small (compact `/arena` side-by-side). Both
  `/collection` and `/mockup` use a `grid-cols-[repeat(auto-fill,minmax(170px,1fr))]`
  grid so cards never render narrower than 170px (the width the layout was
  tuned against for the worst-case 94-char flavor text).

## 7. Subsystem #2: Players & Accounts — data/logic layer implemented

Spec: `docs/superpowers/specs/2026-08-15-players-accounts-design.md` (passed
the spec-review loop after several rounds of fixes — leveling formula,
unsafe RLS, auth-sync trigger, nation enum, case-insensitive uniqueness
indexes, coat-of-arms server-side validation, email-verification/reset flow,
leaderboard filter — see the commit history around 2026-08-15 for the
fix-by-fix detail). Plan: `docs/superpowers/plans/2026-08-15-players-accounts-plan.md`.

**What's implemented and tested** (all pure, no backend needed):
- `lib/players/nations.ts` — the 6 permanent nation choices + perk text
  (data only; no combat/transfer/occupation code reads these yet, by
  design — see spec §3.1).
- `lib/players/leveling.ts` — `xpRequiredForLevel` / `levelForXp`.
- `lib/players/matchmaking.ts` — `canPlayersFight` / `MAX_LEVEL_GAP = 3`.
- `lib/players/coats-of-arms.tsx` — 21 hand-drawn SVG shield designs (a
  shared `ShieldOutline` kite-shape wrapper + varied inner patterns per
  entry); each shield uses `useId()` for its clipPath id specifically
  because the onboarding gallery renders 20+ of these on one page at once,
  and a shared hardcoded id would have collided.
- `supabase/migrations/0001_players.sql` — the full schema from spec §2:
  `nation_id` enum, `players` table, case-insensitive unique indexes, the
  `auth.users` → `players` sync trigger, RLS (public select, no direct
  update), and the three RPC functions (`complete_kingdom_onboarding`,
  `update_kingdom`, `heartbeat`) plus a shared `is_valid_coat_of_arms_id`
  helper. **Not yet applied to any real database** — no Supabase project
  exists yet.

Verification done for this section: `npx jest lib/players` (all suites
pass), `npx tsc --noEmit` (clean) — run after every file in this section was
added.

### 7.1 Pages/auth layer — ✅ IMPLEMENTED (subsystem #2 now feature-complete)

The user provisioned a real Supabase project
(`https://yjmvktpsczmabcpwcyoa.supabase.co`) and manually applied
`0001_players.sql` via the SQL Editor (direct/pooled DB connections from
this environment failed — see the note at the end of this section — so
this is the working path if a future migration is ever needed). Verified
live via a REST `select` call returning `200 []`.

Plan: `docs/superpowers/plans/2026-08-15-players-accounts-pages-plan.md`,
all 10 tasks done and committed:
- `lib/supabase/client.ts` — singleton browser client from
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (`.env.local`,
  gitignored, holds the real project's credentials).
- `lib/supabase/useSession.ts` — `{ user, player, loading }` hook.
- `app/register/page.tsx` — email/password/display-name/nation form,
  `supabase.auth.signUp`, "check your email" confirmation screen.
- `app/login/page.tsx` — `signInWithPassword`, "email not confirmed" +
  resend flow, links to `/reset-password`/`/register`.
- `app/reset-password/page.tsx` — dual-mode (request link vs. set new
  password once a recovery session exists via
  `onAuthStateChange`'s `PASSWORD_RECOVERY` event).
- `app/onboarding/kingdom/page.tsx` (+ test) — kingdom name + coat-of-arms
  gallery (all 21 `COATS_OF_ARMS`), calls
  `complete_kingdom_onboarding` RPC.
- `components/players/PlayerProfileCard.tsx` — shared display component
  (level/XP bar, nation + perk text, kingdom name/coat of arms, online
  badge, account age, playtime) with an `editable` prop, used by both:
  - `app/profile/me/page.tsx` (+ test) — redirects to `/login` if logged
    out, `/onboarding/kingdom` if onboarding incomplete; editable kingdom
    name/coat via `update_kingdom` RPC.
  - `app/profile/[id]/page.tsx` (+ test) — read-only, fetched by id, no
    auth required.
- `app/leaderboard/page.tsx` (+ test) — all onboarded players, sorted by
  `levelForXp` then raw XP descending, ranked list linking to
  `/profile/[id]`.
- `components/players/HeartbeatBeacon.tsx` — calls the `heartbeat` RPC on
  mount + every 30s while a user is logged in; mounted once in
  `app/layout.tsx`.
- `app/page.tsx` — now a client component; shows login/register/leaderboard
  links when logged out, profile/leaderboard when logged in (via
  `useSession`).

**Verification**: `npx tsc --noEmit` clean; full `npx jest` suite
**61/61 passing** across 12 suites (up from 55). `npm run build` was
attempted but **repeatedly hung indefinitely** on this machine right after
printing the Next.js banner (no CPU activity in the spawned build workers,
reproduced 3 times, with and without `NEXT_TELEMETRY_DISABLED=1` and after
clearing `.next`) — this looks like a local/environment issue (possibly
antivirus or disk I/O contention on a shared machine), not a code problem,
since `tsc` and the full test suite are both clean. **Not yet resolved —
retry `npm run build` in a future session** if a clean production build
needs to be confirmed before deploying.

**Not yet done**: the manual browser verification checklist from the plan
(spec §8 — register a real account, confirm email, log in, complete
onboarding, check `/leaderboard`/`/profile/[id]`, test `/reset-password`)
requires the user to check their own inbox, so it's still pending their
availability. No commits have been pushed to any remote — that (like every
commit) requires separate explicit user approval, not yet requested.

**Open question, not blocking**: Supabase's IPv4 pooler
(`aws-0-<region>.pooler.supabase.com`) didn't work for this project from
this environment across ~16 tried regions (`tenant/user ... not found`),
and the direct host (`db.<ref>.supabase.co`) is IPv6-only while this
machine has no IPv6 connectivity at all. Manual SQL Editor paste-and-run
is the reliable fallback for any future migration.
  Current sizing (as of this addendum, tuned per direct user feedback —
  "2x", then dialed back to "150% of the original" — do not re-tune
  without a similar explicit request): name `text-[8.25cqw]`
  (compact: `text-[7.2cqw]`), subtitle `text-[5.7cqw]`, flavor
  `text-[5.1cqw]` (`line-clamp-3`, full mode only), rank badge
  `text-[5.4cqw]`, stat labels `text-[4.8cqw]`, stat values `text-[6.3cqw]`,
  supply text `text-[4.8cqw]` (full mode only).
- **`/arena` integration**: `SideResult` now renders a `compact`
  `TradingCard` (capped at `max-w-[140px]`) above the existing STR/LNG/DEF/
  HP and ATK/DMG/TTK stat breakdown (that breakdown table, added earlier in
  this same addendum before the TradingCard work started, is unchanged).
  The old separate `<h3>{template.name}</h3>` was removed since the
  compact card already shows the name — removing it also fixed a test
  bug (duplicate text). `SideResult`'s outer div now carries
  `data-testid="side-result-attacker"`/`"side-result-defender"` so
  `app/arena/page.test.tsx` can target each side reliably regardless of
  internal DOM nesting (replacing a fragile `getByText(name).closest('div')`
  query that broke once the name moved inside the nested `TradingCard`).
- **Verification**: `npx tsc --noEmit` clean, full Jest suite 30/30
  passing (`lib/cards/combat.test.ts`, `lib/cards/catalog.test.ts`,
  `app/arena/page.test.tsx`, `app/collection/page.test.tsx`),
  `npm run build` clean (`/`, `/arena` 1.71 kB, `/collection` 996 B,
  `/mockup` 138 B — all prerendered static), and manual `Invoke-WebRequest`
  200 checks on `/`, `/collection`, `/arena`, `/mockup` after every
  iteration. **User explicitly approved the final design** ("vypadá to
  dobře") after several rounds of live feedback (background gradient
  letterboxing, text overflow, aspect ratio, font-size scaling twice, and
  a rank-badge/rank-variety mockup mixup that turned out to be a
  non-bug — see history above).
- **Not yet done**: this whole addendum is implemented but **not yet
  committed** — per project policy, commit only once the user explicitly
  confirms the tested result looks good, which just happened, so this is
  the next natural commit point (arena stat-breakdown fields + full
  TradingCard/UnitArt visual system + `/mockup` + arena test fix, all as
  one or a few granular commits, each followed by the required
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
  trailer) — awaiting the user's go-ahead to commit (and separately, to
  push, which additionally requires its own explicit approval).

## 8. Subsystem #3: Territory Map — spec+plan approved, implementation complete, migration APPLIED & LIVE

Brainstorming completed via the `brainstorming` skill (text-only — the
visual companion's WSL `bash.exe` dependency didn't work in this
environment). Spec written to
`docs/superpowers/specs/2026-08-15-territory-map-design.md`, then run
through **5 rounds** of the `spec-document-reviewer` subagent loop until
**Approved** (fixes across rounds: concrete resolve-on-read/write RPCs
instead of a vague "every read path"; atomic home-territory assignment
folded into `complete_kingdom_onboarding` plus a unique partial index
guaranteeing one home tile per player; fully specified claim/transfer/cancel
state machines with both timers precomputed upfront at claim-start;
`start_transfer` fully specified (was previously only named); a
discriminated `CardTemplate` union (`UnitCardTemplate | StructureCardTemplate`)
so Castle/Village cards fit the existing subsystem #1 model; explicit
`minted_count`-is-a-lifetime-counter semantics reconciling structure-card
burning with subsystem #1's "cards are never destroyed" invariant (a
deliberate, scoped exception); Mongol Horde (−25% transfer time) and
Scandinavia (−20% occupation time) nation perks from subsystem #2 wired
into the formulas, since that spec explicitly deferred applying them to
"whichever subsystem owns the mechanic"; RLS enabled with public-read/
no-direct-write policies on all 5 new tables; retuned occupation-formula
constant (500→150) so the 10-hour floor is reachable by a realistic army,
not just a theoretical max; missing indexes for the lazy-resolver's due-
movement/due-occupation lookups; row-locking (`select ... for update` +
re-check) on both the target territory and the selected `card_instances` in
`start_claim`/`start_transfer`/home-assignment to close concurrent-request
races; requiring a non-empty troop selection; excluding already-claimed
tiles from the home-assignment candidate pool; and counting a player's own
in-flight claims (not just settled ownership) against the 32-territory cap
so parallel claims can't jointly overflow it).

**Key decisions locked into the spec** (full Q&A history above §1 of this
section didn't exist yet when this was written — see the spec file itself
and the brainstorming conversation transcript for the complete Q1-Q15
question list): viewport+pan+coordinate-jump+minimap map navigation; static
one-time 256×256 world-gen; only castle/village tiles start with NPC
garrisons (empty tiles have no owner at all); automatic home-territory
assignment right after onboarding, with a starter army; real `CardInstance`s
(not abstract numbers) as garrisons; subsystem #3 scope excludes **all**
combat (deferred to subsystem #4); a claimed empty tile locks immediately
(no contested claims) but the claimant can cancel (instant troop return, no
return-trip timer); hard block at the 32-territory cap; two-phase transfer-
then-occupation timing (10-hour occupation floor); 5 difficulty levels
mirroring the card-rank multiplier scale (×1.0/1.5/2.25/3.4/5.0); Castle and
Village are new burn-on-use structure cards (not tile flags), rankable like
unit cards, obtainable only via admin-mint for now (combat loot arrives with
subsystem #4); a tile may have both a Castle and a Village simultaneously,
with their defense bonuses stacking additively; and — a major scope addition
discovered mid-brainstorming — this subsystem must also add the **first real
database persistence for card instances** (`card_templates`/`card_instances`
tables), since subsystem #1 only ever defined these as in-memory
TypeScript types with no backend.

Implementation plan written to
`docs/superpowers/plans/2026-08-15-territory-map-plan.md` (deliberately more
consolidated task granularity than the `writing-plans` skill's default, per
the user's request to keep it concise), run through **3 rounds** of the
`plan-document-reviewer` subagent loop until **Approved**. Both the spec and
plan documents are committed (`0cee135`, `f34c0f6`).

**Implementation status: all 13 plan tasks complete and committed**, each
with its own tests green before committing (per the plan's per-task TDD
pattern):

- **Chunk 1 (pure logic)**: `CardTemplate` split into `UnitCardTemplate |
  StructureCardTemplate` (`lib/cards/types.ts`, `fa98806`); transfer/
  occupation formulas (`lib/territories/formulas.ts`, `2ee6d9c`);
  castle/village bonus stacking (`lib/territories/structureBonus.ts`,
  `dcf8fb9`).
- **Chunk 2 (DB schema, world-gen, RPCs)**: full schema migration —
  `card_templates`/`card_instances`/`territories`/`troop_movements`/
  `troop_movement_units`, all indexes, RLS (`supabase/migrations/
  0002_territories.sql`, `b993635`); manual SQL verification checklist
  (`0002_territories.verification.sql`, `ea7d154`); `resolve_due_movements()`
  + the 4 read RPCs (`c8996e8`); `start_claim`/`start_transfer`/
  `cancel_claim`/`build_structure` mutating RPCs with row-locking (`d68c77a`);
  `complete_kingdom_onboarding` extended for atomic home-territory + starter
  army assignment (`f0bafa2`); `scripts/seed-card-templates.ts` +
  `scripts/generate-world.ts` with tested pure placement-logic helpers
  (`537a72e`).
- **Chunk 3 (Map UI)**: typed RPC client wrappers (`lib/territories/api.ts`,
  `916c153`); pannable viewport with click-drag + arrow-button panning and
  coordinate jump (`components/territories/MapViewport.tsx`,
  `app/map/page.tsx`, `51adda6`); minimap overview
  (`components/territories/Minimap.tsx`, `21bcd4e`); territory detail panel
  with state-dependent claim/transfer/cancel/build actions and user-facing
  RPC error surfacing (`components/territories/TerritoryDetailPanel.tsx`,
  `9bbae8b`).

**Verification**: `npx tsc --noEmit` clean and full `npx jest` **119/119
passing** across **18 suites** as of the last task's commit.

**Not yet done / explicitly deferred, requires the user's separate
go-ahead**:
- No git push has been performed — commits are local only, pending the
  user's review and explicit push approval.
- All castle/village combat bonuses, actual combat resolution, and
  combat-loot card acquisition are explicitly out of scope here — deferred
  to subsystem #4 (spec §13).

**Deployment (this session, live project `yjmvktpsczmabcpwcyoa`)**:
- `0002_territories.sql` applied via the SQL Editor. Hit one bug on first
  attempt: `troop_movement_units.card_instance_id` referenced
  `card_instances(id)`, but that table's PK column is `instance_id`
  (`42703: column "id" ... does not exist`) — fixed and committed
  (`8272e1e`), re-ran successfully.
- Verified live via REST API (anon key): all 5 tables reachable
  (`territories`, `card_templates`, `card_instances`, `troop_movements`,
  `troop_movement_units`) and `get_minimap_overview` RPC callable.
- `scripts/seed-card-templates.ts` run against the live project (service
  role key) — seeded 258 card templates (248 unit + 10 structure).
- `scripts/generate-world.ts` run against the live project — generated all
  65,536 territories plus NPC garrisons on 1,000 pre-seeded structure
  tiles (7,702 `card_instances` rows total). Verified row counts live via
  REST API (`territories`: 65536, `card_templates`: 258, `card_instances`:
  7702).
- Both scripts needed a small Node-20-compatibility fix (native
  `WebSocket` global missing pre-Node-22, required internally by
  `@supabase/supabase-js`'s realtime client even though these scripts
  never use realtime) — polyfilled with the already-present `ws` package;
  committed.
- `0002_territories.verification.sql`'s manual SQL checklist was partially
  run against the live project (via a throwaway supabase-js script, since
  raw REST/PowerShell calls with the new `sb_secret_...` service-role key
  format get rejected with "Forbidden use of secret API key in browser" —
  supabase-js works fine, it just sets different headers): RLS anon
  read-succeeds/write-is-silently-filtered confirmed (territory row `id=1`
  verified unchanged after anon UPDATE/DELETE attempts — Postgres RLS
  filters via `USING`, so these return 200/204 with 0 rows affected rather
  than an error, which is expected Postgres RLS behavior, not a bug); all
  3 `card_templates` check-constraint cases (bad village attack_bonus_pct,
  good village, incomplete unit) passed as expected, test rows cleaned up.
  **Not run**: the home-tile-uniqueness insert test (would violate the
  live world's `unique(x, y)` index since the grid is now fully
  populated — needs adapting to use `information_schema` instead of a raw
  insert) and the 4 mutating-RPC rejection-path tests (need a real
  authenticated player, and no one has signed up yet) — low priority,
  can be exercised once real players/onboarding exist.

## 9. Subsystem #4: Multi-Army RTS Battle — implemented, self-verified, awaiting sign-off before commit

Spec written to
`docs/superpowers/specs/2026-08-16-multi-army-rts-battle-design.md` via the
`brainstorming` skill, then plan written to
`docs/superpowers/plans/2026-08-16-multi-army-rts-battle-plan.md` (21 tasks
across 8 chunks). Both documents already existed going into this session's
implementation work.

**Key mechanics locked into the spec/plan** (see the spec file for the full
Q&A): attacker picks a roster up front, but each round one of the
attacker's cards is chosen at random while the defender picks their
responder reactively (defender's informational advantage); rounds continue
until one side hits 0 cards; winning/surviving cards get a 2-round rest
cooldown before they can fight again; both players must be online and
`mark_ready` to start a round-resolution tick (true RTS, not turn-by-turn
polling); a 10-day no-show timeout auto-resolves to whichever side readied
up at least once (attacker wins outright if neither side ever confirms
readiness after both declared, since the defender failed to defend); cards
captured in battle transfer between players' collections (never destroyed);
NPC-garrisoned tiles use a simple deterministic AI so PvE resolves without
needing a second human; home territories can never be lost.

**Implementation status: all 21 plan tasks complete, self-verified, NOT
committed** (per the user's explicit "commitneme až po chunku 7 a 8"
instruction — everything below is real, working, on-disk code, but no git
commit has been made yet, pending the user's end-to-end review):

- **Chunk 1 (pure logic)**: nation combat perks (`lib/battles/
  nationCombatPerk.ts`), effective-stats computation incl. castle/village
  bonuses (`lib/battles/effectiveStats.ts` + a parity test proving it
  matches subsystem #1's original formula for the no-bonus case), rest-
  cooldown bookkeeping (`lib/battles/restCooldown.ts`), and NPC-defender AI
  (`lib/battles/npcAi.ts`) — all pure TypeScript, fully unit-tested,
  reusing subsystem #1's `resolveDuel` as the actual per-duel resolver.
- **Chunk 2 (DB schema)**: `battles`/`battle_rosters`/`battle_rounds` tables
  plus a `battle_locked_by` column on `territories`, RLS (public-read, no
  direct write), added to `supabase/migrations/0003_battles.sql`.
- **Chunk 3**: `declare_attack` RPC (validates roster ownership, distance/
  transfer-time-derived arrival, the 32-territory cap, and locks the target
  territory via `battle_locked_by`) plus amendments to subsystem #3's
  `get_viewport`/`start_claim`/etc. so claim and battle locks can't race
  each other.
- **Chunk 4**: `resolve_due_movements()` extended so an arriving attack
  movement actually starts the battle (creates the `battles` row and
  initial rosters) instead of just delivering troops, and folds in the
  claim-downgrade case (an empty-tile claim gets contested by a rival
  attacker).
- **Chunk 5 (core engine)**: `resolve_due_battles()` — the lazy-resolution
  round engine (random attacker-card draw, defender's reactive pick or NPC
  AI's pick, `resolveDuel` call, rest-cooldown bookkeeping, win-condition
  detection, card capture, uniform post-battle cleanup returning surviving
  cards home). This was rewritten directly by hand after a background
  agent hallucinated an entire fake schema for it — see this session's
  history for the full incident; it is not delegated to agents from this
  point forward, only written directly with `tsc`/`jest` verification
  after every change.
- **Chunk 6**: `mark_ready` (both-players-online RTS gate, 10-day timeout
  auto-resolution per the rules above) and `pick_defender_card` (the
  defender's reactive per-round choice) RPCs.
- **Chunk 7 (realtime + UI)**: Postgres `postgres_changes` realtime
  publication for `battles`/`battle_rounds`/`territories` (no realtime
  infrastructure existed anywhere in the codebase before this); `get_battle`
  aggregate RPC; `lib/battles/api.ts` typed client wrappers;
  `useBattleChannel`/`useTerritoryBattleChannel` realtime hooks;
  `DeclareAttackModal` (wired into `GarrisonModal`'s new "⚔️ Zaútočit"
  button, since `TerritoryDetailPanel` — the component the plan assumed —
  turned out not to actually be wired into `app/map/page.tsx` at all; the
  attack entry point was added to whichever component is actually live);
  the full battle screen (`RosterStrip`/`DuelStage`/`RoundHistory`/
  `BattleScreen` at `app/battles/[id]`), responsive by Tailwind breakpoints
  in the same components (no separate mobile file, matching this project's
  existing convention); `battle_locked_by`/`battle_id` map visual
  treatment and click-through navigation to the battle screen for any
  viewer (spectating is allowed, only interference is blocked, per spec).
- **Chunk 8 (this task)**: final `tsc`/full-suite verification (below) and
  this PROGRESS.md update.

**Verification**: `npx tsc --noEmit` clean and full `npx jest --ci`
**171/171 tests passing** across 26 suites, run fresh at the end of this
session.

**Not yet done / explicitly deferred**:
- **Nothing has been committed or pushed.** Per the user's explicit
  instruction this session ("commitneme až po chunku 7 a 8") and this
  project's standing convention (mirrors the territory-map plan's
  equivalent final-task gate), a commit will only happen after the user
  has reviewed and explicitly approved the feature.

**Live smoke test performed this session (against the live project
`yjmvktpsczmabcpwcyoa`, with explicit user go-ahead — "nahraj to do
produkční databáze... zatím jsme ve vývoji hry")**:
- Full backup of `players`/`card_templates`/`card_instances`/`territories`/
  `troop_movements` taken first (`scripts/backups/pre-0003-battles-*.json`,
  gitignored, 17.4 MB, 4 tables × exact row counts before any change).
- `0003_battles.sql` applied directly against the live Postgres instance
  via the Session/Transaction Pooler connection string (`SUPABASE_DB_URL`
  in `.env.local`, not committed) using the `pg` npm package (added as a
  new devDependency) — no Supabase CLI auth token or scratch/second
  project was needed once a direct DB connection was available.
- **Bug found and fixed during this deployment**: `get_viewport` and
  `get_minimap_overview`'s `create or replace function` statements failed
  live with `cannot change return type of existing function` — Postgres
  requires an explicit `drop function` first when a function's return
  columns change (adding `battle_id`), which `create or replace` alone
  cannot do. Fixed by adding `drop function if exists ...` immediately
  before each redefinition in `0003_battles.sql`. Migration re-ran clean
  after the fix (verified via a fresh `BEGIN`/`COMMIT` transaction, so the
  first failed attempt made zero live changes).
- Post-apply verification: all 4 new tables (`battles`,
  `battle_attacker_roster`, `battle_rounds`, `battle_unit_rest`), all 7 new
  RPCs, the `territories.battle_locked_by` column, and the
  `battles`/`battle_rounds`/`territories` realtime publication all confirmed
  present live via direct SQL queries.
- **NPC attack smoke test**: two throwaway test accounts were created via
  the Supabase Admin API (`smoketest-attacker@battlecardgame.test`,
  `smoketest-defender@battlecardgame.test`), onboarded through the real
  `complete_kingdom_onboarding` RPC (impersonated via a
  `set_config('request.jwt.claims', ...)` session-JWT spoof over the direct
  DB connection — the same mechanism PostgREST uses internally, so
  `auth.uid()` resolves exactly as it would through the real API/app).
  The attacker declared a real `declare_attack` call against a nearby
  NPC-garrisoned village tile (3-card NPC garrison), the resulting
  `troop_movements` row was fast-forwarded (its `transfer_arrives_at` set
  to the past — the only test-only shortcut used; every RPC call itself
  was the genuine production code path) and `resolve_due_movements()` was
  invoked. Result: the battle auto-created and fully auto-resolved in the
  same call (9 rounds, NPC path per spec §4), `winner_side = 'attacker'`,
  the tile's `owner_id` flipped to the attacker, and all 3 NPC cards were
  captured (attacker's roster at that tile went from 6 → 9, NPC garrison
  → 0) — capture-on-win confirmed working end-to-end.
- **PvP attack smoke test**: using the same two test accounts (the
  attacker's newly-captured tile as origin against a second, manually
  pre-granted non-home territory owned by the defender with a 3-card
  garrison), a real `declare_attack` was issued, fast-forwarded to
  arrival, both players' `last_seen_at` set to "now" (simulating both
  online) and `mark_ready` called by each in turn — the battle correctly
  stayed `awaiting_ready` after only one side readied, then flipped to
  `active` and started round 1 the moment both had. The full round loop
  was then played out purely through the real `pick_defender_card` RPC
  (defender picking a random eligible card each round, exactly as the real
  UI would), with `resolve_due_battles()`'s and `_start_next_round`'s
  internal logic handling everything else (attacker's random per-round
  draw, `resolveDuel` calls, rest bookkeeping). Result: 7 rounds total (2
  correctly auto-skipped when both sides had every card resting — proof
  the skip-round path works), a card was seen returning to the fight in
  round 6 after resting through rounds 4-5 exactly per the 2-round rest
  rule, `winner_side = 'attacker'`, the tile's ownership flipped to the
  attacker, all 3 of the defender's cards at that tile were captured
  (attacker's final roster there: 9 + 3 = 12), and the defender's
  untouched 3 home-based cards were correctly left alone. 7
  `battle_unit_rest` rows were recorded, confirming cooldown bookkeeping
  fired on every resolved round.
- **Full cleanup performed immediately after**: both test battles' rows
  (`battle_unit_rest`/`battle_rounds`/`battle_attacker_roster`/`battles`)
  and both test `troop_movements` deleted; the 3 originally-NPC card
  instances restored to `owner_id = null` (identified via exact
  `instance_id` match against the pre-migration backup, not recreated —
  no new card instances were minted to "undo" the capture); the 12
  starter-minted test-player card instances deleted outright (they never
  existed before this session); all 4 touched territories reset to
  `owner_id = null` / `is_home = false`; both test `players` rows deleted;
  both test `auth.users` accounts deleted via the Admin API. Final counts
  verified to exactly match the pre-migration backup
  (`players: 1, card_templates: 258, card_instances: 13404, territories:
  65536, troop_movements: 0, battles: 0`) — the live project is back to
  its exact pre-test state, with only the schema itself (tables/RPCs/
  realtime) now new and permanent.
- **Not covered by this smoke test**: the real-time push-to-two-browsers
  UI experience (Task 15's live subscription) and the actual React UI
  components (`DeclareAttackModal`/`BattleScreen`) were exercised only via
  their Jest unit tests, not against this live data — this pass tested the
  SQL/RPC layer end-to-end, not the browser UI, since no browser is
  available in this environment.

## 10. Live playtesting bug fixes (subsystem #4) — in progress, NOT committed

The user started real two-account (`hradecak87@gmail.com` attacker/
defender pair) playtesting of subsystem #4 in the live production app.
Several real bugs were found and fixed; **nothing in this section has been
committed yet** — same policy as §9, awaiting explicit user sign-off.

- **Claim-vs-transfer ETA mismatch**: `MyMovementsPanel` showed a stale
  "Již brzy" while the map tile popup correctly showed the real remaining
  time for a claim-in-progress. Root cause: it read
  `troop_movements.transfer_arrives_at` (troops arriving) instead of
  `territories.claim_occupation_completes_at` (the claim actually
  finishing) for `kind: 'claim'` movements. Fixed in
  `lib/territories/api.ts` (added the field to `getTerritoriesByIds`) and
  `components/territories/MyMovementsPanel.tsx`.
- **Battles stuck forever at `awaiting_ready`**: `mark_ready`'s "both
  online within the last 2 minutes" joint check only re-runs when a
  participant clicks the button again, but the button hides itself once
  the caller's own `ready_at` is set — so if the two sides' click-timings
  never overlap, the battle never progresses and there's no UI affordance
  left to retry. Fixed with a silent 20s background `markReady()` retry
  loop in `components/battles/BattleScreen.tsx` (client-side mitigation
  only; a server-side scheduled job would be more robust but is out of
  scope for now).
- **"Karta nejde vybrat" — root cause was NOT a code bug**: extensive
  investigation (direct RPC calls via a real user JWT, dev-server
  restart, hydration-mismatch review) ruled out the backend and the
  battle-screen code entirely. Actual cause: the user was testing both
  accounts **in the same browser** (different tabs). Supabase persists
  the auth session in `localStorage`, which is shared across all tabs of
  one browser/origin — logging into the second account invalidated the
  first tab's session, leaving that tab a "spectator" with every action
  correctly disabled (no error, looked like dead cards). **Fix**: added
  `components/players/AuthStatusBar.tsx`, mounted once in
  `app/layout.tsx`, always showing "Přihlášen/a jako {email}" or a
  logged-out warning with a login link — so a silent session loss is
  never invisible again. Also added a `data-testid="my-role"` line to
  `BattleScreen.tsx` showing "útočník / obránce / divák" for the current
  battle, which is what surfaced the divák (spectator) state and led to
  the actual diagnosis. **User-facing advice**: use two different
  browsers (or one regular + one private/incognito window) to test two
  accounts simultaneously.

### 10.1 "Moje sbírka" page — owned-cards view with filters (new, this session)

The user asked for a page showing their own card collection with rank/
type/location filters and a search box — the existing `/collection` page
only ever showed the full static catalog (all templates, no ownership).

- **Renamed** the old `/collection` page (full catalog, unchanged
  behavior) to **`/catalog`** (`app/catalog/page.tsx` +
  `app/catalog/page.test.tsx`, moved as-is).
- **New `/collection`** (`app/collection/page.tsx`) = "Moje sbírka": loads
  the current player's owned `card_instances` (redirects to `/login` if
  logged out) joined with their template and current `territories` row via
  a new `getMyCardInstances(ownerId)` helper in `lib/territories/api.ts`
  (new `MyCardInstance` type). Filters: unit type, rank, location (home /
  a specific owned territory / "Na cestě" for in-transit cards), and a
  free-text name search. Empty-state message when the player owns no
  cards yet.
- Both `app/page.tsx` (home) and the new page cross-link `/collection`
  ("Moje sbírka") and `/catalog` ("Katalog karet") per the user's explicit
  request to keep both as separate menu entries.
- Tests: `app/collection/page.test.tsx` (7 new tests covering the login
  redirect, loading + location display, and all four filter types).
  `app/catalog/page.test.tsx` unchanged/still passing (only the on-screen
  count/count-label markup was tweaked, not the underlying logic).

**Verification**: `npx tsc --noEmit` clean, full `npx jest --ci`
**199/199 tests passing** across 31 suites, run fresh at the end of this
session.

**Status**: ✅ Committed (`4187935`) and pushed to `origin/main`
(`github.com/hradecak87/battle-card-game`) after the user confirmed it
worked live. Two follow-up Vercel deploy failures were also fixed this
session: an `.eslintrc.json` unused-vars rule blocking the build
(commit `8a4f82d`) and a missing `NEXT_PUBLIC_SUPABASE_URL`/
`NEXT_PUBLIC_SUPABASE_ANON_KEY` Vercel project-settings issue (no code
change — user added them directly in the Vercel dashboard). The app is
now live and deploying successfully on Vercel.

## 11. Battle round result popup (subsystem #4 follow-up) — implemented, verified, NOT yet committed

Per-round feedback was missing from the live RTS battle screen: a round
resolved silently with no visible explanation of who won or why. Full
design went through the `brainstorming` skill (see
`docs/superpowers/specs/2026-08-17-battle-round-result-popup-design.md`,
reviewed 3x by a spec-document-reviewer subagent — 2 real issues found
and fixed: skip detection must use the existing `battle_rounds.skipped`
column rather than a null-heuristic, and historical round popups must
resolve card art via a direct `card_instances`/`card_templates` join in
`get_battle` rather than the live `attacker_roster`/`defender_pool`
arrays, which shrink as cards are captured or die). Implementation plan:
`docs/superpowers/plans/2026-08-17-battle-round-result-popup-plan.md`
(`writing-plans` skill unavailable in this environment — authored
directly, same convention as prior plans).

Also bundled in this same pending commit: an earlier-session fix (the
round-deadline auto-reload `useEffect` in `BattleScreen.tsx`, so an
expired round auto-advances for anyone with the battle screen open,
without a manual page refresh) that had been implemented and verified
but not yet committed when this feature started.

**What was built:**
- `supabase/migrations/0005_battle_round_breakdown.sql` — adds 6 nullable
  numeric columns to `battle_rounds` (`attacker_atk`,
  `attacker_dmg_dealt`, `attacker_ttk`, and the `defender_*` equivalents;
  `null` TTK means "infinite", i.e. 0 damage dealt); updates
  `_resolve_round` to populate them from its already-computed
  `v_atk_eff`/`v_def_eff`/`v_atk_dmg`/`v_def_dmg`/`v_ttk_*` locals (no new
  computation, previously discarded); updates `get_battle`'s round-row
  query to also resolve `attacker_card`/`defender_card` (`{instance_id,
  template}` or `null`) directly from `card_instances`/`card_templates`
  by id, independent of the live roster/pool arrays. **Deployed to the
  live production Supabase project** and verified: new columns exist,
  `get_battle` still returns correctly for a pre-existing battle (older
  rounds correctly show `null` breakdown fields since they predate the
  migration; new rounds resolved after this point will have them
  populated).
- `lib/battles/api.ts`: `BattleRoundRow` extended with the 6 new fields
  plus `attacker_card`/`defender_card`.
- `components/battles/RoundResultPopup.tsx` (new): the modal, styled to
  match `/arena`'s `SideResult` ATK/DMG/TTK convention — side-by-side
  cards with the winner highlighted, one plain-language explanation
  sentence (including a distinct "never dealt damage" phrasing for the
  infinite-TTK case), a 20s **visible countdown** auto-dismiss, and a
  manual ✕ close button. Renders a short "Kolo přeskočeno – všechny karty
  odpočívají." variant (no card art/stats) when `round.skipped`.
- `components/battles/DuelStage.tsx`: exported its existing
  `toUnitTemplate` helper (now takes a `BattleCardTemplate` directly
  instead of a `BattleCard`) so `RoundResultPopup` could reuse it without
  duplicating the card-template conversion logic.
- `lib/battles/lastSeenRound.ts` (new): tiny `localStorage`-backed
  "last seen round number" getter/setter, keyed per battle id
  (`battle-{id}-last-seen-round`), guarded to no-op during SSR.
- `components/battles/BattleScreen.tsx`: a new `useEffect` builds a
  `popupQueue` of every round newer than the last-seen marker that has
  actually resolved or been skipped (checked via
  `round.skipped || round.winner_card_instance_id !== null` — NOT
  `resolved_at`, which is set at round-*start*, not at resolution, so it
  can't distinguish a still-pending round). Renders `popupQueue[0]` only;
  dismissing (auto or via ✕) advances the stored last-seen marker and
  reveals the next queued popup immediately. This single mechanism
  naturally covers both live PvP (usually one new round at a time) and
  NPC/PvE battles (which can resolve many rounds in one synchronous
  server call — all play back in round-number order, one popup at a
  time, on first view).

**Verification**: `npx tsc --noEmit` clean; full `npx jest --ci`
**208/208 tests passing** across 32 suites (12 new: 5 in
`RoundResultPopup.test.tsx`, 3 new in `BattleScreen.test.tsx` on top of
the existing 7 + the earlier round-deadline test); a full `npm run build`
also completed cleanly (catches Vercel-only ESLint failures invisible to
`tsc`/`jest` alone, per this session's earlier lesson).

**Status**: ✅ Implemented, verified, **committed (`3b95749`) and pushed
to `origin/main`.** The user returned, gave explicit commit+push
instructions, and also asked to seed two real test accounts
(`hradecky87@gmail.com`, `hradecak87@gmail.com`) with nearby starter
territories/troops near (0, 80) for live PvP testing — done directly
against the live production DB (see §12 below for full details and the
established direct-`pg`-connection pattern).

---

## 12. Live playtesting support: test-account seeding + "speed up" debug RPC

While actively co-testing live on Vercel (no local dev server — "my už
to máme na vercelu" / "local není potřeba"), the user asked for direct
production-DB help to make manual playtesting practical:

**Test-account seeding** (one-off, data-only, not code): assigned
`hradecky87` territories 78 `(0,77)` and 337 `(1,80)`, and `hradecak87`
territories 79 `(0,78)`, 82 `(0,81)`, 338 `(1,81)`, 592 `(2,79)` — each
territory stocked with 5 common-rank unit `card_instances` (archers,
crossbowmen, spearmen, swordsmen, knights) so both accounts had troops
to attack/defend with immediately. Later, when the user sent troops and
asked to skip the wait, all `in_transit` movements and active territory
claims were backdated to already-elapsed and `resolve_due_movements()`
was called directly — resulted in territory (0,80) completing its claim
for `hradecak87`, and a new PvP battle (`awaiting_ready`) starting on
territory 78 between the two test accounts, ready to test the round
popup live.

**Recurring pattern established**: connect via `pg.Client` using
`SUPABASE_DB_URL` from `.env.local`, **parsed manually into explicit
`{host, port, user, password, database, ssl}` fields** — passing the
raw connection string directly intermittently fails with a mysterious
`ENOTFOUND` even though the hostname resolves fine otherwise. Always
write one-off scripts as a temp `.js` file (not inline `node -e`, which
fights with PowerShell's own quoting/escaping) and delete it after use.

**Permanent feature added** (code, not just data) — the user then asked
for a *reusable* way to self-serve this speed-up without asking me each
time: "není možné ka každému přesunu nebo zabírání nového místa dát nyní
pro test tlačítko pro stažení daného času jen na 10 sekund?"

- `supabase/migrations/0006_debug_speed_up_movement.sql` (new, deployed
  live): `debug_speed_up_movement(p_movement_id uuid)`, `security
  definer`, only ever touches rows owned by the calling player
  (`troop_movements.player_id = auth.uid()` / territories where
  `claim_locked_by = auth.uid()`) so it can't be used against anyone
  else's timers. If the movement is still `in_transit`, shrinks
  `transfer_arrives_at` to `now() + 10s` (and, for `kind = 'claim'`,
  also shrinks `claim_transfer_arrives_at`/`claim_occupation_completes_at`
  to 10s/20s so both stages remain visible); if a claim has already
  reached `occupying`, shrinks just the remaining
  `claim_occupation_completes_at` to 10s. Calls
  `resolve_due_movements()` at the end so the effect is immediate.
  **This is explicitly a testing-only gameplay-balance bypass** — noted
  in the migration's own comment header as something to remove or
  feature-flag before any real public launch.
- `lib/territories/api.ts`: added `debugSpeedUpMovement(movementId)`
  wrapping the new RPC.
- `components/territories/MyMovementsPanel.tsx`: added a small "⏩ 10s
  (test)" button next to every in-progress movement/claim's ETA (hidden
  once a battle link is shown, since there's nothing left to speed up at
  that point); clicking it disables itself, calls the RPC, and refetches
  the movements list. Refactored the panel's `load()` out of the
  `useEffect` so both the polling interval and the button handler share
  it.
- `components/territories/MyMovementsPanel.test.tsx`: added a new test
  (button click → `debugSpeedUpMovement` called with the right id →
  list refetched); all other existing tests untouched and still pass.

**Verification**: `npx tsc --noEmit` clean; full `npx jest --ci`
**209/209 tests passing** (32 suites, +1 new); `npm run build` clean.

**Status**: ✅ Implemented and self-verified. **NOT committed** — per
this project's commit policy, awaiting the user's live confirmation
that the button works as expected before committing/pushing.

---

## 13. Bug fix: `HeartbeatBeacon` never actually kept `last_seen_at` fresh — blocked live PvP battles from ever starting

While live-testing the seeded PvP battle from §12, the user reported both
players clicked "Jsem připraven" but the battle stayed stuck at
`awaiting_ready` forever. Root-caused directly against the live DB:

- `mark_ready` only flips a battle to `active` if **both**
  `players.last_seen_at` values are `>= now() - interval '2 minutes'`
  (an anti-abuse "both sides genuinely online right now" check).
- Querying the live DB found **both** real test accounts'
  `last_seen_at` frozen at the exact same millisecond, ~10 hours in the
  past — despite both having been actively logged in and clicking
  buttons (`declare_attack`, `mark_ready`) minutes earlier. Across the
  *entire* `players` table (only 2 real rows), no `last_seen_at` value
  had ever been updated more recently than that one frozen timestamp.
- Directly simulated a PostgREST-style authenticated call to the
  `heartbeat()` SQL function itself (`set role authenticated; set
  request.jwt.claims = '{"sub": "<uuid>", ...}'; select heartbeat();`)
  and confirmed **the SQL function works perfectly** — `last_seen_at`
  and `total_playtime_seconds` updated correctly. This isolated the bug
  to the client: `components/players/HeartbeatBeacon.tsx` was mounted
  in the root layout, but its interval was gated behind `useSession()`'s
  React-derived `user` state (`if (!user) return`), which is a separate,
  fragile piece of client state from the actual persisted Supabase
  session that every other authenticated RPC call already relies on
  directly. Something about that gating (most likely stalling/never
  re-populating after certain navigations, tab backgrounding, or a
  hydration race) meant the beacon silently never fired in practice,
  even though the user was clearly authenticated for every other
  purpose.
- **Immediate unblock** (data only): manually bumped both players'
  `last_seen_at` to `now()` directly in the DB — this let the existing
  20s auto-retry poll in `BattleScreen.tsx` (which already re-calls
  `markReady` while `awaiting_ready`, precisely to handle this kind of
  transient non-overlap) succeed on its next tick. Confirmed: the
  seeded battle (territory 78, `hradecak87` vs `hradecky87`) flipped to
  `active` and round 1 resolved automatically.
- **Permanent fix** (code): rewrote `HeartbeatBeacon.tsx` to no longer
  depend on `useSession()` at all — it now calls `heartbeat()`
  unconditionally on mount, every 30s, **and** immediately whenever the
  tab's `visibilitychange` fires back to `visible` (covers
  backgrounded/sleeping-laptop scenarios where browsers throttle or
  fully suspend timers for long stretches). Calling `heartbeat()` while
  logged out is harmless — its `where id = auth.uid()` then matches
  zero rows. Also added error logging (`console.error`) on RPC failure,
  since the old code silently discarded the promise entirely, which
  would have hidden this exact class of bug from the browser console.
  New `components/players/HeartbeatBeacon.test.tsx` (5 tests): fires on
  mount, fires every 30s, fires on tab-visible, logs on RPC error, and
  stops firing after unmount.

**Verification**: `npx tsc --noEmit` clean; full `npx jest --ci`
**214/214 tests passing** (33 suites, +5 new); `npm run build` clean.

**Status**: ✅ Implemented, verified, **committed (`c448f6f`) and pushed
to `origin/main`** together with §12's test speed-up button (same
commit — both were built and verified in the same session before the
user's single "ano, pushni" approval).

---

## 14. Bug fix: capturing an NPC-garrisoned territory left the fight completely invisible

Immediately after §13's fix, the user captured an NPC-owned territory
with a village and reported: no fight was visible, no result shown —
the territory just silently became theirs. Root-caused directly against
the live DB again: a battle *had* happened (`1dd846b4…`, territory 83,
`hradecky87` vs NPC, **164 rounds**, `status = 'resolved'`) — NPC
defenders resolve synchronously the instant the attack's troop movement
arrives (no `mark_ready`/human interaction needed, per the original
battle design), so by the time the client next polled, both of these
were already true simultaneously:
- `get_my_movements()` only returns `status in ('in_transit',
  'occupying')` — the attack's movement row was already `'completed'`,
  so it dropped out of `MyMovementsPanel`'s list entirely.
- `getMyActiveBattles()` explicitly excludes `resolved`/`expired`
  battles (by design, for the "battle in progress" link) — so the
  now-finished battle was excluded too.

Net effect: **no UI affordance anywhere ever pointed at this battle.**
All 164 rounds were fully recorded in `battle_rounds` and perfectly
viewable via the existing `get_battle`/`BattleScreen`/`RoundResultPopup`
machinery — the only bug was that nothing linked to it.

**Fix**: added `getMyRecentlyResolvedBattles(playerId)` to
`lib/territories/api.ts` — a plain `battles` table query (public
`battles_select_all` RLS policy, no new RPC needed) for the caller's own
battles resolved within the last 48h. `MyMovementsPanel.tsx` now also
fetches this on every `load()` and, using the existing
`getLastSeenRound()` helper from the round-result-popup feature
(§11) compared against `battle.current_round`, filters to only
still-*unseen* results — cheaply reusing the same localStorage marker
so a battle disappears from this list once the user has actually opened
it and watched (or skipped through) every round, without needing any
new state. Renders as a distinct "Bitva dokončena (území N) → Zobrazit
výsledek" row above the in-progress list; the panel's early-return-null
guard was updated to also check this new list so it doesn't hide itself
when there are only unseen results and no in-flight movements.

Also fixed `app/map/page.test.tsx`'s mock of `lib/territories/api` (was
missing the new export, which broke 2 of its tests — added it).

**Verification**: `npx tsc --noEmit` clean; full `npx jest --ci`
**216/216 tests passing** (33 suites, +2 new in
`MyMovementsPanel.test.tsx`); `npm run build` clean.

**Status**: ✅ Implemented and verified. **NOT committed yet** —
awaiting the user's confirmation it looks right before commit/push.

## 14. 2026-08-17 — Map UX polish worktree (`feature/map-ux-fixes`)

Focused UX cleanup in the isolated `bcg-worktrees\map-ux` worktree, with
changes intentionally limited to the map page/viewport and their tests:

- **Merged contiguous owned borders** in
  `components/territories/MapViewport.tsx`: replaced the old all-sides
  `ring-2 ring-sky-400` highlight with per-side border logic based on the
  existing `byCoord` map. Adjacent same-owner tiles now suppress the shared
  blue edge so contiguous territory groups render as one merged outline.
  The same per-edge treatment was also applied to contiguous
  `battle_locked_by` red highlights when neighboring tiles share the same
  attacker id.
- **Scaled tile icons by zoom level** in `MapViewport.tsx`: all map emoji
  markers (`🏠🏰🏘️🚩⏳⚔️`) now use an inline `fontSize` derived from
  `viewSize`, so close zooms render larger icons and far zooms shrink them.
- **Made out-of-bounds cells inert** in `MapViewport.tsx`: coordinates
  outside `0..255` now render as dashed void cells (`data-testid:
  void-tile-x,y`) instead of normal clickable buttons, with no tooltip or
  click target. The jump form now also clamps entered coordinates to the
  same valid range before calling `onJump`, and its displayed values stay in
  sync with parent `centerX/centerY`.
- **Reworked the mobile toolbar layout** in `MapViewport.tsx`: added a
  stacked `flex-col sm:flex-row` toolbar (`data-testid="map-toolbar"`),
  horizontal-on-mobile zoom buttons, compact `w-16` X/Y inputs, and a jump
  button that spans the mobile form width to avoid overflow around ~375px.
- **Defaulted the map to the player's home territory + added a focus list**
  in `app/map/page.tsx`: once `user` exists, the page now auto-runs the same
  home lookup used by the manual "🏠 Moje domovské území" button, centering
  the initial view on the home tile. The page also now loads
  `getMyTerritories(user.id)` and renders a compact "Tvoje území" chip list
  above the map, each with coords, an icon (home/castle/village/flag), and
  a `Zaostřit` button that jumps to that territory.
- **Expanded `getMyTerritories` data** in `lib/territories/api.ts` to
  include `castle_rank`/`village_rank` so the new focus list can show the
  correct marker without inventing a new query.
- **Tests updated first, then implementation**:
  `components/territories/MapViewport.test.tsx` now covers merged borders,
  void cells, icon scaling, jump clamping, and mobile-toolbar classes;
  `app/map/page.test.tsx` now covers auto-centering on home plus the owned
  territory focus list/buttons. Current verification after this change:
  `npx tsc --noEmit` clean, `npm test -- --runInBand` **223/223 tests
  passing** (33 suites), `npm run build` clean. The only remaining build
  output is an upstream Supabase warning that Node 20 will be deprecated in
  the future; there are no project ESLint/type warnings from this change.

## 15. Own profile battle history — implemented and verified in `feature/profile-battle-history`

Added a new "Historie bitev" section to `app/profile/me/page.tsx`, rendered
below `PlayerProfileCard` via a dedicated
`components/players/BattleHistoryList.tsx` client component. The section loads
the current player's **25 most recent resolved/expired battles** (attacker or
defender) with a plain `supabase.from('battles').select(...)` query in the new
`getMyBattleHistory(playerId)` helper in `lib/battles/api.ts`; no new
migration/RPC was needed because `battles_select_all` already allows this
read, matching the existing `getMyRecentlyResolvedBattles()` pattern.

Data exposed per row:
- territory coords via embedded `territories(x, y)`,
- player role (`attacker`/`defender`),
- opponent name (or `NPC` when `defender_id` is null),
- outcome relative to the viewing player (`won` / `lost` / `expired`),
- round count,
- troop gain/loss counts,
- inferred territory change (`gained` / `lost` / `none`).

Important implementation note: troop gains/losses are counted from
`battle_rounds` and are effectively exact for non-skipped rounds, because
every resolved round captures exactly one losing card (`owner_id` flips to the
winner's owner in `_resolve_round`). Territory change is inferred from the
normal `_finalize_battle` path: any non-home attacker win is treated as a
territory swing; this intentionally ignores the rare attacker-win-but-32-cap-
blocked edge case because the `battles` row alone does not record that
exception.

Tests added:
- `lib/battles/api.test.ts` — mocks the Supabase table query and verifies
  role/opponent/outcome/troop-delta mapping for win, loss, NPC, and expired
  cases.
- `components/players/BattleHistoryList.test.tsx` — renders Czech UI for the
  same scenarios, including empty-state handling and battle-detail links.
- `app/profile/me/page.test.tsx` — updated to assert the new section appears.

Verification in this worktree: `npx tsc --noEmit` clean; full `npm test`
**220/220 tests passing** (35 suites); `npm run build` clean. Build output
does emit repeated upstream warnings that `@supabase/supabase-js` will require
Node 22+ in the future, but the production build succeeds on the current
environment.

## 2026-08-17 — Mobile battle roster carousel overflow fix

**Problem**: On narrow screens, the stacked battle layout used `items-center`, so each mobile `RosterStrip` sized itself to its content width. That prevented the strip's own `overflow-x-auto` row from scrolling internally and instead widened the whole page horizontally once a roster had more than ~4 cards.

**Fix implemented**:
- `components/battles/BattleScreen.tsx`: battle layout row now uses `w-full max-w-full min-w-0` and `items-stretch` below `md`, plus a `battle-layout` test id for layout assertions. Desktop `md:flex-row md:items-start md:justify-center` remains unchanged.
- `components/battles/RosterStrip.tsx`: roster root now uses `w-full max-w-full min-w-0`; the mobile scroll row now has `min-w-0`, `snap-x snap-mandatory`, and a `roster-scroll` test id; each mobile card button is `w-[4.875rem] shrink-0 snap-start` so roughly four cards fit on typical mobile widths while the rest scroll horizontally. Desktop still switches to the existing vertical `md:flex-col` / `md:w-40` layout.
- `components/battles/DuelStage.tsx`: root now also uses `w-full max-w-full min-w-0 md:w-auto` so the middle stage cannot be the flex item that forces overflow on mobile.
- Tests: added `components/battles/RosterStrip.test.tsx` and one new class-assertion test in `components/battles/BattleScreen.test.tsx` to lock in the width-constraining and snap-scroll utility classes.

**Verification**:
- `npx tsc --noEmit` ✅
- `npm test -- --runInBand` ✅ (218/218 tests, 34/34 suites)
- `npm run build` ✅ (build succeeded; existing environment emitted repeated Supabase Node 20 deprecation warnings)

## 16. Combat probability preview + upset flavor text — implemented and verified in `feature/combat-probability`

Battle rounds are no longer strictly deterministic. The old TTK race still
computes the **deterministic favorite**, but actual round resolution now uses
an attacker win probability derived from damage-per-HP rates:

- `rateAttacker = dmgToDefender / defender.hp` when attacker damage > 0, else `0`
- `rateDefender = dmgToAttacker / attacker.hp` when defender damage > 0, else `0`
- if both rates are `0`, attacker win probability = **`0.03`**
- otherwise `raw = rateAttacker / (rateAttacker + rateDefender)`
- final attacker probability = **`0.03 + raw * 0.94`** (so all rounds stay in
  the closed **3%-97%** band)

Implemented changes in this worktree:
- `lib/cards/combat.ts` adds `calculateWinProbability()` returning
  `{ attackerWinProbability, deterministicWinner }`, reusing the existing
  `resolveDuelWithBreakdown()` winner for upset detection.
- `lib/cards/combat.test.ts` adds coverage for: 50/50 identical cards,
  97/3 one-sided mismatch, 3% mutual-zero-damage stalemate, and two moderate
  curve-shape sanity checks.
- `supabase/migrations/0007_combat_probability.sql` adds
  `battle_rounds.attacker_win_probability numeric` and
  `battle_rounds.flavor_text text`, creates/ seeds `combat_flavor_texts`
  (16 Czech medieval upset lines), enables RLS on that table, and replaces
  `_resolve_round(...)` so it stores the computed probability, rolls
  `random()`, resolves the actual winner probabilistically, and only stores a
  random flavor text when the actual winner differs from the old TTK favorite.
- `supabase/migrations/0003_battles.verification.sql` now also checks the new
  stored probability / flavor-text fields through both `battle_rounds` and
  `get_battle()`.
- `lib/battles/api.ts` extends `BattleRoundRow` with
  `attacker_win_probability` and `flavor_text`.
- `components/battles/BattleScreen.tsx` now uses a **two-step** defender pick:
  clicking a defender card marks a tentative preview only; a compact Czech
  confirm panel shows an **estimated** defender win chance plus
  **Potvrdit** / **Vybrat jinou** buttons; only confirm triggers
  `pickDefenderCard(...)`. The tentative card auto-clears if the round closes
  or the card becomes ineligible before confirm.
- `components/battles/RosterStrip.tsx` adds a distinct blue preview ring
  separate from the existing amber "already committed / active in duel" ring.
- `components/battles/RoundResultPopup.tsx` now shows the stored
  **Šance útočníka na výhru: X %** and, when `flavor_text` is non-null,
  a prominent **Zvrat! ⚡ ...** banner.
- `components/battles/BattleScreen.test.tsx` verifies preview-before-submit
  and cancel-without-submit behavior.
- `components/battles/RoundResultPopup.test.tsx` verifies probability text and
  upset banner rendering.

Important note: the **preview** probability shown before defender confirm is
explicitly labeled as an **estimate** (`Odhad šance...`) because that client
preview currently uses only rank-scaled unit stats, while the authoritative
server-side SQL also incorporates territory/nation combat modifiers when
present. The actual resolved round always stores and displays the exact server
probability from `_resolve_round`.

Verification in this worktree after the final review fixes:
- `npx tsc --noEmit` — clean
- `npm test -- --runInBand` — **226/226 tests passing** across 35 suites
- `npm run build` — clean production build; same pre-existing
  `@supabase/supabase-js` Node 22 future-warning repeats during static page
  generation, but the build succeeds fully

## 17. Map owned-territory border pixel-perfect fix + foreign-owner highlight + icon fixes

Six rounds of pixel-level iteration on `components/territories/MapViewport.tsx`
to get the owned-territory perimeter highlight visually correct, plus three
follow-up icon/highlight features. All committed and pushed to `main`.

**Perimeter border fix (multiple commits, root-caused via headless-browser
pixel screenshots)**:
- Toolbar compacted to a single row; owned-territory list converted to a
  `<select>` dropdown (`2fef70d`).
- Highlight approach evolved: plain CSS `border` → `inset box-shadow`
  (`9a9c01f`, superseded — shadow paints under the border) → absolutely
  positioned 1px overlay `<span>` bars offset `-1px` to sit on the border
  pixel (`330b4e3`) → widened to 2px, centered on the seam, since each tile
  draws its own independent 1px border so a shared edge is actually two
  adjacent lines (`a1ad26d`).
- Remaining 1px corner notch (two perpendicular bars on the same tile only
  *touch* at the corner, don't overlap) diagnosed by installing Playwright in
  a scratch folder (`C:\temp\pw-diag`, outside the repo) and rendering
  isolated Tailwind-CDN HTML reproductions at various `deviceScaleFactor`s,
  screenshotting and pixel-inspecting via PIL crop+nearest-resize. Fixed by
  extending each bar 1px past both its own ends via Tailwind `-left-px
  -right-px` / `-top-px -bottom-px` (tried 2px first per user feedback,
  reduced to 1px — `45228b6`, `b90ff2c`). **User confirmed this is correct;
  border bug fully closed.**

**Follow-up icon/highlight features (this segment)**:
- Foreign-owned territory: removed the 🚩 flag icon; foreign tiles now get
  the same perimeter-highlight treatment as "my territory," but with a
  deterministic (hash-based, not random) per-owner color from a 10-color
  palette (`FOREIGN_OWNER_COLORS`), so contiguous foreign regions read as one
  connected block and different owners are visually distinguishable.
  Unified via `getHighlightInfo(tile, currentUserId)` returning
  `{ key, color, colorClass }` — battle-locked tiles (red) take priority over
  ownership highlights.
- Icon-scaling bug (icons stopped shrinking correctly for a few intermediate
  zoom-out steps): root cause was `getIconFontSize(viewSize)` assuming a
  fixed container width, but the page is responsive. Fixed by measuring the
  real rendered cell width via a `ResizeObserver` on the grid container
  (`cellPx` state) and sizing icons from that directly
  (`Math.round(cellPx * 0.55)`, clamped 10-34px), falling back to the old
  formula only when no measurement is available yet (e.g. jsdom/tests, first
  paint).
- Icon overlap when multiple structures share a tile: castle/village/home
  icons now render side-by-side in one flex row (not stacked), shrunk to
  ~62% size when more than one is present, so they fit within one tile
  instead of overflowing. The battle (⚔️) icon is now an absolutely
  positioned, centered, `animate-pulse` overlay drawn on top of the
  structure icons (dimmed to `opacity-40` underneath) instead of stacking
  below them.

Verification: `npx tsc --noEmit` clean; `MapViewport.test.tsx` updated (the
old box-shadow-based border assertion was stale — rewritten to check the
overlay-span `data-testid="highlight-{edge}-{x},{y}"` elements) plus 3 new
tests for foreign highlight, combined structure icons, and the battle-icon
overlay — **13/13 passing**; full suite **249/249 passing** across 38 suites;
`npm run build` clean.
## 2026-08-17 — Daily reward + level-up card grants

Implemented two new card-acquisition paths in this worktree:
- `supabase/migrations/0013_level_up_cards.sql` adds `players.daily_reward_streak` + `players.last_daily_reward_at`, the new `claim_daily_reward()` RPC, and a `create or replace function _award_xp(...)` update that now grants one random unit card for every crossed level (`common` by default, `uncommon` on exact multiples of 10) while preserving the existing every-5-levels structure-card milestone logic unchanged.
- `supabase/migrations/0013_level_up_cards.verification.sql` adds manual scratch-DB checks for: multi-level XP awards granting the correct common/uncommon unit-card mix, duplicate same-day daily claims raising the friendly `daily reward already claimed today` exception, and streak reset to `1` after a multi-day gap with no catch-up rewards.
- `lib/players/api.ts` + `lib/players/api.test.ts` add the typed client wrapper for `claim_daily_reward()`.
- `components/players/DailyRewardCard.tsx` + test add the new profile-page widget showing current streak, the active claim button, success-grant details, a friendly already-claimed-today state, and automatic re-enable shortly after UTC midnight without requiring a reload.
- `app/profile/me/page.tsx` mounts the widget on the authenticated self-profile page; related profile test mocks were updated for the new player fields.
- `lib/supabase/useSession.ts` now includes the two new player columns in `PlayerRow` so the UI can render the streak directly from the fetched `players` row.

Verification in this worktree:
- Baseline `npx jest 2>&1 | Select-String "Tests:"` with changes temporarily stashed: **282 passed, 282 total**
- Final `npx jest 2>&1 | Select-String "Tests:"`: **287 passed, 287 total**
- `npx tsc --noEmit` ✅
- `npm run build` ✅ with temporary placeholder `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`; build still emits the pre-existing upstream Supabase Node 20 deprecation warnings, but succeeds.
