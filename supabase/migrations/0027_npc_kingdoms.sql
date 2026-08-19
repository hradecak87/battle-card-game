-- NPC kingdoms (autonomous world simulation, lazy tick resolution).
--
-- Adds six-player-like NPC kingdoms backed by real auth.users rows, a lazy
-- `resolve_due_npc_actions()` resolver invoked from `resolve_due_movements()`,
-- public-RPC-preserving `_core` refactors for start_claim/declare_attack, and
-- NPC-specific battle auto-resolution for real `players.is_npc = true`
-- defenders in addition to the existing ownerless-garrison path.

alter table players
  add column if not exists is_npc boolean not null default false;

alter table players
  add column if not exists npc_next_action_at timestamptz;

create or replace function _complete_kingdom_onboarding_core(
  p_caller uuid,
  new_kingdom_name text,
  new_coat_of_arms_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed_name text := trim(new_kingdom_name);
  home_id integer;
  starter_templates text[];
  tmpl_id text;
begin
  perform resolve_due_movements();

  if not is_valid_coat_of_arms_id(new_coat_of_arms_id) then
    raise exception 'invalid coat_of_arms_id: %', new_coat_of_arms_id;
  end if;
  if char_length(trimmed_name) < 3 or char_length(trimmed_name) > 30 then
    raise exception 'kingdom_name must be 3-30 characters';
  end if;

  update players
  set kingdom_name = trimmed_name,
      coat_of_arms_id = new_coat_of_arms_id,
      onboarding_completed = true
  where id = p_caller
    and onboarding_completed = false;

  if not found then
    raise exception 'onboarding already completed or player not found';
  end if;

  for _ in 1..10 loop
    select c.id into home_id
    from (
      select t.id, t.x, t.y
      from territories t
      where t.owner_id is null and t.claim_locked_by is null
        and t.castle_rank is null and t.village_rank is null
        and t.difficulty <= 2
      order by (
        select coalesce(min(greatest(abs(t.x - h.x), abs(t.y - h.y))), 999999)
        from territories h where h.is_home
      ) desc
      limit 20
    ) c
    order by random()
    limit 1;

    if home_id is null then
      raise exception 'no candidate home territory found';
    end if;

    perform id from territories
    where id = home_id and owner_id is null and claim_locked_by is null
    for update;
    if found then
      update territories set owner_id = p_caller, is_home = true where id = home_id;
      exit;
    end if;
    home_id := null;
  end loop;

  if home_id is null then
    raise exception 'failed to assign a home territory after retries';
  end if;

  select array_agg(id) into starter_templates
  from (
    select id from card_templates
    where category = 'unit' and rank = 'common'
    order by random()
    limit 6
  ) s;

  foreach tmpl_id in array starter_templates loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (tmpl_id, p_caller, home_id, 'stationed');
  end loop;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('castle-common', p_caller, null, 'stationed');
  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('village-common', p_caller, null, 'stationed');
end;
$$;

create or replace function complete_kingdom_onboarding(new_kingdom_name text, new_coat_of_arms_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _complete_kingdom_onboarding_core(auth.uid(), new_kingdom_name, new_coat_of_arms_id);
end;
$$;

create or replace function seed_npc_kingdom_setup(
  p_player_id uuid,
  new_kingdom_name text,
  new_coat_of_arms_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from players
    where id = p_player_id
      and is_npc = true
  ) then
    raise exception 'player % is not an NPC player', p_player_id;
  end if;

  perform _complete_kingdom_onboarding_core(p_player_id, new_kingdom_name, new_coat_of_arms_id);

  update players
  set npc_next_action_at = now()
  where id = p_player_id;
end;
$$;

create or replace function _territory_effective_unit_power(
  p_owner_id uuid,
  p_territory_id integer,
  p_is_defender boolean
)
returns numeric
language sql
security definer
as $$
  with territory_ctx as (
    select
      t.castle_rank,
      t.village_rank,
      p.nation
    from territories t
    left join players p on p.id = p_owner_id
    where t.id = p_territory_id
  )
  select coalesce(sum(e.hp + e.str + e.lng + e.def), 0)
  from territory_ctx ctx
  join card_instances ci
    on ci.stationed_territory_id = p_territory_id
   and ci.status = 'stationed'
  join card_templates ct
    on ct.id = ci.template_id
   and ct.category = 'unit'
  cross join lateral _compute_effective_stats(
    ct.base_stats,
    ct.rank,
    ctx.nation,
    p_is_defender,
    case when p_is_defender then ctx.castle_rank else null end,
    case when p_is_defender then ctx.village_rank else null end
  ) e
  where (
    (p_owner_id is null and ci.owner_id is null)
    or ci.owner_id = p_owner_id
  );
$$;

create or replace function _pick_npc_defender_card(
  p_battle_id uuid,
  p_attacker_card uuid,
  p_current_round integer
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_territory_id integer;
  v_defender_owner uuid;
  v_defender_nation nation_id;
  v_castle_rank text;
  v_village_rank text;
  v_atk_rank text; v_atk_base jsonb; v_atk_owner uuid; v_atk_nation nation_id;
  v_atk_eff record;
  v_candidate record;
  v_cand_eff record;
  v_atk_dmg numeric; v_def_dmg numeric;
  v_ttk_a numeric; v_ttk_d numeric;
  v_first uuid;
  v_winner uuid;
  v_candidates uuid[];
begin
  select territory_id, defender_id
  into v_territory_id, v_defender_owner
  from battles
  where id = p_battle_id;

  select castle_rank, village_rank into v_castle_rank, v_village_rank
  from territories where id = v_territory_id;

  select nation into v_defender_nation
  from players
  where id = v_defender_owner;

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select * into v_atk_eff from _compute_effective_stats(
    v_atk_base, v_atk_rank, v_atk_nation, false, null, null);

  for v_candidate in
    select ci.instance_id, ct.rank, ct.base_stats
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_territory_id
      and (
        (v_defender_owner is null and ci.owner_id is null)
        or ci.owner_id = v_defender_owner
      )
      and ct.category = 'unit'
      and not exists (
        select 1 from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
          and (
            bur.resting_until_round >= p_current_round
            or bur.times_used >= _max_card_uses()
          )
      )
    order by ci.instance_id
  loop
    if v_first is null then
      v_first := v_candidate.instance_id;
    end if;

    select * into v_cand_eff from _compute_effective_stats(
      v_candidate.base_stats, v_candidate.rank, v_defender_nation, true, v_castle_rank, v_village_rank);

    v_atk_dmg := greatest(0, greatest(v_atk_eff.str, v_atk_eff.lng) - v_cand_eff.def);
    v_def_dmg := greatest(0, greatest(v_cand_eff.str, v_cand_eff.lng) - v_atk_eff.def);
    v_ttk_a := case when v_atk_dmg > 0 then v_cand_eff.hp::numeric / v_atk_dmg else 'infinity'::numeric end;
    v_ttk_d := case when v_def_dmg > 0 then v_atk_eff.hp::numeric / v_def_dmg else 'infinity'::numeric end;

    if not (v_ttk_a < v_ttk_d) then
      v_winner := v_candidate.instance_id;
      exit;
    end if;
  end loop;

  if v_winner is not null then
    return v_winner;
  end if;

  if v_first is null then
    raise exception 'pick_npc_defender_card requires at least one candidate';
  end if;

  select array_agg(ci.instance_id) into v_candidates
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.stationed_territory_id = v_territory_id
    and (
      (v_defender_owner is null and ci.owner_id is null)
      or ci.owner_id = v_defender_owner
    )
    and ct.category = 'unit'
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and (
          bur.resting_until_round >= p_current_round
          or bur.times_used >= _max_card_uses()
        )
    );

  return v_candidates[1 + floor(random() * array_length(v_candidates, 1))::int];
end;
$$;

create or replace function _start_next_round(p_battle_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_next_round integer;
  v_is_npc boolean;
  v_attacker_total integer;
  v_defender_total integer;
  v_attacker_avail integer;
  v_defender_avail integer;
  v_attacker_non_exhausted integer;
  v_defender_non_exhausted integer;
  v_attacker_card uuid;
  v_defender_card uuid;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  v_next_round := v_battle.current_round + 1;
  v_is_npc := v_battle.defender_id is null
    or exists (
      select 1
      from players
      where id = v_battle.defender_id
        and is_npc = true
    );

  select count(*) into v_attacker_total
  from battle_attacker_roster bar
  join card_instances ci on ci.instance_id = bar.card_instance_id
  where bar.battle_id = p_battle_id and ci.owner_id = v_battle.attacker_id;

  select count(*) into v_defender_total
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.stationed_territory_id = v_battle.territory_id
    and ct.category = 'unit'
    and (
      (v_battle.defender_id is null and ci.owner_id is null)
      or ci.owner_id = v_battle.defender_id
    );

  if v_attacker_total = 0 then
    perform _finalize_battle(p_battle_id, 'defender');
    return;
  end if;
  if v_defender_total = 0 then
    perform _finalize_battle(p_battle_id, 'attacker');
    return;
  end if;

  select count(*) into v_attacker_avail
  from battle_attacker_roster bar
  join card_instances ci on ci.instance_id = bar.card_instance_id
  where bar.battle_id = p_battle_id and ci.owner_id = v_battle.attacker_id
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and (
          bur.resting_until_round >= v_next_round
          or bur.times_used >= _max_card_uses()
        )
    );

  select count(*) into v_defender_avail
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.stationed_territory_id = v_battle.territory_id
    and ct.category = 'unit'
    and (
      (v_battle.defender_id is null and ci.owner_id is null)
      or ci.owner_id = v_battle.defender_id
    )
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and (
          bur.resting_until_round >= v_next_round
          or bur.times_used >= _max_card_uses()
        )
    );

  if v_attacker_avail = 0 or v_defender_avail = 0 then
    select count(*) into v_attacker_non_exhausted
    from battle_attacker_roster bar
    join card_instances ci on ci.instance_id = bar.card_instance_id
    where bar.battle_id = p_battle_id
      and ci.owner_id = v_battle.attacker_id
      and coalesce((
        select bur.times_used
        from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
      ), 0) < _max_card_uses();

    select count(*) into v_defender_non_exhausted
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ct.category = 'unit'
      and (
        (v_battle.defender_id is null and ci.owner_id is null)
        or ci.owner_id = v_battle.defender_id
      )
      and coalesce((
        select bur.times_used
        from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
      ), 0) < _max_card_uses();

    if v_attacker_non_exhausted = 0 then
      perform _finalize_battle(p_battle_id, 'defender');
      return;
    end if;
    if v_defender_non_exhausted = 0 then
      perform _finalize_battle(p_battle_id, 'attacker');
      return;
    end if;

    insert into battle_rounds (battle_id, round_number, skipped, resolved_at)
    values (p_battle_id, v_next_round, true, now());
    update battles set current_round = v_next_round where id = p_battle_id;
    perform _start_next_round(p_battle_id);
    return;
  end if;

  select ci.instance_id into v_attacker_card
  from battle_attacker_roster bar
  join card_instances ci on ci.instance_id = bar.card_instance_id
  where bar.battle_id = p_battle_id and ci.owner_id = v_battle.attacker_id
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and (
          bur.resting_until_round >= v_next_round
          or bur.times_used >= _max_card_uses()
        )
    )
  order by random() limit 1;

  insert into battle_rounds (battle_id, round_number, attacker_card_instance_id)
  values (p_battle_id, v_next_round, v_attacker_card);

  if v_is_npc then
    v_defender_card := _pick_npc_defender_card(p_battle_id, v_attacker_card, v_next_round);
    perform _resolve_round(p_battle_id, v_attacker_card, v_defender_card, false);
    perform _start_next_round(p_battle_id);
  else
    update battles set round_deadline = now() + interval '120 seconds'
    where id = p_battle_id;
  end if;
end;
$$;

create or replace function _start_claim_core(
  p_caller uuid,
  origin_territory_id integer,
  destination_territory_id integer,
  card_instance_ids uuid[]
)
returns void
language plpgsql
security definer
as $$
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
end;
$$;

create or replace function start_claim(
  origin_territory_id integer,
  destination_territory_id integer,
  card_instance_ids uuid[]
)
returns void
language plpgsql
security definer
as $$
begin
  perform resolve_due_battles();
  perform resolve_due_movements();
  perform _start_claim_core(auth.uid(), origin_territory_id, destination_territory_id, card_instance_ids);
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

  return movement_id;
end;
$$;

create or replace function declare_attack(
  target_territory_id integer,
  origin_groups jsonb,
  p_boost_card_instance_id uuid default null
)
returns uuid
language plpgsql
security definer
as $$
begin
  perform resolve_due_battles();
  perform resolve_due_movements();

  return _declare_attack_core(
    auth.uid(),
    target_territory_id,
    origin_groups,
    p_boost_card_instance_id
  );
end;
$$;

drop function if exists declare_attack(integer, integer, uuid[]);
create or replace function declare_attack(
  origin_territory_id integer,
  target_territory_id integer,
  card_instance_ids uuid[],
  p_boost_card_instance_id uuid default null
)
returns uuid
language sql
security definer
as $$
  select declare_attack(
    target_territory_id,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', origin_territory_id,
        'card_instance_ids', to_jsonb(card_instance_ids)
      )
    ),
    p_boost_card_instance_id
  );
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
  v_expansion_target_id integer;
  v_expansion_origin_id integer;
  v_expansion_card_ids uuid[];
  v_attack_target_id integer;
  v_attack_origin_id integer;
  v_attack_card_ids uuid[];
  v_pick_roll numeric;
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
    v_expansion_target_id := null;
    v_expansion_origin_id := null;
    v_expansion_card_ids := null;
    v_attack_target_id := null;
    v_attack_origin_id := null;
    v_attack_card_ids := null;

    begin
      select count(*) into v_owned_territory_count
      from territories
      where owner_id = v_npc.id;

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
        perform _declare_attack_core(
          v_npc.id,
          v_attack_target_id,
          jsonb_build_array(
            jsonb_build_object(
              'origin_territory_id', v_attack_origin_id,
              'card_instance_ids', to_jsonb(v_attack_card_ids)
            )
          ),
          null
        );
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

revoke execute on function _complete_kingdom_onboarding_core(uuid, text, text) from public, anon, authenticated;
grant execute on function _complete_kingdom_onboarding_core(uuid, text, text) to service_role;

revoke execute on function seed_npc_kingdom_setup(uuid, text, text) from public, anon, authenticated;
grant execute on function seed_npc_kingdom_setup(uuid, text, text) to service_role;

revoke execute on function _territory_effective_unit_power(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function _territory_effective_unit_power(uuid, integer, boolean) to service_role;

revoke execute on function _pick_npc_defender_card(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function _pick_npc_defender_card(uuid, uuid, integer) to service_role;

revoke execute on function _start_next_round(uuid) from public, anon, authenticated;
grant execute on function _start_next_round(uuid) to service_role;

revoke execute on function _start_claim_core(uuid, integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function _start_claim_core(uuid, integer, integer, uuid[]) to service_role;

revoke execute on function _declare_attack_core(uuid, integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function _declare_attack_core(uuid, integer, jsonb, uuid) to service_role;

revoke execute on function resolve_due_npc_actions() from public, anon, authenticated;
grant execute on function resolve_due_npc_actions() to service_role;

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
    select t.claim_locked_by
    from territories t
    where t.claim_occupation_completes_at <= now()
      and t.claim_locked_by is not null
    for update
  loop
    perform _award_xp(v_completed_claim.claim_locked_by, 15);
  end loop;

  update troop_movements tm
  set status = 'completed'
  from territories t
  where tm.kind = 'claim'
    and tm.status = 'occupying'
    and tm.destination_territory_id = t.id
    and t.claim_occupation_completes_at <= now()
    and t.claim_locked_by is not null;

  update territories
  set owner_id = claim_locked_by,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null
  where claim_occupation_completes_at <= now()
    and claim_locked_by is not null;
end;
$$;

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
  owner_is_npc boolean,
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
      coalesce(owner_player.is_npc, false),
      t.is_home, t.claim_locked_by, t.claim_started_at, t.claim_transfer_arrives_at,
      t.claim_occupation_completes_at, t.battle_locked_by,
      (select b.id from battles b
       where b.territory_id = t.id and b.status not in ('resolved', 'expired')
       limit 1) as battle_id,
      t.name
    from territories t
    left join players owner_player on owner_player.id = t.owner_id
    where t.x between x1 and x2 and t.y between y1 and y2;
end;
$$;

drop function if exists get_minimap_overview();

create or replace function get_minimap_overview()
returns table (
  x smallint,
  y smallint,
  owner_id uuid,
  owner_is_npc boolean,
  castle_rank text,
  village_rank text,
  claim_locked_by uuid,
  battle_locked_by uuid,
  battle_id uuid
)
language plpgsql
as $$
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  return query
    select
      t.x, t.y, t.owner_id, coalesce(owner_player.is_npc, false), t.castle_rank, t.village_rank, t.claim_locked_by,
      t.battle_locked_by,
      (select b.id from battles b
       where b.territory_id = t.id and b.status not in ('resolved', 'expired')
       limit 1) as battle_id
    from territories t
    left join players owner_player on owner_player.id = t.owner_id
    where t.owner_id is not null or t.castle_rank is not null
       or t.village_rank is not null or t.claim_locked_by is not null
       or t.battle_locked_by is not null;
end;
$$;
