-- Fix: "Moje domovské území" (Find Home) button returning
-- "not found" for players whose home tile falls outside PostgREST's
-- default 1000-row response cap.
--
-- Root cause: app/map/page.tsx's handleFindHome() called
-- get_minimap_overview() (which returns every owned/claimed/castle/
-- village tile on the whole 256x256 map — currently 1500+ rows and
-- growing as more territories get claimed) and searched the client-side
-- array for the caller's own tile. Once the total row count exceeds
-- Supabase's default API row limit (1000), the response is silently
-- truncated and a player's home tile can simply be missing from it,
-- even though it exists correctly in the database. Confirmed live via
-- a real authenticated client call: get_minimap_overview() returned
-- exactly 1000 rows out of 1569 total, and the affected player's home
-- tile was not among them.
--
-- Fix: a dedicated, cheap, targeted RPC that looks up only the caller's
-- own home territory directly (indexed lookup on owner_id + is_home),
-- so it can never be affected by the overview's row cap and never
-- requires shipping the whole map to the client just to find one tile.
create or replace function get_my_home_territory()
returns table (
  id integer,
  x smallint,
  y smallint
)
language plpgsql
security invoker
as $$
begin
  return query
    select t.id, t.x, t.y
    from territories t
    where t.owner_id = auth.uid() and t.is_home = true
    limit 1;
end;
$$;
