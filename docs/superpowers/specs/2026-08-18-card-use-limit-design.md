# Card use limit per battle (backlog #17)

## Problem

A card instance currently rests for 2 rounds after fighting, then becomes
eligible again indefinitely. In a long battle (many cards on one or both
sides), the same card can therefore be reused an unbounded number of times,
which the owner considers unbalanced — a single strong card can carry an
entire battle by itself once its rest expires, over and over.

## Goal

Cap how many times a single card **instance** may fight within one battle,
regardless of which side currently owns it (capture does not reset the
counter), and surface the remaining uses to players during the battle.

## Decisions (confirmed with the owner)

- **Limit**: a card instance may fight a maximum of **5 times** per battle.
  This is a single fixed constant (not rank-dependent) for this iteration.
- **Scope**: the counter is keyed by `(battle_id, card_instance_id)` and
  counts total fights across the whole battle, not per side and not per
  streak — a card captured mid-battle keeps its existing count (e.g. 3/5
  stays 3/5 after switching owners).
- **Exhaustion**: once a card reaches 5 uses, it can never fight again in
  that battle (until the battle ends), even though its owner may still hold
  it. It becomes permanently ineligible for random attacker draws, NPC
  defender picks, and the live defender's own pick.
- **New loss condition**: a side loses the battle immediately once **all**
  of its currently-owned cards are exhausted (5/5), even if it still
  technically owns cards — otherwise the existing "skip this round, no
  available (non-resting) card" logic would loop forever, since exhaustion
  (unlike resting) never expires. This is evaluated in addition to, and
  before, the existing "0 owned cards" loss condition.
- **Visibility**: each card's remaining-uses count must be visible during
  the battle (roster strip badge), not just enforced silently.

## Data model

No new table. Extend the existing per-battle cooldown table:

```sql
alter table battle_unit_rest add column times_used integer not null default 0;
```

`battle_unit_rest` already gets an upsert row for both the attacker's and
the defender's card every time `_resolve_round` resolves a round (to set
`resting_until_round`). The same upsert now also increments `times_used`:

```sql
insert into battle_unit_rest (battle_id, card_instance_id, resting_until_round, times_used)
values (p_battle_id, p_attacker_card, v_resting_until, 1),
       (p_battle_id, p_defender_card, v_resting_until, 1)
on conflict (battle_id, card_instance_id)
do update set resting_until_round = excluded.resting_until_round,
              times_used = battle_unit_rest.times_used + 1;
```

The limit itself (`5`) is a named constant, duplicated deliberately in two
places that cannot share code (SQL and TypeScript):
- SQL: a `constant` comment + literal `5` at each call site (Postgres has no
  first-class named constants usable inline in a query the way a CTE could
  provide, so a `create or replace function _max_card_uses() returns
  integer ... as $$ select 5 $$` immutable SQL function is used instead,
  so every query site calls `_max_card_uses()` rather than repeating the
  literal).
- TypeScript: `lib/battles/cardUseLimit.ts` exports `MAX_CARD_USES_PER_BATTLE = 5`,
  imported by both the client roster display and the Monte Carlo simulator.

## Server-side (SQL) changes — all in a new `0015_card_use_limit.sql`

1. **`_max_card_uses()`** — new tiny immutable SQL function returning `5`,
   so every other query below calls it instead of a bare literal.
2. **`_resolve_round`** — the existing `battle_unit_rest` upsert (shown
   above) gains `times_used`.
3. **Availability filters** (every place that currently excludes resting
   cards via `not exists (select 1 from battle_unit_rest bur where ...
   and bur.resting_until_round >= <round>)`) gets an additional `or
   bur.times_used >= _max_card_uses()` inside the same `exists` subquery —
   a one-line change per site, no new joins. Call sites:
   - `_resolve_round`'s NPC-defender candidate loop (twice — once for the
     "first pass" duel simulation loop, once for the fallback random-pick
     array)
   - `_start_next_round`'s attacker/defender per-round availability counts
     (both the PvP and NPC-defender branches)
   - `_start_next_round`'s attacker card random-draw query
   - `pick_defender_card`'s eligibility check (raises a new, distinct
     exception message: `'card has reached its use limit for this
     battle'`, versus the existing `'card is currently resting'`)
   - `get_battle`'s `is_resting` computation (see below — becomes
     `is_resting` AND a new `times_used` field, not folded together,
     since the client needs the actual count, not just a boolean)
4. **New permanent-exhaustion loss check in `_start_next_round`**: computed
   only when `v_attacker_avail = 0` or `v_defender_avail = 0` (the existing
   "would skip this round" branch), *before* that skip happens — count
   each side's currently-owned cards where `times_used < _max_card_uses()`
   (ignoring rest entirely). If that count is `0` for the attacker (and
   attacker still owns > 0 cards, i.e. didn't already hit the existing 0-
   owned-cards check above it), finalize the battle with the defender as
   winner; symmetric for the defender. Only if neither side is
   permanently exhausted does the existing skip-the-round path run.
5. **`get_battle`** — both `attacker_roster` and `defender_pool` jsonb
   objects gain a `times_used` integer field (via a scalar subquery on
   `battle_unit_rest`, defaulting to `0` when no row exists yet), alongside
   the existing `is_resting` boolean.

A companion `0015_card_use_limit.verification.sql` (manual, not automated —
matches the project's established convention) documents step-by-step SQL to
run against a scratch/dev Supabase project: fight the same card instance 5
times and confirm a 6th attempt/auto-pick never selects it, confirm
`pick_defender_card` rejects an exhausted card with the new error message,
and confirm a battle where one side's cards are all exhausted resolves
immediately as a loss for that side.

## Client-side changes

- **`lib/battles/api.ts`**: `BattleCard` interface gains `times_used:
  number`, populated straight from `get_battle`'s new field (mirrors how
  `is_resting` is already threaded through).
- **`lib/battles/cardUseLimit.ts`** (new): exports `MAX_CARD_USES_PER_BATTLE
  = 5` and a small `isExhausted(timesUsed: number): boolean` helper, used by
  both `RosterStrip` and the simulator so the "5" only needs to change in
  one TS place if ever tuned.
- **`components/battles/RosterStrip.tsx`**: below each card, alongside the
  existing "odpočívá" label (shown when resting), show `"{times_used}/5
  použití"` badge; disable selection (`clickable` path) when
  `isExhausted(card.times_used)`, matching the existing `is_resting`
  disablement pattern (both conditions combine, not replace each other).
- **`lib/battles/battleProbability.ts`**: `SimCombatant` gains a
  `timesUsed` counter (starts at 0), incremented each time a card is drawn
  into a duel; a card becomes ineligible for the random draw once it hits
  `MAX_CARD_USES_PER_BATTLE` (added to the existing "available" filter
  alongside the rest-cooldown check); a trial now also checks the new
  permanent-exhaustion loss condition (if every one of a side's currently-
  owned cards is exhausted, that side loses the trial immediately) so the
  probability preview matches the real server rules, especially for large
  multi-card battles where exhaustion becomes the deciding factor rather
  than raw stats.

## Testing

- `lib/battles/battleProbability.test.ts`: new cases — a single card
  facing 6+ sequential defeats (or a scenario forcing 5 wins) becomes
  ineligible and the owning side loses once all its cards are exhausted,
  even though the deterministic per-duel stats alone would favor it.
- `components/battles/RosterStrip.test.tsx`: new cases — renders the
  "N/5 použití" badge; disables selection once `times_used >= 5` even when
  `is_resting` is false.
- `supabase/migrations/0015_card_use_limit.verification.sql`: manual
  checklist (not part of the automated Jest suite, consistent with all
  other `.verification.sql` files in this project).
- No changes needed to `lib/cards/combat.ts` (per-duel resolution formula
  is unaffected) or `lib/battles/effectiveStats.ts`.

## Out of scope (explicitly not doing now)

- Rank-dependent use limits (e.g. legendary cards allowed more fights) —
  owner confirmed a single flat limit of 5 for this iteration.
- Any UI change to `DeclareAttackModal`'s pre-battle probability preview
  beyond what the simulator update already provides automatically (no new
  props needed there — the existing `simulateAttackerWinProbability` call
  site keeps working, just returns more accurate numbers).
