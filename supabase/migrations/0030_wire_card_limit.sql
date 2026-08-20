-- Card limit + deposit wiring (backlog #27)
--
-- Reapplies every current live card-grant / owner-transfer function so all
-- newly acquired cards flow through _deposit_or_grant_card().

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
  v_instance_id uuid;
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
    values (tmpl_id, null, home_id, 'stationed')
    returning instance_id into v_instance_id;

    perform _deposit_or_grant_card(p_caller, v_instance_id);
  end loop;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('castle-common', null, null, 'stationed')
  returning instance_id into v_instance_id;
  perform _deposit_or_grant_card(p_caller, v_instance_id);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('village-common', null, null, 'stationed')
  returning instance_id into v_instance_id;
  perform _deposit_or_grant_card(p_caller, v_instance_id);
end;
$$;

create or replace function claim_daily_reward()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
  v_claimed_at timestamptz;
  v_today timestamptz;
  v_last_claim_at timestamptz;
  v_old_streak integer;
  v_new_streak integer;
  v_template_id text;
  v_instance_id uuid;
  v_granted_cards jsonb := '[]'::jsonb;
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  select last_daily_reward_at, daily_reward_streak
  into v_last_claim_at, v_old_streak
  from players
  where id = v_player_id
  for update;
  if not found then
    raise exception 'player % not found', v_player_id;
  end if;

  v_claimed_at := clock_timestamp();
  v_today := date_trunc('day', v_claimed_at);

  if v_last_claim_at is not null and date_trunc('day', v_last_claim_at) = v_today then
    raise exception 'daily reward already claimed today';
  end if;

  if v_last_claim_at is not null
     and date_trunc('day', v_last_claim_at) = v_today - interval '1 day' then
    v_new_streak := v_old_streak + 1;
  else
    v_new_streak := 1;
  end if;

  update players
  set daily_reward_streak = v_new_streak,
      last_daily_reward_at = v_claimed_at
  where id = v_player_id;

  select id into v_template_id
  from card_templates
  where category = 'unit' and rank = 'common'
  order by random()
  limit 1;

  if v_template_id is null then
    raise exception 'no common unit card template found';
  end if;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, null, null, 'stationed')
  returning instance_id into v_instance_id;
  perform _deposit_or_grant_card(v_player_id, v_instance_id);

  v_granted_cards := v_granted_cards || jsonb_build_array(
    jsonb_build_object('template_id', v_template_id, 'rank', 'common')
  );

  if mod(v_new_streak, 7) = 0 then
    select id into v_template_id
    from card_templates
    where category = 'unit' and rank = 'uncommon'
    order by random()
    limit 1;

    if v_template_id is null then
      raise exception 'no uncommon unit card template found';
    end if;

    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_template_id, null, null, 'stationed')
    returning instance_id into v_instance_id;
    perform _deposit_or_grant_card(v_player_id, v_instance_id);

    v_granted_cards := v_granted_cards || jsonb_build_array(
      jsonb_build_object('template_id', v_template_id, 'rank', 'uncommon')
    );
  end if;

  return jsonb_build_object(
    'streak', v_new_streak,
    'claimed_at', v_claimed_at,
    'granted_cards', v_granted_cards
  );
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
begin
  if p_amount <= 0 then
    return;
  end if;

  select xp into v_old_xp
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
end;
$$;

create or replace function _trigger_instant_boost_if_needed(
  p_battle_id uuid,
  p_round_number integer,
  p_attacker_card uuid,
  p_defender_card uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_target uuid;
  v_template record;
begin
  select * into v_battle from battles where id = p_battle_id;
  if not found then
    return;
  end if;

  if v_battle.attacker_boost_instance_id is not null
     and v_battle.attacker_boost_active_from_round is not null
     and p_round_number >= v_battle.attacker_boost_active_from_round
     and not exists (
       select 1
       from battle_rounds br
       where br.battle_id = p_battle_id
         and br.round_number >= v_battle.attacker_boost_active_from_round
         and br.winner_card_instance_id is not null
     ) then
    select ct.effect_kind, ct.instant_effect_kind
    into v_template
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = v_battle.attacker_boost_instance_id;

    if found and v_template.effect_kind = 'instant_effect' and v_template.instant_effect_kind = 'steal_unit' then
      if v_battle.defender_id is null then
        select ci.instance_id into v_target
        from card_instances ci
        join card_templates ct on ct.id = ci.template_id
        where ci.stationed_territory_id = v_battle.territory_id
          and ci.owner_id is null
          and ct.category = 'unit'
          and ci.instance_id <> p_defender_card
        order by random()
        limit 1;
      else
        select ci.instance_id into v_target
        from card_instances ci
        join card_templates ct on ct.id = ci.template_id
        where ci.stationed_territory_id = v_battle.territory_id
          and ci.owner_id = v_battle.defender_id
          and ct.category = 'unit'
          and ci.instance_id <> p_defender_card
        order by random()
        limit 1;
      end if;

      if v_target is not null then
        perform _deposit_or_grant_card(v_battle.attacker_id, v_target);
      end if;
    end if;
  end if;

  if v_battle.defender_boost_instance_id is not null
     and v_battle.defender_boost_active_from_round is not null
     and p_round_number >= v_battle.defender_boost_active_from_round
     and not exists (
       select 1
       from battle_rounds br
       where br.battle_id = p_battle_id
         and br.round_number >= v_battle.defender_boost_active_from_round
         and br.winner_card_instance_id is not null
     ) then
    select ct.effect_kind, ct.instant_effect_kind
    into v_template
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = v_battle.defender_boost_instance_id;

    if found and v_template.effect_kind = 'instant_effect' and v_template.instant_effect_kind = 'steal_unit' then
      select ci.instance_id into v_target
      from battle_attacker_roster bar
      join card_instances ci on ci.instance_id = bar.card_instance_id
      join card_templates ct on ct.id = ci.template_id
      where bar.battle_id = p_battle_id
        and ci.owner_id = v_battle.attacker_id
        and ct.category = 'unit'
        and ci.instance_id <> p_attacker_card
      order by random()
      limit 1;

      if v_target is not null then
        perform _deposit_or_grant_card(v_battle.defender_id, v_target);
      end if;
    end if;
  end if;
end;
$$;

create or replace function _finalize_battle_base_0025(
  p_battle_id uuid,
  p_winner_side text,
  p_defender_surrendered boolean default false
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_origin_territory_id integer;
  v_capture boolean := false;
  v_owned_count integer;
  v_defender_home_id integer;
  v_mover_nation nation_id;
  v_moving_ids uuid[];
  v_from_x smallint; v_from_y smallint;
  v_to_x smallint; v_to_y smallint;
  v_distance numeric;
  v_group_speed numeric;
  v_speed_mult numeric;
  v_transfer_hrs numeric;
  v_arrives_at timestamptz;
  v_movement_id uuid;
  v_winner_id uuid;
  v_structure_category text;
  v_attacker_origin_group record;
  v_instance_id uuid;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  select origin_territory_id into v_origin_territory_id
  from troop_movements where id = v_battle.movement_id;

  if p_winner_side = 'attacker' then
    select count(*) into v_owned_count
    from territories where owner_id = v_battle.attacker_id or claim_locked_by = v_battle.attacker_id;
    v_capture := (not v_battle.is_home_target) and v_owned_count < 32;
  end if;

  if v_capture then
    update territories
    set owner_id = v_battle.attacker_id,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null,
        battle_locked_by = null
    where id = v_battle.territory_id;

    if v_battle.defender_id is not null then
      select array_agg(instance_id) into v_moving_ids
      from card_instances
      where owner_id = v_battle.defender_id
        and stationed_territory_id = v_battle.territory_id;

      if v_moving_ids is not null and array_length(v_moving_ids, 1) > 0 then
        select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;

        if p_defender_surrendered then
          select id into v_defender_home_id
          from territories
          where owner_id = v_battle.defender_id
            and id <> v_battle.territory_id
          order by greatest(abs(x - v_from_x), abs(y - v_from_y)) asc
          limit 1;
        else
          select id into v_defender_home_id
          from territories where owner_id = v_battle.defender_id and is_home;
        end if;

        select nation into v_mover_nation from players where id = v_battle.defender_id;
        select x, y into v_to_x, v_to_y from territories where id = v_defender_home_id;
        v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
        v_group_speed := _min_group_speed(v_moving_ids);
        v_speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(v_group_speed, 5.0)));
        v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult)
          * (case when v_mover_nation = 'mongol_horde' then 0.75 else 1.0 end);
        v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

        insert into troop_movements
          (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
        values (v_battle.defender_id, 'transfer', v_battle.territory_id, v_defender_home_id, v_arrives_at)
        returning id into v_movement_id;

        insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
        select v_movement_id, unnest(v_moving_ids), v_battle.territory_id;

        update card_instances set status = 'in_transit'
        where instance_id = any(v_moving_ids);
      end if;
    end if;
  else
    update territories set battle_locked_by = null where id = v_battle.territory_id;

    for v_attacker_origin_group in
      select
        coalesce(tmu.origin_territory_id, v_origin_territory_id) as origin_territory_id,
        array_agg(ci.instance_id order by ci.instance_id) as moving_ids
      from card_instances ci
      left join troop_movement_units tmu
        on tmu.movement_id = v_battle.movement_id
       and tmu.card_instance_id = ci.instance_id
      where ci.owner_id = v_battle.attacker_id
        and ci.stationed_territory_id = v_battle.territory_id
      group by coalesce(tmu.origin_territory_id, v_origin_territory_id)
    loop
      v_moving_ids := v_attacker_origin_group.moving_ids;
      if v_moving_ids is null or array_length(v_moving_ids, 1) = 0 then
        continue;
      end if;

      select nation into v_mover_nation from players where id = v_battle.attacker_id;
      select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;
      select x, y into v_to_x, v_to_y from territories where id = v_attacker_origin_group.origin_territory_id;
      v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
      v_group_speed := _min_group_speed(v_moving_ids);
      v_speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(v_group_speed, 5.0)));
      v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult)
        * (case when v_mover_nation = 'mongol_horde' then 0.75 else 1.0 end);
      v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

      insert into troop_movements
        (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
      values (
        v_battle.attacker_id,
        'transfer',
        v_battle.territory_id,
        v_attacker_origin_group.origin_territory_id,
        v_arrives_at
      )
      returning id into v_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
      select v_movement_id, unnest(v_moving_ids), v_battle.territory_id;

      update card_instances set status = 'in_transit'
      where instance_id = any(v_moving_ids);
    end loop;
  end if;

  update battles
  set status = case when p_winner_side is null then 'expired' else 'resolved' end,
      winner_side = p_winner_side,
      resolved_at = now()
  where id = p_battle_id;

  if p_winner_side is not null then
    v_winner_id := case p_winner_side
      when 'attacker' then v_battle.attacker_id
      when 'defender' then v_battle.defender_id
    end;

    if v_winner_id is not null then
      perform _award_xp(v_winner_id, 50);

      if random() < 0.01 then
        v_structure_category := case when random() < 0.5 then 'castle' else 'village' end;
        insert into card_instances (template_id, owner_id, stationed_territory_id, status)
        values (v_structure_category || '-common', null, null, 'stationed')
        returning instance_id into v_instance_id;
        perform _deposit_or_grant_card(v_winner_id, v_instance_id);
      end if;
    end if;
  end if;
end;
$$;

create or replace function _finalize_battle(
  p_battle_id uuid,
  p_winner_side text,
  p_defender_surrendered boolean default false
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_winner_id uuid;
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

create or replace function _resolve_round(
  p_battle_id uuid,
  p_attacker_card uuid,
  p_defender_card uuid,
  p_auto_picked boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_round record;
  v_next_round integer;
  v_atk_rank text; v_atk_base jsonb; v_atk_owner uuid; v_atk_nation nation_id;
  v_def_rank text; v_def_base jsonb; v_def_owner uuid; v_def_nation nation_id;
  v_castle_rank text; v_village_rank text;
  v_atk_eff record;
  v_def_eff record;
  v_atk_dmg numeric; v_def_dmg numeric;
  v_ttk_attacker_wins numeric; v_ttk_defender_wins numeric;
  v_attacker_rate numeric; v_defender_rate numeric; v_attacker_win_probability numeric;
  v_deterministic_winner text; v_actual_winner text; v_roll double precision;
  v_winner_card uuid; v_loser_card uuid; v_winner_owner uuid;
  v_flavor_text text;
  v_resting_until integer;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  v_next_round := v_battle.current_round + 1;

  select * into v_round
  from battle_rounds
  where battle_id = p_battle_id and round_number = v_next_round
  for update;
  if v_round.defender_card_instance_id is not null or v_round.skipped then
    return;
  end if;

  perform _trigger_instant_boost_if_needed(p_battle_id, v_next_round, p_attacker_card, p_defender_card);

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select ct.rank, ct.base_stats, ci.owner_id into v_def_rank, v_def_base, v_def_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_defender_card;
  select nation into v_def_nation from players where id = v_def_owner;

  select castle_rank, village_rank into v_castle_rank, v_village_rank
  from territories where id = v_battle.territory_id;

  select * into v_atk_eff from _compute_battle_effective_stats(
    p_battle_id, 'attacker', v_next_round, v_atk_base, v_atk_rank, v_atk_nation, false, null, null
  );
  select * into v_def_eff from _compute_battle_effective_stats(
    p_battle_id, 'defender', v_next_round, v_def_base, v_def_rank, v_def_nation, true, v_castle_rank, v_village_rank
  );

  v_atk_dmg := greatest(0, greatest(v_atk_eff.str, v_atk_eff.lng) - v_def_eff.def);
  v_def_dmg := greatest(0, greatest(v_def_eff.str, v_def_eff.lng) - v_atk_eff.def);
  v_ttk_attacker_wins := case when v_atk_dmg > 0 then v_def_eff.hp::numeric / v_atk_dmg else 'infinity'::numeric end;
  v_ttk_defender_wins := case when v_def_dmg > 0 then v_atk_eff.hp::numeric / v_def_dmg else 'infinity'::numeric end;

  if v_ttk_attacker_wins < v_ttk_defender_wins then
    v_deterministic_winner := 'attacker';
  else
    v_deterministic_winner := 'defender';
  end if;

  v_attacker_rate := case when v_atk_dmg > 0 then v_atk_dmg / v_def_eff.hp::numeric else 0 end;
  v_defender_rate := case when v_def_dmg > 0 then v_def_dmg / v_atk_eff.hp::numeric else 0 end;
  v_attacker_win_probability := case
    when v_attacker_rate = 0 and v_defender_rate = 0 then 0.03
    else 0.03 + (v_attacker_rate / (v_attacker_rate + v_defender_rate)) * 0.94
  end;

  v_roll := random();
  if v_roll < v_attacker_win_probability::double precision then
    v_actual_winner := 'attacker';
    v_winner_card := p_attacker_card;
    v_loser_card := p_defender_card;
  else
    v_actual_winner := 'defender';
    v_winner_card := p_defender_card;
    v_loser_card := p_attacker_card;
  end if;

  if v_actual_winner <> v_deterministic_winner then
    select text into v_flavor_text from combat_flavor_texts order by random() limit 1;
  end if;

  select owner_id into v_winner_owner from card_instances where instance_id = v_winner_card;
  perform _deposit_or_grant_card(v_winner_owner, v_loser_card);

  update battle_rounds
  set defender_card_instance_id = p_defender_card,
      winner_card_instance_id = v_winner_card,
      auto_picked = p_auto_picked,
      resolved_at = now(),
      attacker_atk = greatest(v_atk_eff.str, v_atk_eff.lng),
      attacker_dmg_dealt = v_atk_dmg,
      attacker_ttk = case when v_ttk_attacker_wins = 'infinity'::numeric then null else v_ttk_attacker_wins end,
      defender_atk = greatest(v_def_eff.str, v_def_eff.lng),
      defender_dmg_dealt = v_def_dmg,
      defender_ttk = case when v_ttk_defender_wins = 'infinity'::numeric then null else v_ttk_defender_wins end,
      attacker_win_probability = v_attacker_win_probability,
      flavor_text = v_flavor_text
  where battle_id = p_battle_id and round_number = v_next_round;

  update battles set current_round = v_next_round where id = p_battle_id;
  v_resting_until := v_next_round + 2;

  insert into battle_unit_rest (battle_id, card_instance_id, resting_until_round, times_used)
  values (p_battle_id, p_attacker_card, v_resting_until, 1),
         (p_battle_id, p_defender_card, v_resting_until, 1)
  on conflict (battle_id, card_instance_id)
  do update set resting_until_round = excluded.resting_until_round,
                times_used = battle_unit_rest.times_used + 1;
end;
$$;

create or replace function accept_trade_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := trade_require_player();
  v_offer trade_offers%rowtype;
  v_root_public trade_offers%rowtype;
  v_root_offer trade_offers%rowtype;
  v_target_bundle uuid[];
  v_card_id uuid;
  v_deck_count integer;
  v_limit integer;
  v_xp integer;
  v_card_status text;
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  perform resolve_expired_trade_offers();

  select *
  into v_offer
  from trade_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'trade offer % not found', p_offer_id;
  end if;
  if v_offer.type <> 'direct' then
    raise exception 'public listings cannot be accepted directly';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'trade offer % is not pending', p_offer_id;
  end if;
  if v_offer.target_player_id <> v_caller then
    raise exception 'only the current target may accept this offer';
  end if;

  select *
  into v_root_offer
  from trade_offers
  where id = v_offer.root_offer_id
  for update;

  if found and v_root_offer.type = 'public' then
    v_root_public := v_root_offer;
  end if;

  perform trade_validate_card_bundle(v_offer.offered_card_ids, v_offer.initiator_id, true, 'offered_card_ids');

  if coalesce(array_length(v_offer.requested_card_ids, 1), 0) > 0 then
    v_target_bundle := v_offer.requested_card_ids;
    perform trade_validate_card_bundle(v_target_bundle, v_caller, true, 'requested_card_ids');
  else
    if v_root_public.id is null then
      raise exception 'trade offer % has no valid public root listing to accept against', p_offer_id;
    end if;
    if v_root_public.status <> 'pending' then
      raise exception 'root public listing % is no longer active', v_root_public.id;
    end if;
    if v_root_public.initiator_id <> v_caller then
      raise exception 'only the public listing owner may accept this response';
    end if;

    v_target_bundle := v_root_public.offered_card_ids;
    perform trade_validate_card_bundle(v_target_bundle, v_caller, true, 'root_public_offered_card_ids');
  end if;

  if exists (
    select 1
    from unnest(v_offer.offered_card_ids) as a(card_id)
    join unnest(v_target_bundle) as b(card_id)
      on a.card_id = b.card_id
  ) then
    raise exception 'the same card cannot appear on both sides of a trade';
  end if;

  update card_instances
  set owner_id = v_caller
  where instance_id = any(v_offer.offered_card_ids);

  update card_instances
  set owner_id = v_offer.initiator_id
  where instance_id = any(v_target_bundle);

  select xp into v_xp from players where id = v_caller;
  v_limit := _deck_limit(_level_for_xp(v_xp));
  select count(*) into v_deck_count
  from card_instances
  where owner_id = v_caller
    and status in ('stationed', 'in_transit');

  if v_deck_count > v_limit then
    foreach v_card_id in array v_offer.offered_card_ids loop
      exit when v_deck_count <= v_limit;
      select status into v_card_status from card_instances where instance_id = v_card_id;
      perform _deposit_or_grant_card(v_caller, v_card_id, coalesce(v_card_status, 'stationed'));
      select count(*) into v_deck_count
      from card_instances
      where owner_id = v_caller
        and status in ('stationed', 'in_transit');
    end loop;
  end if;

  select xp into v_xp from players where id = v_offer.initiator_id;
  v_limit := _deck_limit(_level_for_xp(v_xp));
  select count(*) into v_deck_count
  from card_instances
  where owner_id = v_offer.initiator_id
    and status in ('stationed', 'in_transit');

  if v_deck_count > v_limit then
    foreach v_card_id in array v_target_bundle loop
      exit when v_deck_count <= v_limit;
      select status into v_card_status from card_instances where instance_id = v_card_id;
      perform _deposit_or_grant_card(v_offer.initiator_id, v_card_id, coalesce(v_card_status, 'stationed'));
      select count(*) into v_deck_count
      from card_instances
      where owner_id = v_offer.initiator_id
        and status in ('stationed', 'in_transit');
    end loop;
  end if;

  update trade_offers
  set status = 'accepted',
      resolved_at = now()
  where id = v_offer.id;

  if v_root_public.id is not null then
    update trade_offers
    set status = 'accepted',
        resolved_at = coalesce(resolved_at, now())
    where id = v_root_public.id;

    update trade_offers
    set status = 'cancelled',
        resolved_at = coalesce(resolved_at, now())
    where root_offer_id = v_root_public.id
      and id <> v_offer.id
      and type = 'direct'
      and status = 'pending';
  end if;

  perform _notify(
    v_offer.initiator_id,
    'trade_offer_accepted',
    (
      select jsonb_build_object(
        'offer_id', v_offer.id,
        'other_player_id', v_caller,
        'other_display_name', p.display_name
      )
      from players p
      where p.id = v_caller
    )
  );
end;
$$;
