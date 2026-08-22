-- ---------------------------------------------------------------------------
-- 0078_map_viewport_garrison_pips.sql
--
-- Extends get_viewport(...) with a compact per-rank stationed-unit summary
-- (`garrison_ranks`) for close-zoom ambient map pips, while keeping the
-- existing single-jsonb-row shape that avoids PostgREST's 1000-row cap.
-- ---------------------------------------------------------------------------

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
      t.id,
      t.x,
      t.y,
      t.difficulty,
      t.castle_rank,
      t.village_rank,
      t.wall_rank,
      t.owner_id,
      coalesce(owner_player.is_npc, false) as owner_is_npc,
      owner_player.display_name as owner_display_name,
      t.is_home,
      t.claim_locked_by,
      t.claim_started_at,
      t.claim_transfer_arrives_at,
      t.claim_occupation_completes_at,
      t.battle_locked_by,
      (select b.id from battles b
       where b.territory_id = t.id and b.status not in ('resolved', 'expired')
       limit 1) as battle_id,
      t.name,
      coalesce(garrison.garrison_ranks, '{}'::jsonb) as garrison_ranks
    from territories t
    left join players owner_player on owner_player.id = t.owner_id
    left join lateral (
      select jsonb_object_agg(grouped.rank, grouped.cnt) as garrison_ranks
      from (
        select
          ct.rank,
          count(*)::integer as cnt
        from card_instances ci
        join card_templates ct on ct.id = ci.template_id
        where ci.stationed_territory_id = t.id
          and ci.status = 'stationed'
          and ct.category = 'unit'
        group by ct.rank
      ) grouped
    ) garrison on true
    where t.x between x1 and x2 and t.y between y1 and y2
  ) sub;

  return v_result;
end;
$$;
