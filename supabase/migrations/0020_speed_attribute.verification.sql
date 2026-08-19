-- Manual verification checklist for 0020_speed_attribute.sql
-- Run each block against a live/staging DB.

-- 1. _min_group_speed returns the MINIMUM speed among the given card
--    instances, not an average:
--      select _min_group_speed(array[<slow-unit-instance-id>, <fast-unit-instance-id>]);
--    Expect: the slower unit's base_stats.speed value.

-- 2. _min_group_speed on a single fast unit (e.g. a lightCavalry card,
--    baseline speed ~9) returns a value close to 9, not the shared
--    baseline of 5.

-- 3. No overload duplication (per the 0019 gotcha — verify even though
--    this migration keeps every existing function signature unchanged):
--      select oid, pronargs from pg_proc
--      where proname in ('_finalize_battle', 'declare_attack',
--        'start_transfer', 'start_claim', '_min_group_speed');
--    Expect exactly one row per function name.

-- 4. A transfer sent with only slow units (e.g. siegeEngines, speed ~2)
--    over 10 tiles takes noticeably LONGER than the old unmodified
--    formula (10 * 0.3 = 3h) — roughly 2.5x longer (5 / 2 = 2.5).

-- 5. The same transfer sent with only fast units (e.g. lightCavalry,
--    speed ~9) over the same distance takes noticeably LESS time —
--    roughly 0.56x (5 / 9).

-- 6. A MIXED-speed group (one fast + one slow unit sent together) uses
--    the SLOWEST unit's speed for the whole group's duration, not an
--    average and not the fastest unit's duration.

-- 7. declare_attack and start_claim show the same slow/fast/mixed
--    behavior as start_transfer (steps 4-6), since all three now share
--    the same _min_group_speed + clamped-multiplier formula.

-- 8. _finalize_battle's two card-movement branches (attacker return trip,
--    defender capture/flee trip) also respect group speed: trigger a
--    battle resolution (walkover, surrender, or fought-out win) with a
--    known garrison composition and confirm the resulting troop_movements
--    row's transfer_arrives_at matches the expected speed-adjusted
--    duration, not the old plain-distance duration.

-- 9. Existing occupation timing (_claim_occupation_hours) and recall
--    timing (_recall_movement_to_origin) are UNCHANGED by this migration
--    — neither reads speed at all.

-- 10. After running scripts/backfill-card-template-speed.ts, spot-check
--     a few rows: `select id, base_stats from card_templates where
--     category = 'unit' limit 5;` — base_stats should still have all
--     original keys (str/lng/def/hp) plus the new speed key, nothing
--     else changed.
