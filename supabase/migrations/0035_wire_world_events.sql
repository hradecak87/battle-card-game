create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.players (id, display_name, nation)
  values (
    new.id,
    trim(new.raw_user_meta_data ->> 'display_name'),
    (new.raw_user_meta_data ->> 'nation')::nation_id
  );

  insert into world_events (event_type, payload)
  values (
    'player_joined',
    jsonb_build_object(
      'player_id', new.id,
      'player_display_name', trim(new.raw_user_meta_data ->> 'display_name'),
      'player_home_x', null,
      'player_home_y', null
    )
  );

  return new;
end;
$$;

create or replace function _award_xp(
  p_player_id uuid,
  p_amount integer
) returns void
language plpgsql
security definer
as $$
declare
  v_old_xp integer;
  v_old_level integer;
  v_new_level integer;
  v_structure_category text;
  v_level integer;
  v_unit_rank text;
  v_unit_template_id text;
  v_boost_template_id text;
  v_instance_id uuid;
  v_player_display_name text;
  v_home_x integer;
  v_home_y integer;
begin
  if p_amount <= 0 then
    return;
  end if;

  select xp, display_name into v_old_xp, v_player_display_name
  from players
  where id = p_player_id
  for update;
  if not found then
    raise exception 'player % not found', p_player_id;
  end if;

  v_old_level := xp_level(v_old_xp);

  update players
  set xp = xp + p_amount
  where id = p_player_id;

  v_new_level := xp_level(v_old_xp + p_amount);

  if v_new_level > v_old_level then
    for v_level in (v_old_level + 1)..v_new_level loop
      v_unit_rank := case when mod(v_level, 10) = 0 then 'uncommon' else 'common' end;

      select id into v_unit_template_id
      from card_templates
      where category = 'unit' and rank = v_unit_rank
      order by random()
      limit 1;

      insert into card_instances (template_id, owner_id, stationed_territory_id, status)
      values (v_unit_template_id, null, null, 'stationed')
      returning instance_id into v_instance_id;
      perform _deposit_or_grant_card(p_player_id, v_instance_id);
    end loop;
  end if;

  if floor(v_new_level::numeric / 5) > floor(v_old_level::numeric / 5) then
    v_structure_category := case when random() < 0.5 then 'castle' else 'village' end;
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_structure_category || '-common', null, null, 'stationed')
    returning instance_id into v_instance_id;
    perform _deposit_or_grant_card(p_player_id, v_instance_id);

    select id into v_boost_template_id
    from card_templates
    where category = 'boost' and rank in ('common', 'uncommon')
    order by random()
    limit 1;

    if v_boost_template_id is not null then
      insert into card_instances (template_id, owner_id, stationed_territory_id, status)
      values (v_boost_template_id, null, null, 'stationed')
      returning instance_id into v_instance_id;
      perform _deposit_or_grant_card(p_player_id, v_instance_id);
    end if;
  end if;

  if v_new_level > v_old_level then
    select t.x::integer, t.y::integer
    into v_home_x, v_home_y
    from territories t
    where t.owner_id = p_player_id
      and t.is_home = true;

    insert into world_events (event_type, payload)
    values (
      'player_leveled_up',
      jsonb_build_object(
        'player_id', p_player_id,
        'player_display_name', v_player_display_name,
        'player_home_x', v_home_x,
        'player_home_y', v_home_y,
        'new_level', v_new_level
      )
    );
  end if;
end;
$$;

create or replace function _declare_attack_core(
  p_caller uuid,
  target_territory_id integer,
  origin_groups jsonb,
  p_boost_card_instance_id uuid default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  caller_nation nation_id;
  target_x smallint; target_y smallint;
  target_owner uuid;
  target_claim_locked_by uuid;
  target_battle_locked_by uuid;
  target_is_home boolean;
  target_is_empty_claimable boolean;
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

  return movement_id;
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
end;
$$;

drop function if exists _finalize_battle(uuid, text, boolean);
drop function if exists _finalize_battle(uuid, text, boolean, text);

create or replace function _finalize_battle(
  p_battle_id uuid,
  p_winner_side text,
  p_defender_surrendered boolean default false,
  p_surrendered_side text default null
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_winner_id uuid;
  v_loser_id uuid;
  v_boost_template_id text;
  v_instance_id uuid;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  if v_battle.attacker_boost_active_from_round is not null and v_battle.attacker_boost_instance_id is not null then
    delete from card_instances where instance_id = v_battle.attacker_boost_instance_id;
  end if;
  if v_battle.defender_boost_active_from_round is not null and v_battle.defender_boost_instance_id is not null then
    delete from card_instances where instance_id = v_battle.defender_boost_instance_id;
  end if;

  perform public._finalize_battle_base_0025(p_battle_id, p_winner_side, p_defender_surrendered);

  if p_winner_side is not null then
    v_winner_id := case p_winner_side
      when 'attacker' then v_battle.attacker_id
      when 'defender' then v_battle.defender_id
    end;
    v_loser_id := case p_winner_side
      when 'attacker' then v_battle.defender_id
      when 'defender' then v_battle.attacker_id
    end;

    insert into world_events (event_type, payload)
    select
      case
        when p_surrendered_side is not null then 'battle_surrendered'
        else 'battle_won'
      end,
      jsonb_build_object(
        'winner_id', winner.id,
        'winner_display_name', winner.display_name,
        'winner_home_x', winner_home.x::integer,
        'winner_home_y', winner_home.y::integer,
        'loser_id', loser.id,
        'loser_display_name', loser.display_name,
        'loser_home_x', loser_home.x::integer,
        'loser_home_y', loser_home.y::integer,
        'territory_id', territory.id,
        'territory_x', territory.x::integer,
        'territory_y', territory.y::integer,
        'surrendered_side', p_surrendered_side
      )
    from territories territory
    left join players winner on winner.id = v_winner_id
    left join territories winner_home
      on winner_home.owner_id = winner.id
     and winner_home.is_home = true
    left join players loser on loser.id = v_loser_id
    left join territories loser_home
      on loser_home.owner_id = loser.id
     and loser_home.is_home = true
    where territory.id = v_battle.territory_id;

    if v_winner_id is not null then
      if random() < 0.20 then
        select id into v_boost_template_id
        from card_templates
        where category = 'boost'
        order by random()
        limit 1;

        if v_boost_template_id is not null then
          insert into card_instances (template_id, owner_id, stationed_territory_id, status)
          values (v_boost_template_id, null, null, 'stationed')
          returning instance_id into v_instance_id;
          perform _deposit_or_grant_card(v_winner_id, v_instance_id);
        end if;
      end if;
    end if;
  end if;
end;
$$;

create or replace function surrender_battle(p_battle_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_battle record;
begin
  perform resolve_due_battles();

  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle not found';
  end if;
  if v_battle.status <> 'active' then
    raise exception 'battle is not currently active and cannot be surrendered';
  end if;

  if caller = v_battle.attacker_id then
    perform _finalize_battle(p_battle_id, 'defender', false, 'attacker');
  elsif v_battle.defender_id is not null and caller = v_battle.defender_id then
    perform _finalize_battle(p_battle_id, 'attacker', true, 'defender');
  else
    raise exception 'caller is not a participant in this battle';
  end if;
end;
$$;

create or replace function recall_attack(p_movement_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_movement record;
  v_elapsed_hours numeric;
  v_origin_group record;
  v_return_movement_id uuid;
begin
  perform resolve_due_movements();
  perform resolve_due_battles();

  select * into v_movement from troop_movements where id = p_movement_id for update;
  if not found then
    raise exception 'movement not found';
  end if;
  if v_movement.player_id <> caller then
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
      caller,
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
  where id = v_movement.destination_territory_id and battle_locked_by = caller;

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
  where p.id = caller;
end;
$$;

create or replace function abandon_territory(p_territory_id integer)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  is_home_flag boolean;
  home_id integer;
  home_x smallint; home_y smallint;
  origin_x smallint; origin_y smallint;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  transfer_hrs numeric;
  arrives_at timestamptz;
  movement_id uuid;
  card_ids uuid[];
  v_player_display_name text;
begin
  perform resolve_due_movements();

  select is_home, x, y into is_home_flag, origin_x, origin_y
  from territories
  where id = p_territory_id and owner_id = caller
  for update;
  if not found then
    raise exception 'caller does not own p_territory_id';
  end if;

  if is_home_flag then
    raise exception 'cannot abandon your home territory';
  end if;

  if exists (
    select 1 from battles
    where territory_id = p_territory_id
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'cannot abandon a territory with an unresolved battle';
  end if;

  if exists (
    select 1 from troop_movements
    where destination_territory_id = p_territory_id
      and status = 'in_transit'
  ) then
    raise exception 'cannot abandon a territory with incoming movements — wait for them to arrive or recall them first';
  end if;

  select nation, display_name into caller_nation, v_player_display_name
  from players where id = caller;

  select id, x, y into home_id, home_x, home_y
  from territories where owner_id = caller and is_home = true;
  if not found then
    raise exception 'caller has no home territory (data integrity issue)';
  end if;

  select array_agg(instance_id) into card_ids
  from card_instances
  where owner_id = caller
    and stationed_territory_id = p_territory_id
    and status = 'stationed';

  if card_ids is not null and array_length(card_ids, 1) > 0 then
    distance := greatest(abs(home_x - origin_x), abs(home_y - origin_y));
    group_speed := _min_group_speed(card_ids);
    speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
    transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
      * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);
    arrives_at := now() + (transfer_hrs || ' hours')::interval;

    insert into troop_movements
      (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
    values (caller, 'transfer', p_territory_id, home_id, arrives_at)
    returning id into movement_id;

    insert into troop_movement_units (movement_id, card_instance_id)
    select movement_id, unnest(card_ids);

    update card_instances
    set status = 'in_transit'
    where instance_id = any(card_ids);
  end if;

  update territories
  set owner_id = null
  where id = p_territory_id;

  insert into world_events (event_type, payload)
  values (
    'territory_abandoned',
    jsonb_build_object(
      'player_id', caller,
      'player_display_name', v_player_display_name,
      'player_home_x', home_x::integer,
      'player_home_y', home_y::integer,
      'territory_id', p_territory_id,
      'territory_x', origin_x::integer,
      'territory_y', origin_y::integer
    )
  );
end;
$$;

create or replace function relocate_home(p_new_territory_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_xp integer;
  v_level integer;
  v_used_at timestamptz;
  v_old_home_id integer;
  v_new_owner uuid;
  v_new_is_home boolean;
  v_new_claim_locked_by uuid;
  v_new_battle_locked_by uuid;
  v_required_level constant integer := 15;
  v_player_display_name text;
  v_old_home_x smallint;
  v_old_home_y smallint;
  v_new_x smallint;
  v_new_y smallint;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();

  select xp, king_relocation_used_at, display_name
  into v_xp, v_used_at, v_player_display_name
  from players
  where id = v_caller
  for update;
  if not found then
    raise exception 'player % not found', v_caller;
  end if;

  if v_used_at is not null then
    raise exception 'king ability has already been used';
  end if;

  v_level := xp_level(v_xp);
  if v_level < v_required_level then
    raise exception 'king ability unlocks at level %', v_required_level;
  end if;

  select id, x, y
  into v_old_home_id, v_old_home_x, v_old_home_y
  from territories
  where owner_id = v_caller and is_home = true
  for update;
  if not found then
    raise exception 'caller has no home territory (data integrity issue)';
  end if;

  select owner_id, is_home, claim_locked_by, battle_locked_by, x, y
  into v_new_owner, v_new_is_home, v_new_claim_locked_by, v_new_battle_locked_by, v_new_x, v_new_y
  from territories
  where id = p_new_territory_id
  for update;
  if not found then
    raise exception 'p_new_territory_id not found';
  end if;

  if v_new_owner <> v_caller then
    raise exception 'caller does not own p_new_territory_id';
  end if;

  if p_new_territory_id = v_old_home_id or v_new_is_home then
    raise exception 'p_new_territory_id is already your home territory';
  end if;

  if v_new_claim_locked_by is not null then
    raise exception 'cannot relocate home to a territory with an active claim';
  end if;

  if v_new_battle_locked_by is not null or exists (
    select 1 from battles
    where territory_id = p_new_territory_id
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'cannot relocate home to a territory with an unresolved battle';
  end if;

  update territories
  set is_home = false
  where id = v_old_home_id;

  update territories
  set is_home = true
  where id = p_new_territory_id;

  update players
  set king_relocation_used_at = clock_timestamp()
  where id = v_caller;

  insert into world_events (event_type, payload)
  values (
    'king_relocated',
    jsonb_build_object(
      'player_id', v_caller,
      'player_display_name', v_player_display_name,
      'old_home_territory_id', v_old_home_id,
      'old_home_x', v_old_home_x::integer,
      'old_home_y', v_old_home_y::integer,
      'new_home_territory_id', p_new_territory_id,
      'new_home_x', v_new_x::integer,
      'new_home_y', v_new_y::integer
    )
  );
end;
$$;
