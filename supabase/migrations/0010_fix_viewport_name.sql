-- Bugfix: migration 0008_territory_names.sql added the `name` column to
-- `territories`, but `get_viewport` (redefined in 0003_battles.sql with an
-- explicit `returns table (...)` column list, not `setof territories`) was
-- never updated to include it. The map's main tile fetch therefore never
-- returned `name` at all in production, even though the rename RPC and the
-- TypeScript `Territory` type both already assumed it was present — the
-- garrison modal only ever showed a renamed territory's name via an
-- optimistic client-side patch in the same session, and it silently
-- disappeared again on any real refetch (page refresh, pan, revisit).
-- This migration adds `name` to `get_viewport`'s output, matching the
-- column already present on `getMyTerritories`/`get_territory`.
drop function if exists get_viewport(smallint, smallint, smallint, smallint);

create or replace function get_viewport(x1 smallint, y1 smallint, x2 smallint, y2 smallint)
returns table (
  id integer,
  x smallint,
  y smallint,
  difficulty smallint,
  castle_rank text,
  village_rank text,
  owner_id uuid,
  is_home boolean,
  claim_locked_by uuid,
  claim_started_at timestamptz,
  claim_transfer_arrives_at timestamptz,
  claim_occupation_completes_at timestamptz,
  battle_locked_by uuid,
  battle_id uuid,
  name text
)
language plpgsql
as $$
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  return query
    select
      t.id, t.x, t.y, t.difficulty, t.castle_rank, t.village_rank, t.owner_id,
      t.is_home, t.claim_locked_by, t.claim_started_at, t.claim_transfer_arrives_at,
      t.claim_occupation_completes_at, t.battle_locked_by,
      (select b.id from battles b
       where b.territory_id = t.id and b.status not in ('resolved', 'expired')
       limit 1) as battle_id,
      t.name
    from territories t
    where t.x between x1 and x2 and t.y between y1 and y2;
end;
$$;
