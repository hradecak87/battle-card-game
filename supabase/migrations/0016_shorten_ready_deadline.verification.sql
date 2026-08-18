-- Shorten awaiting_ready battle timeout to 24 hours — manual SQL verification
-- checklist
--
-- Paste into a scratch Supabase SQL editor only after
-- 0016_shorten_ready_deadline.sql is applied. This file is not executed
-- automatically.
--
-- Recommended setup before running the checks below:
--   1. Use the app (or your preferred scratch setup SQL) to create one fresh
--      PvP battle that enters `awaiting_ready`.
--   2. Substitute the placeholder ids below with real values from that scratch
--      battle state.

-- ---------------------------------------------------------------------
-- 1. Freshly created awaiting_ready PvP battles now get a ready_deadline
--    about 24 hours after creation, not 10 days.
-- ---------------------------------------------------------------------
-- Substitute:
--   :battle_id

select
  id,
  status,
  created_at,
  ready_deadline,
  round(extract(epoch from (ready_deadline - created_at)) / 3600.0, 2) as ready_window_hours
from battles
where id = ':battle_id'::uuid;
-- Expect:
--   status = 'awaiting_ready'
--   ready_window_hours is approximately 24 (allow a small difference for the
--   time between insert-time expressions), and definitely not near 240.

-- ---------------------------------------------------------------------
-- 2. Ready-timeout resolution outcomes are unchanged once ready_deadline has
--    passed; only the duration changed.
-- ---------------------------------------------------------------------
-- Light sanity check: re-run one representative expired case and one
-- representative attacker/defender winner case from
-- 0003_battles.verification.sql section 9, but with ready_deadline forced into
-- the past on fresh scratch battles.
--
-- Example A: neither side readied -> expired.
-- Substitute:
--   :expired_battle_id

update battles
set attacker_ready_at = null,
    defender_ready_at = null,
    ready_deadline = now() - interval '1 minute'
where id = ':expired_battle_id'::uuid;

select resolve_due_battles();

select status, winner_side, resolved_at
from battles
where id = ':expired_battle_id'::uuid;
-- Expect: status = 'expired', winner_side is null, resolved_at is not null.

-- Example B: only one side readied -> same winner as before.
-- Substitute:
--   :winner_battle_id
--   :winner_side_expectation   -- 'attacker' or 'defender'

update battles
set attacker_ready_at = case when ':winner_side_expectation' = 'attacker' then now() - interval '2 minutes' else null end,
    defender_ready_at = case when ':winner_side_expectation' = 'defender' then now() - interval '2 minutes' else null end,
    ready_deadline = now() - interval '1 minute'
where id = ':winner_battle_id'::uuid;

select resolve_due_battles();

select status, winner_side, resolved_at
from battles
where id = ':winner_battle_id'::uuid;
-- Expect: status = 'resolved', winner_side matches :winner_side_expectation,
-- and the surrounding territory/card cleanup matches the existing 0003
-- verification cases for that same outcome.
