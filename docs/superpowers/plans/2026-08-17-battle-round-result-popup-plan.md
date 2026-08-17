# Battle Round Result Popup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement
> this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the round-result popup feature per
`docs/superpowers/specs/2026-08-17-battle-round-result-popup-design.md`:
persist the ATK/DMG/TTK breakdown per round, enrich `get_battle`'s round
rows with resolved card templates (capture/death-proof), and show a
dismissible modal (20s countdown + ✕) for each newly-seen round, queued
and played back sequentially, with a distinct short variant for skipped
rounds.

**Architecture:** One additive SQL migration
(`0005_battle_round_breakdown.sql`) adds 6 nullable numeric columns to
`battle_rounds`, updates `_resolve_round` to populate them, and updates
`get_battle`'s round-row query to join in `attacker_card`/
`defender_card` (id + resolved `BattleCardTemplate`) directly from
`card_instances`/`card_templates`, independent of the live
`attacker_roster`/`defender_pool` arrays. `lib/battles/api.ts`'s
`BattleRoundRow` type gains the new fields. A new
`components/battles/RoundResultPopup.tsx` renders one round (or the
skipped variant); `BattleScreen.tsx` gains a `localStorage`-backed
"last-seen round" queue that shows unseen rounds one at a time. Keeps
this project's convention: moderate step granularity, code + test +
verify + commit per task.

---

## Chunk 1: Database — persist and expose the round breakdown

### Task 1: Migration — add breakdown columns, update `_resolve_round` and `get_battle`

**Files:**
- Create: `supabase/migrations/0005_battle_round_breakdown.sql`

- [ ] `alter table battle_rounds add column attacker_atk numeric,
  add column attacker_dmg_dealt numeric, add column attacker_ttk numeric,
  add column defender_atk numeric, add column defender_dmg_dealt numeric,
  add column defender_ttk numeric;` (all nullable, no default — skipped
  rounds keep them `null`).
- [ ] `create or replace function _resolve_round(...)` (copy the full
  existing body from `0003_battles.sql` and extend only the final
  `update battle_rounds set ...` statement) to also set:
  `attacker_atk = greatest(v_atk_eff.str, v_atk_eff.lng)`,
  `attacker_dmg_dealt = v_atk_dmg`,
  `attacker_ttk = case when v_ttk_attacker_wins = 'infinity'::numeric
  then null else v_ttk_attacker_wins end`, and the symmetric 3 for
  defender (`defender_atk`, `defender_dmg_dealt`, `defender_ttk`).
- [ ] `create or replace function get_battle(...)` (copy the full
  existing body, extend only the rounds sub-select) so each round row
  also includes `attacker_card` and `defender_card` — each an object
  `{instance_id, template: {...same shape card_instances/card_templates
  joins already use elsewhere in this function for the rosters...}}` or
  `null` when the corresponding `*_card_instance_id` is null. Build via
  a `left join card_instances ... left join card_templates ...` per side
  in the rounds CTE, `to_jsonb`'d per row alongside the existing round
  columns.
- [ ] Deploy to the live Supabase project using this session's
  established direct-`pg`-connection pattern (same as `0004_fix_find_home.sql`).
  This is a small additive change (new nullable columns +
  `create or replace function`, no data rewrite, no existing column
  changes) — lower risk than prior migrations, but still confirm via a
  live `select` that the new columns exist and `get_battle` still returns
  successfully for an existing battle before moving on.
- [ ] Commit: `feat(db): persist round ATK/DMG/TTK breakdown and expose resolved card templates`

### Task 2: `lib/battles/api.ts` type updates

**Files:**
- Edit: `lib/battles/api.ts`

- [ ] Extend `BattleRoundRow` with the 6 new optional numeric fields
  (`attacker_atk?`, `attacker_dmg_dealt?`, `attacker_ttk?: number | null`,
  and the defender equivalents) plus:
  ```ts
  attacker_card: { instance_id: string; template: BattleCardTemplate } | null
  defender_card: { instance_id: string; template: BattleCardTemplate } | null
  ```
- [ ] Run `npx tsc --noEmit` — expect clean (this alone won't catch
  runtime shape mismatches; Chunk 3's tests do).
- [ ] Commit: `feat: expose round breakdown fields in BattleRoundRow type`

---

## Chunk 2: `RoundResultPopup` component

### Task 3: Build the popup component

**Files:**
- Create: `components/battles/RoundResultPopup.tsx`
- Test: `components/battles/RoundResultPopup.test.tsx`

- [ ] Props: `{ round: BattleRoundRow; onDismiss: () => void }`.
- [ ] If `round.skipped`: render the short variant only — a centered
  modal with the text "Kolo přeskočeno – všechny karty odpočívají.", a ✕
  close button, and the same 20s auto-dismiss countdown (reuse one
  countdown implementation for both variants).
- [ ] Otherwise: render both cards side by side via `TradingCard` (using
  `round.attacker_card!.template` / `round.defender_card!.template`),
  highlight the winner (compare `round.winner_card_instance_id` against
  each side's `instance_id`), and an ATK/DMG/TTK `<dl>` grid per side
  modeled on `/arena`'s `SideResult` (reuse its visual conventions/class
  names where practical, but this is a new component — don't import from
  `app/arena/page.tsx` directly). Render one explanatory sentence: if a
  side's `*_ttk` is `null`, phrase it as "nestihl/a zasáhnout" (never
  dealt damage); otherwise compare the two `*_ttk` values and phrase as
  "zvítězil/a, protože zabil/a dřív (kolo X vs Y)".
- [ ] 20s visible countdown (reuse `DuelStage`'s countdown pattern/hook
  if one already exists there, otherwise a local `useEffect` +
  `setInterval`); calls `onDismiss` at 0. ✕ button calls `onDismiss`
  immediately, clearing the interval.
- [ ] Tests: skipped variant renders correct text and no card art;
  resolved variant renders both cards, highlights the correct winner,
  shows correct ATK/DMG/TTK numbers, shows the "never dealt damage"
  phrasing when a side's ttk is null; countdown auto-dismisses via fake
  timers; ✕ dismisses immediately.
- [ ] Run `npx jest components/battles/RoundResultPopup.test.tsx` —
  expect PASS.
- [ ] Run `npx tsc --noEmit` — expect clean.
- [ ] Commit: `feat: add RoundResultPopup component`

---

## Chunk 3: Wire the popup queue into `BattleScreen`

### Task 4: last-seen-round tracking + popup queue

**Files:**
- Edit: `components/battles/BattleScreen.tsx`
- Edit: `components/battles/BattleScreen.test.tsx`

- [ ] Add a small local helper (inline or a tiny new
  `lib/battles/lastSeenRound.ts` if it keeps `BattleScreen.tsx` cleaner)
  wrapping `localStorage` get/set for key
  `` `battle-${battleId}-last-seen-round` ``, guarded to run client-only
  (inside `useEffect`, matching the existing `markReady` retry timer's
  convention in this file).
- [ ] On every `data.rounds` change, compute the sorted list of rounds
  with `round_number` greater than the stored last-seen value; merge any
  new ones into a `popupQueue` state array (dedupe by `round_number`,
  don't re-add ones already dismissed this session).
- [ ] Render `RoundResultPopup` for `popupQueue[0]` only, when the queue
  is non-empty. Its `onDismiss` updates `localStorage`'s last-seen value
  to that round's `round_number` and removes it from the queue (revealing
  the next one, if any, immediately — no artificial gap between queued
  popups).
- [ ] Tests: multiple newly-resolved rounds (simulating an NPC battle
  first view) queue and play back one at a time in order; a battle
  reopened with a pre-seeded `localStorage` last-seen value doesn't
  re-show already-seen rounds; a single new PvP round shows immediately.
- [ ] Run `npx jest components/battles/BattleScreen.test.tsx` — expect
  PASS (existing 7 tests + new ones).
- [ ] Run `npx tsc --noEmit` — expect clean.
- [ ] Commit: `feat: queue and display round result popups in BattleScreen`

---

## Chunk 4: Final verification and docs

### Task 5: Full-suite verification, build check, PROGRESS.md update

- [ ] Run full `npx jest --ci` — expect all suites passing (200 existing
  + new ones from Chunks 2-3).
- [ ] Run `npx tsc --noEmit` — expect clean.
- [ ] Run a full `npm run build` (not just `tsc`/`jest`) to catch any
  ESLint-only failures invisible to the other two, per this session's
  earlier Vercel lesson. Watch out for the stale-`next`-process `.next/`
  lock gotcha (kill stale node PIDs first if needed).
- [ ] Update `docs/superpowers/PROGRESS.md` with a new subsection
  describing this feature (mirroring the style of the existing `## 10`
  section): what was built, the new migration, and a note that the
  earlier-session round-deadline auto-reload fix (`BattleScreen.tsx`
  `useEffect`, previously uncommitted) is included/committed alongside
  it.
- [ ] Do **not** push to `origin/main` or `git commit` this final
  wrap-up without the user's live playtest confirmation once they
  return — per this project's commit/push policy, hold the verified
  work at "ready, awaiting confirmation" rather than pushing
  autonomously, even though implementation itself proceeds without
  further check-ins.
