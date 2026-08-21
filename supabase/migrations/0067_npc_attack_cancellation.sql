-- 0067_npc_attack_cancellation.sql
--
-- Adds lazy NPC attack reevaluation + cancellation when timely defending
-- reinforcements drop the estimated NPC win chance below 45%.

alter table troop_movements
  add column npc_reeval_at timestamptz;

create index troop_movements_npc_reeval_at_idx
  on troop_movements (npc_reeval_at)
  where status = 'in_transit';

alter table notifications
  drop constraint if exists notifications_type_check;

alter table notifications
  add constraint notifications_type_check check (
    type in (
      'attack_incoming',
      'war_declared',
      'battle_resolved',
      'territory_lost',
      'trade_offer_received',
      'trade_offer_accepted',
      'trade_offer_rejected',
      'peace_offer_received',
      'level_up',
      'dm_message',
      'attack_cancelled'
    )
  );

create or replace function _movement_unit_power(
  p_movement_id uuid,
  p_is_defender boolean,
  p_territory_id integer default null
)
returns numeric
language sql
security definer
set search_path = public
as $$
  with movement_ctx as (
    select p.nation
    from troop_movements tm
    left join players p on p.id = tm.player_id
    where tm.id = p_movement_id
  ),
  territory_ctx as (
    select
      t.castle_rank,
      t.village_rank,
      t.wall_rank
    from territories t
    where t.id = p_territory_id
  )
  select coalesce(sum(e.hp + e.str + e.lng + e.def), 0)
  from troop_movement_units tmu
  join card_instances ci
    on ci.instance_id = tmu.card_instance_id
  join card_templates ct
    on ct.id = ci.template_id
   and ct.category = 'unit'
  cross join movement_ctx ctx
  left join territory_ctx territory on true
  cross join lateral _compute_effective_stats(
    ct.base_stats,
    ct.rank,
    ctx.nation,
    p_is_defender,
    case when p_is_defender then territory.castle_rank else null end,
    case when p_is_defender then territory.village_rank else null end,
    case when p_is_defender then territory.wall_rank else null end
  ) e
  where tmu.movement_id = p_movement_id;
$$;

create or replace function _recall_attack_core(
  p_movement_id uuid,
  p_caller uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement record;
  v_elapsed_hours numeric;
  v_origin_group record;
  v_return_movement_id uuid;
begin
  select * into v_movement from troop_movements where id = p_movement_id for update;
  if not found then
    raise exception 'movement not found';
  end if;
  if v_movement.player_id <> p_caller then
    raise exception 'caller does not own this movement';
  end if;
  if v_movement.kind <> 'attack' then
    raise exception 'only an in-transit attack can be recalled';
  end if;
  if v_movement.status <> 'in_transit' then
    raise exception 'this attack has already arrived and cannot be recalled';
  end if;

  v_elapsed_hours := greatest(0, extract(epoch from (now() - v_movement.started_at)) / 3600.0);

  for v_origin_group in
    select
      coalesce(origin_territory_id, v_movement.origin_territory_id) as origin_territory_id,
      array_agg(card_instance_id order by card_instance_id) as card_instance_ids
    from troop_movement_units
    where movement_id = p_movement_id
    group by coalesce(origin_territory_id, v_movement.origin_territory_id)
  loop
    insert into troop_movements
      (player_id, kind, origin_territory_id, destination_territory_id, started_at, transfer_arrives_at)
    values (
      p_caller,
      'transfer',
      v_movement.destination_territory_id,
      v_origin_group.origin_territory_id,
      now(),
      now() + (v_elapsed_hours || ' hours')::interval
    )
    returning id into v_return_movement_id;

    insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
    select v_return_movement_id, unnest(v_origin_group.card_instance_ids), v_movement.destination_territory_id;
  end loop;

  delete from troop_movement_units where movement_id = p_movement_id;

  update troop_movements
  set status = 'cancelled',
      cancelled_at = now()
  where id = p_movement_id;

  update territories
  set battle_locked_by = null
  where id = v_movement.destination_territory_id and battle_locked_by = p_caller;

  insert into world_events (event_type, payload)
  select
    'attack_recalled',
    jsonb_build_object(
      'attacker_id', p.id,
      'attacker_display_name', p.display_name,
      'attacker_home_x', home.x::integer,
      'attacker_home_y', home.y::integer,
      'territory_id', target.id,
      'territory_x', target.x::integer,
      'territory_y', target.y::integer
    )
  from players p
  left join territories home
    on home.owner_id = p.id
   and home.is_home = true
  join territories target
    on target.id = v_movement.destination_territory_id
  where p.id = p_caller;
end;
$$;

create or replace function recall_attack(p_movement_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
begin
  perform resolve_due_movements();
  perform resolve_due_battles();

  if caller is null then
    raise exception 'not authenticated';
  end if;

  perform _recall_attack_core(p_movement_id, caller);
end;
$$;

create or replace function resolve_due_npc_attack_reevaluations()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement record;
  v_attacker_power numeric;
  v_defender_power numeric;
  v_defender_id uuid;
begin
  for v_movement in
    select
      tm.id,
      tm.player_id,
      tm.destination_territory_id,
      tm.transfer_arrives_at,
      target.owner_id as target_owner_id,
      target.claim_locked_by as target_claim_locked_by,
      target.x as target_x,
      target.y as target_y,
      target.name as target_name,
      attacker.display_name as attacker_display_name
    from troop_movements tm
    join players npc
      on npc.id = tm.player_id
     and npc.is_npc = true
    join territories target
      on target.id = tm.destination_territory_id
    join players attacker
      on attacker.id = tm.player_id
    where tm.kind = 'attack'
      and tm.status = 'in_transit'
      and tm.npc_reeval_at is not null
      and tm.npc_reeval_at <= now()
    order by tm.npc_reeval_at, tm.id
    for update of tm
  loop
    begin
      v_defender_id := coalesce(v_movement.target_owner_id, v_movement.target_claim_locked_by);
      v_attacker_power := _movement_unit_power(v_movement.id, false);

      select
        _territory_effective_unit_power(v_defender_id, v_movement.destination_territory_id, true)
        + coalesce(sum(_movement_unit_power(reinforcement.id, true, v_movement.destination_territory_id)), 0)
      into v_defender_power
      from troop_movements reinforcement
      where reinforcement.kind = 'transfer'
        and reinforcement.status = 'in_transit'
        and reinforcement.player_id = v_defender_id
        and reinforcement.destination_territory_id = v_movement.destination_territory_id
        and reinforcement.transfer_arrives_at <= v_movement.transfer_arrives_at;

      if v_defender_power > (11.0 / 9.0) * v_attacker_power then
        perform _recall_attack_core(v_movement.id, v_movement.player_id);

        if v_defender_id is not null then
          perform _notify(
            v_defender_id,
            'attack_cancelled',
            jsonb_build_object(
              'territory_id', v_movement.destination_territory_id,
              'territory_x', v_movement.target_x::integer,
              'territory_y', v_movement.target_y::integer,
              'territory_name', v_movement.target_name,
              'attacker_display_name', v_movement.attacker_display_name
            )
          );
        end if;
      else
        update troop_movements
        set npc_reeval_at = now() + interval '30 minutes'
        where id = v_movement.id;
      end if;
    exception
      when others then
        raise log 'resolve_due_npc_attack_reevaluations failed for movement % (sqlstate %, error %)', v_movement.id, SQLSTATE, SQLERRM;
    end;
  end loop;
end;
$$;

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
      ) war_opponents
      order by _npc_diplomacy_power(opponent_id) asc, opponent_id
      limit 1;

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

      v_tier_roll := random();

      if (v_adjacent_expansion_target_id is not null or v_adjacent_attack_target_id is not null)
         and v_tier_roll < 0.9 then
        v_expansion_target_id := v_adjacent_expansion_target_id;
        v_expansion_origin_id := v_adjacent_expansion_origin_id;
        v_expansion_card_ids := v_adjacent_expansion_card_ids;
        v_attack_target_id := v_adjacent_attack_target_id;
        v_attack_origin_id := v_adjacent_attack_origin_id;
        v_attack_card_ids := v_adjacent_attack_card_ids;
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
      end if;

      v_pick_roll := random();

      if v_expansion_target_id is not null
         and (v_attack_target_id is null or v_pick_roll < 0.7) then
        perform _start_claim_core(
          v_npc.id,
          v_expansion_origin_id,
          v_expansion_target_id,
          v_expansion_card_ids
        );
      elsif v_attack_target_id is not null then
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

create or replace function resolve_due_movements()
returns void
language plpgsql
security definer
as $$
declare
  arrival record;
  battle_id uuid;
  claim_movement_id uuid;
  target_owner uuid;
  target_claim_locked_by uuid;
  target_is_home boolean;
  target_owner_is_npc boolean;
  target_claim_is_npc boolean;
  arrival_card_instance_ids uuid[];
  occupation_hrs numeric;
  effective_count integer;
  v_completed_claim record;
  v_recall record;
begin
  perform resolve_due_npc_actions();
  perform resolve_due_npc_diplomacy();
  perform resolve_due_npc_attack_reevaluations();

  update card_instances ci
  set stationed_territory_id = tm.destination_territory_id,
      status = 'stationed'
  from troop_movements tm
  where tm.status = 'in_transit'
    and tm.transfer_arrives_at <= now()
    and tm.kind = 'attack'
    and ci.instance_id in (
      select tmu.card_instance_id from troop_movement_units tmu
      where tmu.movement_id = tm.id
    );

  for arrival in
    update troop_movements
    set status = 'completed'
    where status = 'in_transit'
      and transfer_arrives_at <= now()
      and kind = 'attack'
    returning id, player_id, origin_territory_id, destination_territory_id
  loop
    select owner_id, claim_locked_by, is_home
    into target_owner, target_claim_locked_by, target_is_home
    from territories
    where id = arrival.destination_territory_id
    for update;

    select is_npc into target_owner_is_npc
    from players
    where id = target_owner;

    select is_npc into target_claim_is_npc
    from players
    where id = target_claim_locked_by;

    if target_owner is not null and target_owner <> arrival.player_id then
      if coalesce(target_owner_is_npc, false) then
        insert into battles
          (
            territory_id,
            attacker_id,
            defender_id,
            is_home_target,
            movement_id,
            status,
            ready_deadline,
            round_deadline
          )
        values
          (
            arrival.destination_territory_id,
            arrival.player_id,
            target_owner,
            target_is_home,
            arrival.id,
            'active',
            now() + interval '24 hours',
            now()
          )
        returning id into battle_id;
      else
        insert into battles
          (territory_id, attacker_id, defender_id, is_home_target, movement_id, status, ready_deadline)
        values
          (
            arrival.destination_territory_id,
            arrival.player_id,
            target_owner,
            target_is_home,
            arrival.id,
            'awaiting_ready',
            now() + interval '24 hours'
          )
        returning id into battle_id;
      end if;

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      if coalesce(target_owner_is_npc, false) then
        perform _start_next_round(battle_id);
      end if;

      for v_recall in
        select id from troop_movements
        where kind = 'transfer'
          and status = 'in_transit'
          and destination_territory_id = arrival.destination_territory_id
          and player_id = target_owner
      loop
        perform _recall_movement_to_origin(v_recall.id);
      end loop;
    elsif target_owner is null
      and target_claim_locked_by is not null
      and target_claim_locked_by <> arrival.player_id then
      if coalesce(target_claim_is_npc, false) then
        insert into battles
          (
            territory_id,
            attacker_id,
            defender_id,
            is_home_target,
            movement_id,
            status,
            ready_deadline,
            round_deadline
          )
        values
          (
            arrival.destination_territory_id,
            arrival.player_id,
            target_claim_locked_by,
            false,
            arrival.id,
            'active',
            now() + interval '24 hours',
            now()
          )
        returning id into battle_id;
      else
        insert into battles
          (territory_id, attacker_id, defender_id, is_home_target, movement_id, status, ready_deadline)
        values
          (
            arrival.destination_territory_id,
            arrival.player_id,
            target_claim_locked_by,
            false,
            arrival.id,
            'awaiting_ready',
            now() + interval '24 hours'
          )
        returning id into battle_id;
      end if;

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      if coalesce(target_claim_is_npc, false) then
        perform _start_next_round(battle_id);
      end if;

      for v_recall in
        select id from troop_movements
        where kind = 'transfer'
          and status = 'in_transit'
          and destination_territory_id = arrival.destination_territory_id
          and player_id = target_claim_locked_by
      loop
        perform _recall_movement_to_origin(v_recall.id);
      end loop;
    elsif target_owner is null
      and target_claim_locked_by is null
      and exists (
        select 1
        from card_instances ci
        join card_templates ct on ct.id = ci.template_id
        where ci.stationed_territory_id = arrival.destination_territory_id
          and ci.owner_id is null
          and ct.category = 'unit'
      ) then
      insert into battles
        (
          territory_id,
          attacker_id,
          defender_id,
          is_home_target,
          movement_id,
          status,
          ready_deadline,
          round_deadline
        )
      values
        (
          arrival.destination_territory_id,
          arrival.player_id,
          null,
          target_is_home,
          arrival.id,
          'active',
          now() + interval '24 hours',
          now()
        )
      returning id into battle_id;

      insert into battle_attacker_roster (battle_id, card_instance_id)
      select battle_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      perform _start_next_round(battle_id);
    else
      select array_agg(tmu.card_instance_id order by tmu.card_instance_id)
      into arrival_card_instance_ids
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;

      select count(*) into effective_count
      from territories
      where owner_id = arrival.player_id or claim_locked_by = arrival.player_id;
      if effective_count >= 32 then
        raise exception 'territory ownership cap (32) reached';
      end if;

      occupation_hrs := _claim_occupation_hours(
        arrival.player_id,
        arrival.destination_territory_id,
        arrival_card_instance_ids
      );

      update territories
      set claim_locked_by = arrival.player_id,
          claim_started_at = now(),
          claim_transfer_arrives_at = now(),
          claim_occupation_completes_at = now() + (occupation_hrs || ' hours')::interval,
          battle_locked_by = null
      where id = arrival.destination_territory_id;

      insert into troop_movements
        (
          player_id,
          kind,
          origin_territory_id,
          destination_territory_id,
          transfer_arrives_at,
          status
        )
      values
        (
          arrival.player_id,
          'claim',
          arrival.origin_territory_id,
          arrival.destination_territory_id,
          now(),
          'occupying'
        )
      returning id into claim_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id)
      select claim_movement_id, tmu.card_instance_id
      from troop_movement_units tmu
      where tmu.movement_id = arrival.id;
    end if;
  end loop;

  update card_instances ci
  set stationed_territory_id = tm.destination_territory_id,
      status = 'stationed'
  from troop_movements tm
  where tm.status = 'in_transit'
    and tm.transfer_arrives_at <= now()
    and ci.instance_id in (
      select tmu.card_instance_id from troop_movement_units tmu
      where tmu.movement_id = tm.id
    );

  update troop_movements
  set status = 'completed'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'transfer';

  update troop_movements
  set status = 'occupying'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'claim';

  for v_completed_claim in
    update territories
    set owner_id = claim_locked_by,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null
    where claim_occupation_completes_at <= now()
      and claim_locked_by is not null
    returning id, x, y, owner_id
  loop
    perform _award_xp(v_completed_claim.owner_id, 15);

    update troop_movements
    set status = 'completed'
    where kind = 'claim'
      and status = 'occupying'
      and destination_territory_id = v_completed_claim.id;

    insert into world_events (event_type, payload)
    select
      'territory_claimed',
      jsonb_build_object(
        'player_id', p.id,
        'player_display_name', p.display_name,
        'player_home_x', home.x::integer,
        'player_home_y', home.y::integer,
        'territory_id', v_completed_claim.id,
        'territory_x', v_completed_claim.x::integer,
        'territory_y', v_completed_claim.y::integer
      )
    from players p
    left join territories home
      on home.owner_id = p.id
     and home.is_home = true
    where p.id = v_completed_claim.owner_id;
  end loop;

  delete from notifications
  where created_at < now() - interval '30 days';
end;
$$;

revoke execute on function _movement_unit_power(uuid, boolean, integer) from public, anon, authenticated;
grant execute on function _movement_unit_power(uuid, boolean, integer) to service_role;

revoke execute on function _recall_attack_core(uuid, uuid) from public, anon, authenticated;
grant execute on function _recall_attack_core(uuid, uuid) to service_role;

revoke execute on function resolve_due_npc_attack_reevaluations() from public, anon, authenticated;
grant execute on function resolve_due_npc_attack_reevaluations() to service_role;
