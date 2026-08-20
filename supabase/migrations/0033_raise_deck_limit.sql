-- Raise the base deck-limit formula per user request:
-- was 80 + 10 per level above 1, now 100 + 20 per level above 1.
-- _deposit_limit derives from _deck_limit (floor(deck_limit / 2)), so it
-- updates automatically with no separate change needed.

create or replace function _deck_limit(p_level integer)
returns integer
language sql
immutable
security definer
set search_path = public
as $$
  select 100 + 20 * (greatest(p_level, 1) - 1);
$$;
