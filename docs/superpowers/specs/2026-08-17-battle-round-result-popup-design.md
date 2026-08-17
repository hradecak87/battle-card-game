# Battle Round Result Popup — Design Spec

**Status**: Approved by user, 2026-08-17. Follow-up to subsystem #4
(Multi-Army RTS Battle). See `docs/superpowers/PROGRESS.md` §9/§10 for
context on the parent feature and this session's playtesting fixes.

## 1. Problem

Round resolution in `BattleScreen` currently happens silently: the
defender picks a card (or it auto-picks on timeout), the round resolves
server-side, and the UI just re-renders with an updated running score and
an extra row in `RoundHistory` — there is no moment-to-moment feedback
about *who won a given round and why*. The user wants a popup, styled like
a nice trading-card-game duel result screen, shown after every round.

## 2. Decisions (from brainstorming)

- **Visual style**: a centered modal (dims the background), showing both
  cards side by side, the winner highlighted, and a stats/reasoning
  breakdown — reusing the existing `/arena` page's "Výpočet souboje"
  (ATK/DMG/TTK) convention and visual language for consistency.
- **No mutual acknowledgement.** Earlier framing ("both players must
  click Continue and see the other's readiness") was explicitly dropped
  by the user as unnecessary. The popup is purely informational; each
  viewer dismisses their own independently. It never blocks battle
  progress — round resolution already happens server-side regardless of
  whether anyone is looking at a popup.
- **Auto-dismiss after 20s**, with a live visible countdown, plus a
  manual close (✕) in the top-right corner for anyone who doesn't want to
  wait.
- **Skipped rounds** (either side has no eligible, non-resting card that
  round — matches the existing `_start_next_round` check `v_attacker_avail
  = 0 or v_defender_avail = 0`, not "both sides") get a short, distinct
  popup variant: "Kolo přeskočeno – všechny karty odpočívají." (no card
  art, no stats).
- **Sequenced, not simultaneous.** Any newly-resolved rounds the current
  viewer hasn't seen yet are queued and shown **one at a time**, in
  round-number order. This uniformly covers both:
  - **PvP battles**: normally exactly one new round resolves at a time,
    so the queue is usually length 1.
  - **NPC (PvE) battles**: `_start_next_round` already plays out an
    entire NPC battle to its win condition in one synchronous server
    call (see `0003_battles.sql`), so a viewer opening the battle screen
    for the first time may find e.g. 9 already-resolved rounds. All 9
    play back as a sequence of popups (one every ≤20s, or faster if the
    viewer clicks past them), rather than being silently skipped or
    collapsed into a single final summary.
- **"Already seen" tracking is per-browser, per-battle, via
  `localStorage`.** Key: `battle-{battleId}-last-seen-round`. On mount,
  any resolved round with `round_number` greater than the stored value is
  queued for the popup sequence; the stored value advances as each popup
  in the queue is dismissed (auto or manual), so a page reload never
  replays rounds already shown to that browser, but genuinely new rounds
  (live or a first-time view of an already-finished NPC battle) always
  play.

## 3. Data model change

`_resolve_round` (in `0003_battles.sql`) already computes the effective
ATK/DMG/TTK breakdown for both sides via `_compute_effective_stats`, but
only ever persists `winner_card_instance_id` — the breakdown numbers are
discarded. `battle_rounds` already has a `skipped boolean not null
default false` column (set directly by the existing skip-handling code
path, ~line 1286) — the popup's "is this a skipped round?" check uses
that existing column directly, **not** a null-columns heuristic.

A new migration (`0005_battle_round_breakdown.sql`) adds 6 nullable
numeric columns to `battle_rounds`:

```sql
alter table battle_rounds
  add column attacker_atk numeric,
  add column attacker_dmg_dealt numeric,
  add column attacker_ttk numeric,     -- null represents "infinite" (0 damage dealt)
  add column defender_atk numeric,
  add column defender_dmg_dealt numeric,
  add column defender_ttk numeric;
```

`_resolve_round` is updated to populate these 6 columns from its existing
`v_atk_dmg`, `v_def_dmg`, `v_ttk_attacker_wins`, `v_ttk_defender_wins`
locals (~line 1149-1153), translating Postgres's `'infinity'::numeric`
to SQL `null` on the way in (infinity doesn't round-trip cleanly through
PostgREST/JSON, and the UI already needs a "the other side never even
scratched them" case for its explanation text). `attacker_atk`/
`defender_atk` are simply `greatest(str, lng)` of each side's already-
computed effective stats (i.e. `v_atk_eff`/`v_def_eff` — the same values
`v_atk_dmg`/`v_def_dmg` are derived from), not a new computation. Skipped
rounds leave all 6 columns `null` (already the default) since
`_resolve_round` is never called for them.

**Card lookup for historical rounds.** `attacker_roster` is the
attacker's fixed committed pool for the whole battle (never shrinks) but
`defender_pool` only reflects **currently available** defender cards —
once a card is captured (ownership changes) or dies, it drops out of
`defender_pool`, so a later viewer looking up an older round's defender
card by id against the *current* `defender_pool` can fail to find it.
To keep round history self-contained and correct regardless of later
captures/deaths, `get_battle`'s round-row query is extended to **join
each round directly to `card_instances`/`card_templates`** (by
`attacker_card_instance_id` / `defender_card_instance_id`, both of which
are stable ids that are never deleted, only re-owned) and return the
resolved `BattleCardTemplate` inline on the round row — the popup does
not need to (and must not) resolve card art via the live
`attacker_roster`/`defender_pool` arrays. Skipped rounds have `null` ids
for both card fields and thus `null` for both nested templates, but the
authoritative "is this round skipped?" check is always
`battle_rounds.skipped`, never a null-fields inference — the two happen
to coincide for skipped rows, but the popup component's control flow
branches on `round.skipped` alone (see §4).

`BattleRoundRow` (in `lib/battles/api.ts`) gains the 6 new optional
numeric fields plus `attacker_card: { instance_id: string; template:
BattleCardTemplate } | null` and `defender_card: { ... } | null`.

## 4. Frontend

- **New component `components/battles/RoundResultPopup.tsx`**: renders
  the modal for a single round. Prop is just the enriched
  `BattleRoundRow` (round data + nested `attacker_card`/`defender_card`
  templates, per §3 — no separate roster lookup needed) and an
  `onDismiss` callback. If `round.skipped` is true, renders the short
  "Kolo přeskočeno" variant (no card art/stats); otherwise renders both
  cards side by side (winner highlighted via `round.winner_card_instance_id`)
  plus an ATK/DMG/TTK `<dl>` grid modeled on `/arena`'s `SideResult`, with
  one plain-language sentence ("X zvítězil, protože stihl zabít dřív
  (nižší TTK)" or "...neutrpěl žádné zranění, protilehlá karta útočila
  na dálku a naše na blízko" for the 0-damage/infinite-TTK case).
  Internally runs its own 20s countdown (same `useCountdown`-style
  pattern as `DuelStage`) and calls `onDismiss` when it hits 0 or the ✕
  is clicked. Reuses `TradingCard` for the card art.
- **`BattleScreen.tsx` changes**:
  - A `popupQueue: BattleRoundRow[]` piece of state, rebuilt whenever
    `data.rounds` changes: any round with `round_number` greater than the
    localStorage-persisted "last seen" value for this `battleId`, sorted
    ascending, that isn't already in the queue or already shown.
  - Renders `RoundResultPopup` for `popupQueue[0]` only (one at a time);
    `onDismiss` advances `localStorage`'s last-seen value to that round's
    number and shifts the queue.
  - This is purely additive to the existing polling/realtime plumbing
    (`useBattleChannel`, the round-deadline auto-reload timer added
    earlier this session) — no changes to when/how rounds actually
    resolve server-side.
  - All `localStorage` reads/writes for the last-seen-round marker are
    guarded to run client-only (inside a `useEffect`, never during SSR
    render), matching this codebase's existing convention (see e.g. the
    `markReady` retry timer's `useEffect` usage in the same file).

## 5. Testing

- `lib/battles/api.ts` type changes: covered implicitly by `tsc`.
- `RoundResultPopup.test.tsx` (new): renders winner/loser highlighting,
  ATK/DMG/TTK numbers, the skipped-round variant, the 20s countdown
  auto-dismiss (fake timers), and the ✕ manual dismiss.
- `BattleScreen.test.tsx` (extended): queuing multiple unseen rounds and
  showing them one at a time; a previously-seen round (per a pre-seeded
  `localStorage` value) not re-appearing on mount.
- SQL: no live migration smoke test is planned for this small, additive
  change (6 nullable columns, no behavior change to existing columns) —
  `tsc`/`jest` plus a manual live playtest by the user is sufficient, same
  bar as this session's other fixes.

## 6. Out of scope (explicitly)

- Mutual "both players ready to continue" gating — dropped by the user.
- Any change to round-resolution timing, timeouts, or the RTS mark_ready
  gate.
- Sound effects / richer animation — can be a later polish pass if
  requested.
