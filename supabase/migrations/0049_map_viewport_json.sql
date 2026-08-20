-- Widening the map's zoom range (viewSize up to 48, i.e. 48x48=2304 tiles)
-- would exceed Supabase/PostgREST's default 1000-row response cap on a
-- `returns table (...)` function — a plain row-count of results, which no
-- client-side Range header can bypass since it's enforced server-side. A
-- function returning a single scalar `jsonb` value (one aggregated row
-- instead of one row per territory) sidesteps the row-count cap entirely,
-- since the cap only limits the number of *rows*, not the byte size of a
-- single row's payload — and a 48x48 viewport's worth of territory data is
-- tiny (well under any practical HTTP body-size limit). Same query as
-- before, just wrapped in `jsonb_agg(...)` and returned as one row.
drop function if exists get_viewport(smallint, smallint, smallint, smallint);

create or replace function get_viewport(x1 smallint, y1 smallint, x2 smallint, y2 smallint)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  perform resolve_due_movements();
  perform resolve_due_battles();

  select coalesce(jsonb_agg(row_to_json(sub)), '[]'::jsonb)
  into v_result
  from (
    select
      t.id, t.x, t.y, t.difficulty, t.castle_rank, t.village_rank, t.wall_rank, t.owner_id,
      coalesce(owner_player.is_npc, false) as owner_is_npc,
      owner_player.display_name as owner_display_name,
      t.is_home, t.claim_locked_by, t.claim_started_at, t.claim_transfer_arrives_at,
      t.claim_occupation_completes_at, t.battle_locked_by,
      (select b.id from battles b
       where b.territory_id = t.id and b.status not in ('resolved', 'expired')
       limit 1) as battle_id,
      t.name
    from territories t
    left join players owner_player on owner_player.id = t.owner_id
    where t.x between x1 and x2 and t.y between y1 and y2
  ) sub;

  return v_result;
end;
$$;
