-- ---------------------------------------------------------------------------
-- 0077_npc_wild_garrison_conquest.sql
--
-- Extends NPC action selection so kingdoms can also conquer unclaimed
-- wild-garrisoned territories (villages/castles) instead of only ignoring
-- them.
-- ---------------------------------------------------------------------------

create or replace function resolve_due_npc_actions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_npc record;
  v_owned_territory_count integer;
  v_adjacent_expansion_target_id integer;
  v_adjacent_expansion_origin_id integer;
  v_adjacent_expansion_card_ids uuid[];
  v_adjacent_attack_target_id integer;
  v_adjacent_attack_origin_id integer;
  v_adjacent_attack_card_ids uuid[];
  v_adjacent_wild_attack_target_id integer;
  v_adjacent_wild_attack_origin_id integer;
  v_adjacent_wild_attack_card_ids uuid[];
  v_focus_enemy_id uuid;
  v_focus_attack_target_id integer;
  v_focus_attack_origin_id integer;
  v_focus_attack_card_ids uuid[];
  v_expansion_target_id integer;
  v_expansion_origin_id integer;
  v_expansion_card_ids uuid[];
  v_attack_target_id integer;
  v_attack_origin_id integer;
  v_attack_card_ids uuid[];
  v_wild_attack_target_id integer;
  v_wild_attack_origin_id integer;
  v_wild_attack_card_ids uuid[];
  v_war_roll numeric;
  v_tier_roll numeric;
  v_pick_roll numeric;
  v_movement_id uuid;
begin
  for v_npc in
    select id
    from players
    where is_npc = true
      and npc_next_action_at is not null
      and npc_next_action_at <= now()
    order by npc_next_action_at, id
    for update
  loop
    v_adjacent_expansion_target_id := null;
    v_adjacent_expansion_origin_id := null;
    v_adjacent_expansion_card_ids := null;
    v_adjacent_attack_target_id := null;
    v_adjacent_attack_origin_id := null;
    v_adjacent_attack_card_ids := null;
    v_adjacent_wild_attack_target_id := null;
    v_adjacent_wild_attack_origin_id := null;
    v_adjacent_wild_attack_card_ids := null;
    v_focus_enemy_id := null;
    v_focus_attack_target_id := null;
    v_focus_attack_origin_id := null;
    v_focus_attack_card_ids := null;
    v_expansion_target_id := null;
    v_expansion_origin_id := null;
    v_expansion_card_ids := null;
    v_attack_target_id := null;
    v_attack_origin_id := null;
    v_attack_card_ids := null;
    v_wild_attack_target_id := null;
    v_wild_attack_origin_id := null;
    v_wild_attack_card_ids := null;

    begin
      select opponent_id
      into v_focus_enemy_id
      from (
        select case
          when r.player_a_id = v_npc.id then r.player_b_id
          else r.player_a_id
        end as opponent_id
        from diplomacy_relations r
        where v_npc.id in (r.player_a_id, r.player_b_id)
          and r.state = 'war'
      ) war_opponents
      order by _npc_diplomacy_power(opponent_id) asc, opponent_id
      limit 1;

      perform _maybe_declare_npc_imperial_war(v_npc.id);

      if v_focus_enemy_id is not null then
        v_war_roll := random();

        if v_war_roll < 0.8 then
          with sampled_targets as (
            select t.id, t.x, t.y
            from territories t
            where t.owner_id = v_focus_enemy_id
              and t.battle_locked_by is null
              and exists (
                select 1
                from (values (t.x - 1, t.y), (t.x + 1, t.y),
                             (t.x, t.y - 1), (t.x, t.y + 1)) as n(nx, ny)
                left join territories t2 on t2.x = n.nx and t2.y = n.ny
                where t2.id is null or t2.owner_id is distinct from t.owner_id
              )
            order by random()
            limit 200
          )
          select candidate.target_id, candidate.origin_id, candidate.card_ids
          into v_focus_attack_target_id, v_focus_attack_origin_id, v_focus_attack_card_ids
          from (
            select
              t.id as target_id,
              origin.id as origin_id,
              origin.card_ids
            from sampled_targets t
            join lateral (
              select
                o.id,
                array_agg(ci.instance_id order by ci.instance_id) as card_ids,
                _territory_effective_unit_power(v_npc.id, o.id, false) as attack_power
              from territories o
              join card_instances ci
                on ci.stationed_territory_id = o.id
               and ci.owner_id = v_npc.id
               and ci.status = 'stationed'
              join card_templates ct
                on ct.id = ci.template_id
               and ct.category = 'unit'
              where o.owner_id = v_npc.id
              group by o.id, o.x, o.y
              order by greatest(abs(o.x - t.x), abs(o.y - t.y)) asc, o.id
              limit 1
            ) origin on true
            where origin.attack_power >=
              _territory_effective_unit_power(v_focus_enemy_id, t.id, true) * 1.2
            order by random()
            limit 1
          ) candidate;

          if v_focus_attack_target_id is not null then
            select _declare_attack_core(
              v_npc.id,
              v_focus_attack_target_id,
              jsonb_build_array(
                jsonb_build_object(
                  'origin_territory_id', v_focus_attack_origin_id,
                  'card_instance_ids', to_jsonb(v_focus_attack_card_ids)
                )
              ),
              null
            ) into v_movement_id;

            update troop_movements
            set npc_reeval_at = now() + interval '30 minutes'
            where id = v_movement_id;

            update players
            set npc_next_action_at = now() + (4 + random() * 8) * interval '1 hour'
            where id = v_npc.id;

            continue;
          end if;
        end if;
      end if;

      select count(*) into v_owned_territory_count
      from territories
      where owner_id = v_npc.id;

      if v_owned_territory_count < 32 then
        with adjacent_origin_pairs as (
          select
            target.id as target_id,
            o.id as origin_id,
            array_agg(ci.instance_id order by ci.instance_id) as card_ids
          from territories o
          join card_instances ci
            on ci.stationed_territory_id = o.id
           and ci.owner_id = v_npc.id
           and ci.status = 'stationed'
          join card_templates ct
            on ct.id = ci.template_id
           and ct.category = 'unit'
          cross join lateral (
            values (o.x - 1, o.y), (o.x + 1, o.y), (o.x, o.y - 1), (o.x, o.y + 1)
          ) as n(nx, ny)
          join territories target
            on target.x = n.nx
           and target.y = n.ny
          where o.owner_id = v_npc.id
            and target.owner_id is null
            and target.claim_locked_by is null
            and target.battle_locked_by is null
            and not exists (
              select 1
              from card_instances ci2
              join card_templates ct2 on ct2.id = ci2.template_id
              where ci2.stationed_territory_id = target.id
                and ci2.owner_id is null
                and ct2.category = 'unit'
            )
          group by target.id, o.id
        ),
        adjacent_targets as (
          select distinct on (target_id)
            target_id,
            origin_id,
            card_ids
          from adjacent_origin_pairs
          order by target_id, origin_id
        )
        select target_id, origin_id, card_ids
        into v_adjacent_expansion_target_id, v_adjacent_expansion_origin_id, v_adjacent_expansion_card_ids
        from adjacent_targets
        order by random()
        limit 1;
      end if;

      with adjacent_origin_pairs as (
        select
          target.id as target_id,
          target.owner_id as target_owner_id,
          target.claim_locked_by as target_claim_locked_by,
          o.id as origin_id,
          array_agg(ci.instance_id order by ci.instance_id) as card_ids,
          _territory_effective_unit_power(v_npc.id, o.id, false) as attack_power
        from territories o
        join card_instances ci
          on ci.stationed_territory_id = o.id
         and ci.owner_id = v_npc.id
         and ci.status = 'stationed'
        join card_templates ct
          on ct.id = ci.template_id
         and ct.category = 'unit'
        cross join lateral (
          values (o.x - 1, o.y), (o.x + 1, o.y), (o.x, o.y - 1), (o.x, o.y + 1)
        ) as n(nx, ny)
        join territories target
          on target.x = n.nx
         and target.y = n.ny
        where o.owner_id = v_npc.id
          and target.battle_locked_by is null
          and (
            (target.owner_id is not null and target.owner_id <> v_npc.id)
            or (target.owner_id is null and target.claim_locked_by is not null and target.claim_locked_by <> v_npc.id)
          )
        group by target.id, target.owner_id, target.claim_locked_by, o.id
      ),
      eligible_adjacent_targets as (
        select distinct on (target_id)
          target_id,
          origin_id,
          card_ids
        from adjacent_origin_pairs
        where attack_power >=
          _territory_effective_unit_power(
            case when target_owner_id is not null then target_owner_id else target_claim_locked_by end,
            target_id,
            true
          ) * 1.2
        order by target_id, attack_power desc, origin_id
      )
      select target_id, origin_id, card_ids
      into v_adjacent_attack_target_id, v_adjacent_attack_origin_id, v_adjacent_attack_card_ids
      from eligible_adjacent_targets
      order by random()
      limit 1;

      with adjacent_origin_pairs as (
        select
          target.id as target_id,
          o.id as origin_id,
          array_agg(ci.instance_id order by ci.instance_id) as card_ids,
          _territory_effective_unit_power(v_npc.id, o.id, false) as attack_power
        from territories o
        join card_instances ci
          on ci.stationed_territory_id = o.id
         and ci.owner_id = v_npc.id
         and ci.status = 'stationed'
        join card_templates ct
          on ct.id = ci.template_id
         and ct.category = 'unit'
        cross join lateral (
          values (o.x - 1, o.y), (o.x + 1, o.y), (o.x, o.y - 1), (o.x, o.y + 1)
        ) as n(nx, ny)
        join territories target
          on target.x = n.nx
         and target.y = n.ny
        where o.owner_id = v_npc.id
          and target.owner_id is null
          and target.claim_locked_by is null
          and target.battle_locked_by is null
          and exists (
            select 1
            from card_instances ci2
            join card_templates ct2 on ct2.id = ci2.template_id
            where ci2.stationed_territory_id = target.id
              and ci2.owner_id is null
              and ct2.category = 'unit'
          )
        group by target.id, o.id
      ),
      eligible_adjacent_targets as (
        select distinct on (target_id)
          target_id,
          origin_id,
          card_ids
        from adjacent_origin_pairs
        where attack_power >=
          _territory_effective_unit_power(
            null,
            target_id,
            true
          ) * 1.2
        order by target_id, attack_power desc, origin_id
      )
      select target_id, origin_id, card_ids
      into v_adjacent_wild_attack_target_id, v_adjacent_wild_attack_origin_id, v_adjacent_wild_attack_card_ids
      from eligible_adjacent_targets
      order by random()
      limit 1;

      v_tier_roll := random();

      if (
           v_adjacent_expansion_target_id is not null
        or v_adjacent_attack_target_id is not null
        or v_adjacent_wild_attack_target_id is not null
      )
         and v_tier_roll < 0.9 then
        v_expansion_target_id := v_adjacent_expansion_target_id;
        v_expansion_origin_id := v_adjacent_expansion_origin_id;
        v_expansion_card_ids := v_adjacent_expansion_card_ids;
        v_attack_target_id := v_adjacent_attack_target_id;
        v_attack_origin_id := v_adjacent_attack_origin_id;
        v_attack_card_ids := v_adjacent_attack_card_ids;
        v_wild_attack_target_id := v_adjacent_wild_attack_target_id;
        v_wild_attack_origin_id := v_adjacent_wild_attack_origin_id;
        v_wild_attack_card_ids := v_adjacent_wild_attack_card_ids;
      else
        -- NOTE: expansion/attack candidate search is deliberately bounded to a
        -- random 200-row sample of the *base* filter conditions before the
        -- expensive per-candidate lateral join (nearest-origin distance sort,
        -- `_territory_effective_unit_power(...)`) runs — without this bound,
        -- the lateral join was evaluated once per matching territory across
        -- the full 256x256 map (tens of thousands of rows), which took ~65s
        -- per tick and made every RPC calling resolve_due_movements() (i.e.
        -- almost every RPC in the app, including the map) time out with a
        -- Postgres statement-timeout 500 once real NPC ticks started firing.
        if v_owned_territory_count < 32 then
          with sampled_targets as (
            select t.id, t.x, t.y
            from territories t
            where t.owner_id is null
              and t.claim_locked_by is null
              and t.battle_locked_by is null
              and not exists (
                select 1
                from card_instances ci
                join card_templates ct on ct.id = ci.template_id
                where ci.stationed_territory_id = t.id
                  and ci.owner_id is null
                  and ct.category = 'unit'
              )
            order by random()
            limit 200
          )
          select candidate.target_id, candidate.origin_id, candidate.card_ids
          into v_expansion_target_id, v_expansion_origin_id, v_expansion_card_ids
          from (
            select
              t.id as target_id,
              origin.id as origin_id,
              origin.card_ids
            from sampled_targets t
            join lateral (
              select
                o.id,
                array_agg(ci.instance_id order by ci.instance_id) as card_ids
              from territories o
              join card_instances ci
                on ci.stationed_territory_id = o.id
               and ci.owner_id = v_npc.id
               and ci.status = 'stationed'
              join card_templates ct
                on ct.id = ci.template_id
               and ct.category = 'unit'
              where o.owner_id = v_npc.id
              group by o.id, o.x, o.y
              order by greatest(abs(o.x - t.x), abs(o.y - t.y)) asc, o.id
              limit 1
            ) origin on true
            order by random()
            limit 1
          ) candidate;
        end if;

        with sampled_targets as (
          select t.id, t.x, t.y, t.owner_id, t.claim_locked_by
          from territories t
          where t.battle_locked_by is null
            and (
              (t.owner_id is not null and t.owner_id <> v_npc.id)
              or (t.owner_id is null and t.claim_locked_by is not null and t.claim_locked_by <> v_npc.id)
            )
            and (
              t.owner_id is null
              or exists (
                select 1
                from (values (t.x - 1, t.y), (t.x + 1, t.y),
                             (t.x, t.y - 1), (t.x, t.y + 1)) as n(nx, ny)
                left join territories t2 on t2.x = n.nx and t2.y = n.ny
                where t2.id is null or t2.owner_id is distinct from t.owner_id
              )
            )
          order by random()
          limit 200
        )
        select candidate.target_id, candidate.origin_id, candidate.card_ids
        into v_attack_target_id, v_attack_origin_id, v_attack_card_ids
        from (
          select
            t.id as target_id,
            origin.id as origin_id,
            origin.card_ids
          from sampled_targets t
          join lateral (
            select
              o.id,
              array_agg(ci.instance_id order by ci.instance_id) as card_ids,
              _territory_effective_unit_power(v_npc.id, o.id, false) as attack_power
            from territories o
            join card_instances ci
              on ci.stationed_territory_id = o.id
             and ci.owner_id = v_npc.id
             and ci.status = 'stationed'
            join card_templates ct
              on ct.id = ci.template_id
             and ct.category = 'unit'
            where o.owner_id = v_npc.id
            group by o.id, o.x, o.y
            order by greatest(abs(o.x - t.x), abs(o.y - t.y)) asc, o.id
            limit 1
          ) origin on true
          where origin.attack_power >=
            _territory_effective_unit_power(
              case when t.owner_id is not null then t.owner_id else t.claim_locked_by end,
              t.id,
              true
            ) * 1.2
          order by random()
          limit 1
        ) candidate;

        with sampled_targets as (
          select t.id, t.x, t.y
          from territories t
          where t.owner_id is null
            and t.claim_locked_by is null
            and t.battle_locked_by is null
            and exists (
              select 1
              from card_instances ci
              join card_templates ct on ct.id = ci.template_id
              where ci.stationed_territory_id = t.id
                and ci.owner_id is null
                and ct.category = 'unit'
            )
          order by random()
          limit 200
        )
        select candidate.target_id, candidate.origin_id, candidate.card_ids
        into v_wild_attack_target_id, v_wild_attack_origin_id, v_wild_attack_card_ids
        from (
          select
            t.id as target_id,
            origin.id as origin_id,
            origin.card_ids
          from sampled_targets t
          join lateral (
            select
              o.id,
              array_agg(ci.instance_id order by ci.instance_id) as card_ids,
              _territory_effective_unit_power(v_npc.id, o.id, false) as attack_power
            from territories o
            join card_instances ci
              on ci.stationed_territory_id = o.id
             and ci.owner_id = v_npc.id
             and ci.status = 'stationed'
            join card_templates ct
              on ct.id = ci.template_id
             and ct.category = 'unit'
            where o.owner_id = v_npc.id
            group by o.id, o.x, o.y
            order by greatest(abs(o.x - t.x), abs(o.y - t.y)) asc, o.id
            limit 1
          ) origin on true
          where origin.attack_power >=
            _territory_effective_unit_power(
              null,
              t.id,
              true
            ) * 1.2
          order by random()
          limit 1
        ) candidate;
      end if;

      v_pick_roll := random();

      if v_expansion_target_id is not null
         and (
           (v_attack_target_id is null and v_wild_attack_target_id is null)
           or v_pick_roll < 0.7
         ) then
        perform _start_claim_core(
          v_npc.id,
          v_expansion_origin_id,
          v_expansion_target_id,
          v_expansion_card_ids
        );
      elsif v_attack_target_id is not null
         and (
           v_wild_attack_target_id is null
           or (v_expansion_target_id is not null and v_pick_roll < 0.85)
           or (v_expansion_target_id is null and v_pick_roll < 0.5)
         ) then
        select _declare_attack_core(
          v_npc.id,
          v_attack_target_id,
          jsonb_build_array(
            jsonb_build_object(
              'origin_territory_id', v_attack_origin_id,
              'card_instance_ids', to_jsonb(v_attack_card_ids)
            )
          ),
          null
        ) into v_movement_id;

        update troop_movements
        set npc_reeval_at = now() + interval '30 minutes'
        where id = v_movement_id;
      elsif v_wild_attack_target_id is not null then
        select _declare_attack_core(
          v_npc.id,
          v_wild_attack_target_id,
          jsonb_build_array(
            jsonb_build_object(
              'origin_territory_id', v_wild_attack_origin_id,
              'card_instance_ids', to_jsonb(v_wild_attack_card_ids)
            )
          ),
          null
        ) into v_movement_id;

        update troop_movements
        set npc_reeval_at = now() + interval '30 minutes'
        where id = v_movement_id;
      end if;
    exception
      when others then
        raise log 'resolve_due_npc_actions failed for NPC % (sqlstate %, error %)', v_npc.id, SQLSTATE, SQLERRM;
    end;

    update players
    set npc_next_action_at = now() + (4 + random() * 8) * interval '1 hour'
    where id = v_npc.id;
  end loop;
end;
$$;

revoke execute on function resolve_due_npc_actions() from public, anon, authenticated;
grant execute on function resolve_due_npc_actions() to service_role;
