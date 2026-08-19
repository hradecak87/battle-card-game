# Backlog #22 — Surrender mid-battle

## Problem

A battle participant currently has no way to concede a fight already in
progress. They must either keep fighting to the last card or let the
`awaiting_ready` timeout run out (which only applies before combat starts,
not during it). This is a real quality-of-life gap: once it's clear a
side is losing, both players are forced to sit through the remaining
rounds with a predictable outcome.

## Scope

- Surrendering is only available while a battle's `status = 'active'`
  (i.e. combat rounds are actually being fought). The `awaiting_ready`
  phase already has its own well-defined no-show timeout (24h; whichever
  side marked ready wins, or the battle expires if neither did) — adding
  a surrender option there would just duplicate that existing mechanic,
  so it's out of scope here.
- Either participant (attacker or defender) may surrender their own
  battle. Spectators (non-participants) cannot act on a battle they're not
  part of.
- No extra penalty beyond losing the territory/cards already at stake —
  surrendering has the same consequence as losing the battle outright,
  just settled immediately instead of playing out every remaining round.
- The winner receives the same reward as a normal battle win (50 XP + the
  existing independent 1% chance of a structure card), since a surrender
  is still a decisive outcome for them.

## Behavior by role

**Attacker surrenders** → defender wins. Territory ownership is
unaffected (attacker never held it). The attacker's remaining
(not-yet-defeated) cards travel back to the territory the attack
originally departed from, taking the *full* original transfer duration —
identical to today's existing "defender/expired win" cleanup path in
`_finalize_battle`. No change needed here; it already does the right
thing.

**Defender surrenders** → attacker wins and captures the territory
(subject to the existing rules: not the defender's home territory, and
the attacker is under their 32-territory cap — if either blocks capture,
the territory simply stays with the defender and only the battle lock
clears, exactly as today's non-capture path already handles). The
defender's remaining (not-yet-defeated) cards flee to the defender's
**nearest other owned territory** (Chebyshev distance from the battle
territory, home territory included as a normal candidate) rather than
always going home as `_finalize_battle` does today. This is new,
surrender-only behavior:

- Today, `_finalize_battle`'s "send defender cards home" branch is only
  ever reachable via the `awaiting_ready` walkover (defender never showed
  up, so their *entire* untouched garrison needs to go somewhere) — in a
  real fought-out combat win the defender always ends at 0 cards, so nothing
  is left to move. That existing walkover behavior (destination = home)
  is unchanged; it's outside this feature's scope.
- Surrendering mid-battle is the one new case where a defender can have
  a *partial* remaining garrison (some cards already lost/captured in
  earlier rounds, others never used) that needs a destination. Per this
  spec, that destination is the nearest other territory the defender
  owns, not necessarily home.
- Travel time uses the same formula as an ordinary transfer:
  `max(0.25, chebyshev_distance * 0.3)` hours, halved... (no — same 0.3
  multiplier), with the existing Mongol Horde 0.75× perk applied.

## Server changes

New migration `supabase/migrations/0019_battle_surrender.sql`:

1. **`_finalize_battle(p_battle_id uuid, p_winner_side text, p_defender_surrendered boolean default false)`**
   — redefined (latest source: `0011_claim_xp.sql`) to add the new third
   parameter. Every existing call site (`_start_next_round`,
   `resolve_due_battles`) keeps calling it with just two arguments; the
   default `false` preserves their current behavior exactly (destination
   stays "defender's home territory").

   Inside the capture branch, when `p_defender_surrendered` is `true`,
   the destination territory for the defender's fleeing cards is computed
   as:
   ```sql
   select id into v_defender_home_id
   from territories
   where owner_id = v_battle.defender_id
     and id <> v_battle.territory_id
   order by greatest(abs(x - v_from_x), abs(y - v_from_y)) asc
   limit 1;
   ```
   (`v_from_x`/`v_from_y` are the battle territory's own coordinates,
   already computed earlier in the function.) This always resolves to at
   least the defender's home territory, since a defender can only reach
   this surrender path for a non-home territory (home is protected from
   capture, so `v_capture` is false there and this branch never runs) —
   meaning the defender necessarily owns at least one other territory
   (their home) to flee to.

2. **New RPC `surrender_battle(p_movement_id... p_battle_id uuid)`**:
   - Calls `resolve_due_battles()` first (same race-safety convention as
     every other battle RPC).
   - Locks the battle row (`for update`), verifies it exists and
     `status = 'active'` (else raises a clear error — e.g. "battle is not
     currently active and cannot be surrendered").
   - Verifies the caller is `attacker_id` or `defender_id` (else raises
     "caller is not a participant in this battle").
   - If caller is the attacker: `perform _finalize_battle(p_battle_id, 'defender')`.
   - If caller is the defender: `perform _finalize_battle(p_battle_id, 'attacker', true)`.

No changes to `_start_next_round`, `resolve_due_battles`, `mark_ready`, or
any other existing function beyond the `_finalize_battle` signature
addition.

## Client changes

- `lib/battles/api.ts`: new `surrenderBattle(battleId: string)` wrapper
  around `supabase.rpc('surrender_battle', { p_battle_id: battleId })`,
  matching the existing `markReady`/`pickDefenderCard` wrapper style.
- `components/battles/BattleScreen.tsx`:
  - A "Vzdát se" button, shown only when `battle.status === 'active'` and
    the current user is a participant (`isAttacker || isDefender`).
  - Clicking it does not immediately call the RPC — it reveals an inline
    confirmation panel ("Opravdu se chceš vzdát?" with "Ano, vzdát se" /
    "Zrušit" buttons), reusing the same preview-then-confirm interaction
    pattern already used for picking a defender card in this same screen.
    No native `window.confirm()` — this project doesn't use it anywhere
    else.
  - On confirmed surrender, calls `surrenderBattle(battleId)`; on success,
    reloads battle data (which will now show the resolved/expired banner
    that already exists for `resolved`/`expired` status); on error, shows
    the message via the existing `actionError` state.

## Testing

- `MyMovementsPanel`/SQL-adjacent unit tests aren't affected. New/updated
  tests:
  - `components/battles/BattleScreen.test.tsx`: surrender button visibility
    (only for participants, only when `active`), confirm/cancel flow, RPC
    call, and error handling.
- `supabase/migrations/0019_battle_surrender.verification.sql`: manual
  checklist covering attacker-surrenders (cards return to origin, full
  duration, territory unchanged), defender-surrenders (territory captured,
  cards flee to nearest owned territory, not home, correct duration),
  defender-surrenders-when-territory-is-home (blocked — home can't be
  surrendered away, not applicable since defender only ever defends their
  own non-home territories in this scenario... actually N/A, homes aren't
  attacked in the surrenderable sense since is_home_target refers to the
  *defender's* home being attacked, which still permits combat but blocks
  capture on an attacker win; verify defender-surrender-at-home-target still
  correctly skips capture and clears the lock only), non-participant/spectator
  rejected, non-`active` status rejected.
