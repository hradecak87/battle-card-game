# Backlog #24 — shorten the `awaiting_ready` battle timeout to 24 hours

## Decision (confirmed with user 2026-08-19)

Shorten the existing `ready_deadline` timeout uniformly, for **all**
`awaiting_ready` battles, from **10 days** to **24 hours**. No new/separate
timeout tier — just change the interval used everywhere `ready_deadline` is
set. The existing 4-outcome resolution logic in `resolve_due_battles()`
(both never readied → no winner/expired; only defender readied → defender
wins; only attacker readied, or both readied but never overlapped online →
attacker wins) is unchanged and already correct — this is purely a duration
change, not a behavior change.

Note: `round_deadline` (the 120-second per-round defender-auto-pick timeout
inside an already-active battle) is a **separate, unrelated** mechanic and
must **not** be touched.

## What to change

`ready_deadline` is set to `now() + interval '10 days'` in **3 places**, all
inside the current (latest) definition of `resolve_due_movements()` in
`supabase/migrations/0011_claim_xp.sql` (lines ~271-338, the 3
`insert into battles (...)` statements for: attacker-vs-player-owned-target,
attacker-vs-claim-locked-target, and attacker-vs-NPC-garrisoned-target). Do
**not** edit `0011_claim_xp.sql` in place (immutable migration history) —
create a new migration that redefines the function.

## Implementation steps

1. Create `supabase/migrations/0016_shorten_ready_deadline.sql`:
   - Header comment explaining the change (backlog #24, shortens the
     `awaiting_ready` timeout from 10 days to 24 hours).
   - `create or replace function resolve_due_movements() ...` — copy the
     **entire** current function body verbatim from `0011_claim_xp.sql`
     (lines ~223 to the end of that function, check where it ends — it's a
     long function, likely continues past line 400; read the whole thing
     first with `view`/`grep` before copying), with the **only** change
     being replacing all 3 occurrences of `interval '10 days'` with
     `interval '24 hours'`. Do not alter anything else in the function.
   - Double-check there isn't a 4th occurrence or a related default
     elsewhere (grep the whole repo for `interval '10 days'` and
     `ready_deadline` before finishing, to make sure nothing was missed —
     e.g. check `0002_territories.sql`'s and `0003_battles.sql`'s own
     versions of `resolve_due_movements()` are correctly superseded, not
     edited).
2. Create `supabase/migrations/0016_shorten_ready_deadline.verification.sql`
   — a short manual checklist (mirror the style of existing
   `*.verification.sql` files in this repo, e.g.
   `0015_card_use_limit.verification.sql`): verify a freshly-created
   `awaiting_ready` battle's `ready_deadline` is ~24 hours out (not 10
   days), and that the 4-outcome `resolve_due_battles()` logic still
   produces the same results as before once `ready_deadline` has passed
   (this part of the logic is untouched, so a light sanity check suffices,
   not a full re-verification of Task 10's 4 sub-cases).
3. Search the whole repo (`grep`) for any other place that references "10
   days"/"10 dní" in relation to this timeout (UI copy, other docs) and
   update if found. (A quick check by the requester found none in
   `components/`/`lib/`, but re-check to be safe — do not assume.)
4. Run targeted Jest tests only if any existing test asserts the specific
   10-day value (grep test files for `'10 days'` or `ready_deadline`); if
   found, update the assertion to 24 hours. Otherwise no test changes
   needed.
5. Do **not** apply the migration to the live Supabase DB and do **not**
   commit/push — leave the new migration files + verification checklist +
   any updated tests staged/unstaged in the working tree for review.
6. Report back: which files were created/changed, confirmation the 3 (or
   however many were actually found) occurrences were updated, and flag
   anything unexpected found during the repo-wide grep in step 3.

## Out of scope

- Do not touch `round_deadline` / the 120-second per-round timeout.
- Do not change the 4-outcome resolution behavior itself.
- Do not add a UI countdown/timer display (not requested).
