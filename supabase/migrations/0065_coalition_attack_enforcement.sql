-- 0065_coalition_attack_enforcement.sql
--
-- Adds coalition/non-aggression guardrails to the shared hostile action
-- core functions. Grepping the migrations history confirms hostile
-- transfers do not use a separate code path: start_transfer() only allows
-- caller-owned destinations and instructs hostile moves to use start_claim /
-- declare_attack, so no third guard target is needed here.

CREATE OR REPLACE FUNCTION public._declare_attack_core(p_caller uuid, target_territory_id integer, origin_groups jsonb, p_boost_card_instance_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_nation nation_id;
  target_x smallint; target_y smallint;
  target_owner uuid;
  target_claim_locked_by uuid;
  target_battle_locked_by uuid;
  target_is_home boolean;
  target_is_empty_claimable boolean;
  target_owner_is_npc boolean := false;
  active_claim_count integer;
  effective_count integer;
  matching_count integer;
  origin_group jsonb;
  origin_territory_ids integer[] := '{}'::integer[];
  all_card_instance_ids uuid[] := '{}'::uuid[];
  group_card_instance_ids uuid[];
  origin_territory_id integer;
  origin_x smallint;
  origin_y smallint;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  contingent_transfer_hrs numeric;
  max_transfer_hrs numeric := 0;
  primary_origin_territory_id integer;
  arrives_at timestamptz;
  movement_id uuid;
  v_boost_origin integer;
  v_war_relation_created boolean := false;
begin
  if origin_groups is null or jsonb_typeof(origin_groups) <> 'array' or jsonb_array_length(origin_groups) = 0 then
    raise exception 'origin_groups must be a non-empty array';
  end if;

  if p_boost_card_instance_id is not null then
    select stationed_territory_id into v_boost_origin
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = p_boost_card_instance_id
      and ci.owner_id = p_caller
      and ci.status = 'stationed'
      and ct.category = 'boost'
      and ct.boost_type = 'offensive';

    if not found or not exists (
      select 1
      from jsonb_array_elements(origin_groups) item
      where (item->>'origin_territory_id')::integer = v_boost_origin
    ) then
      raise exception 'selected boost card is not stationed at one of the chosen origin territories';
    end if;
  end if;

  select nation into caller_nation from players where id = p_caller;

  select x, y, owner_id, claim_locked_by, battle_locked_by, is_home
  into target_x, target_y, target_owner, target_claim_locked_by, target_battle_locked_by, target_is_home
  from territories where id = target_territory_id;
  if not found then
    raise exception 'target territory is not available to attack';
  end if;

  if target_owner is not null
     and target_owner <> p_caller
     and (
       exists (
         select 1
         from coalition_members cm_self
         join coalition_members cm_target
           on cm_target.coalition_id = cm_self.coalition_id
         join coalitions c
           on c.id = cm_self.coalition_id
         where cm_self.player_id = p_caller
           and cm_target.player_id = target_owner
           and c.disbanded_at is null
       )
       or exists (
         select 1
         from diplomacy_relations dr
         where dr.player_a_id = least(p_caller, target_owner)
           and dr.player_b_id = greatest(p_caller, target_owner)
           and dr.state = 'non_aggression'
       )
     ) then
    raise exception 'cannot attack/claim: target is a coalition member or under a non-aggression pact';
  end if;

  for origin_group in select value from jsonb_array_elements(origin_groups)
  loop
    if jsonb_typeof(origin_group) <> 'object' then
      raise exception 'each origin_groups item must be an object';
    end if;

    origin_territory_id := (origin_group->>'origin_territory_id')::integer;
    if origin_territory_id is null then
      raise exception 'origin_territory_id is required for every origin group';
    end if;
    if origin_territory_id = any(origin_territory_ids) then
      raise exception 'origin_territory_id % is duplicated in origin_groups', origin_territory_id;
    end if;

    select coalesce(array_agg(card_id), '{}'::uuid[])
    into group_card_instance_ids
    from (
      select jsonb_array_elements_text(coalesce(origin_group->'card_instance_ids', '[]'::jsonb))::uuid as card_id
    ) as ids;
    if array_length(group_card_instance_ids, 1) is null then
      raise exception 'each origin group must include at least one card_instance_id';
    end if;

    select count(*) into matching_count
    from (select distinct card_id from unnest(group_card_instance_ids) as card_id) distinct_ids;
    if matching_count <> array_length(group_card_instance_ids, 1) then
      raise exception 'card_instance_ids within one origin group must be unique';
    end if;

    if exists (
      select 1
      from unnest(group_card_instance_ids) as card_id
      where card_id = any(all_card_instance_ids)
    ) then
      raise exception 'the same card_instance_id cannot be sent from multiple origins';
    end if;

    select x, y into origin_x, origin_y
    from territories where id = origin_territory_id and owner_id = p_caller;
    if not found then
      raise exception 'caller does not own origin_territory_id %', origin_territory_id;
    end if;

    select count(*) into matching_count
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = any(group_card_instance_ids)
      and ci.owner_id = p_caller
      and ci.stationed_territory_id = origin_territory_id
      and ci.status = 'stationed'
      and ct.category = 'unit';
    if matching_count <> array_length(group_card_instance_ids, 1) then
      raise exception 'one or more card instances are not eligible to send';
    end if;

    distance := greatest(abs(target_x - origin_x), abs(target_y - origin_y));
    group_speed := _min_group_speed(group_card_instance_ids);
    speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
    contingent_transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
      * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);

    if primary_origin_territory_id is null or contingent_transfer_hrs > max_transfer_hrs then
      max_transfer_hrs := contingent_transfer_hrs;
      primary_origin_territory_id := origin_territory_id;
    end if;

    origin_territory_ids := array_append(origin_territory_ids, origin_territory_id);
    all_card_instance_ids := all_card_instance_ids || group_card_instance_ids;
  end loop;

  if target_owner = p_caller or target_claim_locked_by = p_caller then
    raise exception 'caller cannot attack their own owned/claimed territory';
  end if;
  if target_battle_locked_by is not null then
    raise exception 'target territory already has a battle in progress';
  end if;

  if target_owner is not null and not exists (
    select 1
    from (values (target_x - 1, target_y), (target_x + 1, target_y),
                 (target_x, target_y - 1), (target_x, target_y + 1)) as n(nx, ny)
    left join territories t2 on t2.x = n.nx and t2.y = n.ny
    where t2.id is null or t2.owner_id is distinct from target_owner
  ) then
    raise exception 'target territory is surrounded by owner''s own territory and cannot be attacked directly';
  end if;

  if not target_is_home then
    select count(*) into effective_count
    from territories where owner_id = p_caller or claim_locked_by = p_caller;
    if effective_count >= 32 then
      raise exception 'territory ownership cap (32) reached';
    end if;
  end if;

  target_is_empty_claimable := target_owner is null and target_claim_locked_by is null
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = target_territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
    );
  if target_is_empty_claimable then
    select count(*) into active_claim_count
    from territories where claim_locked_by = p_caller and owner_id is null;
    if active_claim_count >= 5 then
      raise exception 'concurrent claim limit (5) reached — wait for an in-progress claim to complete or cancel one first';
    end if;
  end if;

  select x, y, owner_id, claim_locked_by, battle_locked_by, is_home
  into target_x, target_y, target_owner, target_claim_locked_by, target_battle_locked_by, target_is_home
  from territories
  where id = target_territory_id
  for update;
  if not found then
    raise exception 'target territory is not available to attack';
  end if;
  if target_owner = p_caller or target_claim_locked_by = p_caller then
    raise exception 'caller cannot attack their own owned/claimed territory';
  end if;
  if target_battle_locked_by is not null then
    raise exception 'target territory already has a battle in progress';
  end if;

  if target_owner is not null and not exists (
    select 1
    from (values (target_x - 1, target_y), (target_x + 1, target_y),
                 (target_x, target_y - 1), (target_x, target_y + 1)) as n(nx, ny)
    left join territories t2 on t2.x = n.nx and t2.y = n.ny
    where t2.id is null or t2.owner_id is distinct from target_owner
  ) then
    raise exception 'target territory is surrounded by owner''s own territory and cannot be attacked directly';
  end if;

  if not target_is_home then
    select count(*) into effective_count
    from territories where owner_id = p_caller or claim_locked_by = p_caller;
    if effective_count >= 32 then
      raise exception 'territory ownership cap (32) reached';
    end if;
  end if;

  target_is_empty_claimable := target_owner is null and target_claim_locked_by is null
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = target_territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
    );
  if target_is_empty_claimable then
    select count(*) into active_claim_count
    from territories where claim_locked_by = p_caller and owner_id is null;
    if active_claim_count >= 5 then
      raise exception 'concurrent claim limit (5) reached — wait for an in-progress claim to complete or cancel one first';
    end if;
  end if;

  for origin_group in select value from jsonb_array_elements(origin_groups)
  loop
    origin_territory_id := (origin_group->>'origin_territory_id')::integer;
    select coalesce(array_agg(card_id), '{}'::uuid[])
    into group_card_instance_ids
    from (
      select jsonb_array_elements_text(coalesce(origin_group->'card_instance_ids', '[]'::jsonb))::uuid as card_id
    ) as ids;

    select count(*) into matching_count
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = any(group_card_instance_ids)
      and ci.owner_id = p_caller
      and ci.stationed_territory_id = origin_territory_id
      and ci.status = 'stationed'
      and ct.category = 'unit';
    if matching_count <> array_length(group_card_instance_ids, 1) then
      raise exception 'one or more card instances are not eligible to send';
    end if;

    perform ci.instance_id
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = any(group_card_instance_ids)
      and ci.owner_id = p_caller
      and ci.stationed_territory_id = origin_territory_id
      and ci.status = 'stationed'
      and ct.category = 'unit'
    for update;
  end loop;

  if target_owner is not null and target_owner <> p_caller then
    select coalesce(is_npc, false)
    into target_owner_is_npc
    from players
    where id = target_owner;
  end if;

  arrives_at := now() + (max_transfer_hrs || ' hours')::interval;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (p_caller, 'attack', primary_origin_territory_id, target_territory_id, arrives_at)
  returning id into movement_id;

  for origin_group in select value from jsonb_array_elements(origin_groups)
  loop
    origin_territory_id := (origin_group->>'origin_territory_id')::integer;
    select coalesce(array_agg(card_id), '{}'::uuid[])
    into group_card_instance_ids
    from (
      select jsonb_array_elements_text(coalesce(origin_group->'card_instance_ids', '[]'::jsonb))::uuid as card_id
    ) as ids;

    insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
    select movement_id, unnest(group_card_instance_ids), origin_territory_id;
  end loop;

  update card_instances
  set status = 'in_transit'
  where instance_id = any(all_card_instance_ids);

  update territories
  set battle_locked_by = p_caller
  where id = target_territory_id;

  if p_boost_card_instance_id is not null then
    update troop_movements
    set boost_card_instance_id = p_boost_card_instance_id
    where id = movement_id;

    update card_instances
    set status = 'in_transit'
    where instance_id = p_boost_card_instance_id;
  end if;

  if target_owner is not null and target_owner <> p_caller and not target_owner_is_npc then
    insert into diplomacy_relations (
      player_a_id,
      player_b_id,
      state,
      war_started_at
    )
    values (
      least(p_caller, target_owner),
      greatest(p_caller, target_owner),
      'war',
      now()
    )
    on conflict (player_a_id, player_b_id) do nothing;

    v_war_relation_created := found;

    if v_war_relation_created then
      insert into world_events (event_type, payload)
      select
        'war_declared',
        jsonb_build_object(
          'attacker_id', attacker.id,
          'attacker_display_name', attacker.display_name,
          'attacker_home_x', attacker_home.x::integer,
          'attacker_home_y', attacker_home.y::integer,
          'defender_id', defender.id,
          'defender_display_name', defender.display_name,
          'defender_home_x', defender_home.x::integer,
          'defender_home_y', defender_home.y::integer
        )
      from players attacker
      left join territories attacker_home
        on attacker_home.owner_id = attacker.id
       and attacker_home.is_home = true
      join players defender
        on defender.id = target_owner
      left join territories defender_home
        on defender_home.owner_id = defender.id
       and defender_home.is_home = true
      where attacker.id = p_caller;

      perform _notify(
        p_caller,
        'war_declared',
        (
          select jsonb_build_object(
            'other_player_id', defender.id,
            'other_display_name', defender.display_name
          )
          from players defender
          where defender.id = target_owner
        )
      );

      perform _notify(
        target_owner,
        'war_declared',
        (
          select jsonb_build_object(
            'other_player_id', attacker.id,
            'other_display_name', attacker.display_name
          )
          from players attacker
          where attacker.id = p_caller
        )
      );
    end if;
  end if;

  insert into world_events (event_type, payload)
  select
    'attack_declared',
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
    on target.id = target_territory_id
  where p.id = p_caller;

  if target_owner is not null and target_owner <> p_caller and not target_owner_is_npc then
    perform _notify(
      target_owner,
      'attack_incoming',
      (
        select jsonb_build_object(
          'territory_id', target.id,
          'x', target.x::integer,
          'y', target.y::integer,
          'other_player_id', attacker.id,
          'other_display_name', attacker.display_name
        )
        from territories target
        join players attacker
          on attacker.id = p_caller
        where target.id = target_territory_id
      )
    );
  end if;

  return movement_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public._start_claim_core(p_caller uuid, origin_territory_id integer, destination_territory_id integer, card_instance_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_nation nation_id;
  origin_x smallint; origin_y smallint;
  dest_x smallint; dest_y smallint;
  dest_difficulty smallint;
  dest_owner uuid; dest_locked_by uuid; dest_battle_locked_by uuid;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  transfer_hrs numeric;
  occupation_hrs numeric;
  effective_count integer;
  active_claim_count integer;
  matching_count integer;
  arrives_at timestamptz;
  occupies_at timestamptz;
  movement_id uuid;
begin
  if card_instance_ids is null or array_length(card_instance_ids, 1) is null then
    raise exception 'card_instance_ids must be non-empty';
  end if;

  select nation into caller_nation from players where id = p_caller;

  select x, y into origin_x, origin_y
  from territories where id = origin_territory_id and owner_id = p_caller;
  if not found then
    raise exception 'caller does not own origin_territory_id';
  end if;

  select x, y, difficulty, owner_id, claim_locked_by, battle_locked_by
  into dest_x, dest_y, dest_difficulty, dest_owner, dest_locked_by, dest_battle_locked_by
  from territories where id = destination_territory_id;

  if dest_owner is not null
     and dest_owner <> p_caller
     and (
       exists (
         select 1
         from coalition_members cm_self
         join coalition_members cm_target
           on cm_target.coalition_id = cm_self.coalition_id
         join coalitions c
           on c.id = cm_self.coalition_id
         where cm_self.player_id = p_caller
           and cm_target.player_id = dest_owner
           and c.disbanded_at is null
       )
       or exists (
         select 1
         from diplomacy_relations dr
         where dr.player_a_id = least(p_caller, dest_owner)
           and dr.player_b_id = greatest(p_caller, dest_owner)
           and dr.state = 'non_aggression'
       )
     ) then
    raise exception 'cannot attack/claim: target is a coalition member or under a non-aggression pact';
  end if;

  if dest_owner is not null or dest_locked_by is not null or dest_battle_locked_by is not null then
    raise exception 'destination territory is not available to claim';
  end if;
  if exists (
    select 1
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = destination_territory_id
      and ci.owner_id is null
      and ct.category = 'unit'
  ) then
    raise exception 'destination territory is not available to claim';
  end if;

  select count(*) into active_claim_count
  from territories where claim_locked_by = p_caller and owner_id is null;
  if active_claim_count >= 5 then
    raise exception 'concurrent claim limit (5) reached — wait for an in-progress claim to complete or cancel one first';
  end if;

  select count(*) into effective_count
  from territories where owner_id = p_caller or claim_locked_by = p_caller;
  if effective_count >= 32 then
    raise exception 'territory ownership cap (32) reached';
  end if;

  select count(*) into matching_count
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = any(card_instance_ids)
    and ci.owner_id = p_caller
    and ci.stationed_territory_id = origin_territory_id
    and ci.status = 'stationed'
    and ct.category = 'unit';
  if matching_count <> array_length(card_instance_ids, 1) then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  distance := greatest(abs(dest_x - origin_x), abs(dest_y - origin_y));

  group_speed := _min_group_speed(card_instance_ids);
  speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
  transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);
  occupation_hrs := _claim_occupation_hours(p_caller, destination_territory_id, card_instance_ids);

  perform id from territories
  where id = destination_territory_id
    and owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = destination_territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
    )
  for update;
  if not found then
    raise exception 'destination territory is not available to claim';
  end if;

  perform instance_id from card_instances
  where instance_id = any(card_instance_ids)
    and owner_id = p_caller
    and stationed_territory_id = origin_territory_id
    and status = 'stationed'
  for update;
  if not found then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  arrives_at := now() + (transfer_hrs || ' hours')::interval;
  occupies_at := arrives_at + (occupation_hrs || ' hours')::interval;

  update territories
  set claim_locked_by = p_caller,
      claim_started_at = now(),
      claim_transfer_arrives_at = arrives_at,
      claim_occupation_completes_at = occupies_at
  where id = destination_territory_id;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (p_caller, 'claim', origin_territory_id, destination_territory_id, arrives_at)
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);

  insert into world_events (event_type, payload)
  select
    'claim_started',
    jsonb_build_object(
      'player_id', p.id,
      'player_display_name', p.display_name,
      'player_home_x', home.x::integer,
      'player_home_y', home.y::integer,
      'territory_id', dest.id,
      'territory_x', dest.x::integer,
      'territory_y', dest.y::integer
    )
  from players p
  left join territories home
    on home.owner_id = p.id
   and home.is_home = true
  join territories dest
    on dest.id = destination_territory_id
  where p.id = p_caller;
end;
$function$;
