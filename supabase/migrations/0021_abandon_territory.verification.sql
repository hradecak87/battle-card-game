-- Manual verification checklist for 0021_abandon_territory.sql
-- Run each block against a live/staging DB.

-- 1. Owner abandons a non-home territory with no garrison, no incoming
--    movements, no unresolved battle:
--    - Call abandon_territory(territory_id) as the owner.
--    - Expect: territories.owner_id becomes null; castle_rank/village_rank
--      (if any) are left unchanged.

-- 2. Same as (1) but the territory has stationed cards owned by the caller:
--    - Expect: a new troop_movements row (kind='transfer', status
--      'in_transit') from territory_id to the caller's home territory,
--      with all garrisoned card_instances flipped to status='in_transit'
--      and referenced via troop_movement_units. Duration matches the
--      normal transfer formula (distance/groupSpeed/nation perk).

-- 3. Caller attempts to abandon their home territory (is_home = true):
--    - Expect: exception 'cannot abandon your home territory'.

-- 4. Caller attempts to abandon a territory they don't own:
--    - Expect: exception 'caller does not own p_territory_id'.

-- 5. Territory has an unresolved battle (status not in resolved/expired):
--    - Expect: exception 'cannot abandon a territory with an unresolved battle'.

-- 6. Territory has an incoming in_transit movement (reinforcement or
--    another transfer) destined for it:
--    - Expect: exception 'cannot abandon a territory with incoming
--      movements — wait for them to arrive or recall them first'.

-- 7. Idempotency / re-entrancy: resolve_due_movements() is called first,
--    so any of the caller's own already-due movements resolve before the
--    ownership/battle checks run (consistent with every other mutating RPC).
