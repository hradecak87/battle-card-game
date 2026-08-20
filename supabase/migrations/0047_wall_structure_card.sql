-- Hradby (Walls) structure card.

alter table territories
  add column if not exists wall_rank text
    check (wall_rank in ('common','uncommon','rare','epic','legend'));

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'card_templates'::regclass
      and contype = 'c'
  loop
    execute format('alter table card_templates drop constraint %I', v_constraint.conname);
  end loop;
end;
$$;

alter table card_templates
  add constraint card_templates_category_check
    check (category in ('unit', 'castle', 'village', 'wall', 'boost')),
  add constraint card_templates_rank_check
    check (rank in ('common', 'uncommon', 'rare', 'epic', 'legend')),
  add constraint card_templates_unit_shape_check
    check (category <> 'unit' or (unit_type is not null and base_stats is not null)),
  add constraint card_templates_non_unit_type_check
    check (category = 'unit' or unit_type is null),
  add constraint card_templates_structure_bonus_shape_check
    check (
      category in ('castle', 'village', 'wall')
      or (defense_bonus_pct is null and attack_bonus_pct is null)
    ),
  add constraint card_templates_structure_bonus_required_check
    check (category not in ('castle', 'village', 'wall') or defense_bonus_pct is not null),
  add constraint card_templates_village_attack_check
    check (category <> 'village' or attack_bonus_pct is null),
  add constraint card_templates_wall_attack_required_check
    check (category <> 'wall' or attack_bonus_pct is not null),
  add constraint card_templates_boost_shape_check
    check (
      category <> 'boost'
      or (
        boost_type in ('territorial', 'offensive')
        and effect_kind in ('stat_multiplier', 'instant_effect')
        and unit_type is null
        and base_stats is null
        and defense_bonus_pct is null
        and attack_bonus_pct is null
      )
    ),
  add constraint card_templates_boost_effect_check
    check (
      category <> 'boost'
      or (
        (effect_kind = 'stat_multiplier'
          and instant_effect_kind is null
          and coalesce(pct_str, 0) + coalesce(pct_lng, 0) + coalesce(pct_def, 0) + coalesce(pct_hp, 0) > 0)
        or
        (effect_kind = 'instant_effect'
          and instant_effect_kind = 'steal_unit'
          and pct_str is null and pct_lng is null and pct_def is null and pct_hp is null)
      )
    );

insert into card_templates (
  id,
  category,
  unit_type,
  rank,
  name,
  flavor_text,
  base_stats,
  defense_bonus_pct,
  attack_bonus_pct,
  total_supply
)
values
  ('wall-common', 'wall', null, 'common', 'Hradby (common)', 'Pevné kamenné hradby dávají obráncům skromnou, ale univerzální ochranu i palebnou oporu.', null, 5, 5, 45),
  ('wall-uncommon', 'wall', null, 'uncommon', 'Hradby (uncommon)', 'Rozšířené opevnění zpevňuje obrannou linii a pomáhá i střelcům na hradbách.', null, 10, 10, 23),
  ('wall-rare', 'wall', null, 'rare', 'Hradby (rare)', 'Důkladně vystavěné hradby dávají obráncům citelnou výhodu v obraně i dálkovém boji.', null, 17, 17, 11),
  ('wall-epic', 'wall', null, 'epic', 'Hradby (epic)', 'Mohutné městské opevnění chrání vojsko a současně zvyšuje sílu střelby z výšin.', null, 27, 27, 4),
  ('wall-legend', 'wall', null, 'legend', 'Hradby (legend)', 'Legendární hradby mění území v téměř nedobytnou baštu a zvedají obráncům morálku i palebnou sílu.', null, 40, 40, 2)
on conflict (id) do nothing;

alter table territories
  drop constraint if exists territories_wall_exclusive_check;

alter table territories
  add constraint territories_wall_exclusive_check
    check (wall_rank is null or (castle_rank is null and village_rank is null));

create or replace function build_structure(territory_id integer, card_instance_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  tmpl_category text;
  tmpl_rank text;
  existing_rank text;
begin
  perform resolve_due_battles();
  perform resolve_due_movements();

  if exists (
    select 1 from territories where id = territory_id and battle_locked_by is not null
  ) then
    raise exception 'territory is currently battle-locked';
  end if;

  perform id from territories where id = territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own this territory';
  end if;

  select ct.category, ct.rank into tmpl_category, tmpl_rank
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = card_instance_id and ci.owner_id = caller;
  if not found then
    raise exception 'caller does not own this card instance';
  end if;
  if tmpl_category not in ('castle', 'village', 'wall') then
    raise exception 'card instance is not a Castle/Village/Wall structure card';
  end if;

  if tmpl_category = 'castle' then
    select castle_rank into existing_rank from territories where id = territory_id;
  elsif tmpl_category = 'village' then
    select village_rank into existing_rank from territories where id = territory_id;
  else
    select wall_rank into existing_rank from territories where id = territory_id;
  end if;
  if existing_rank is not null then
    raise exception 'territory already has a % structure', tmpl_category;
  end if;

  if tmpl_category = 'wall' then
    if exists (
      select 1 from territories
      where id = territory_id and (castle_rank is not null or village_rank is not null)
    ) then
      raise exception 'territory already has a Castle or Village; cannot build Walls';
    end if;
  else
    if exists (
      select 1 from territories
      where id = territory_id and wall_rank is not null
    ) then
      raise exception 'territory already has Walls; cannot build Castle/Village';
    end if;
  end if;

  if tmpl_category = 'castle' then
    update territories set castle_rank = tmpl_rank where id = territory_id;
  elsif tmpl_category = 'village' then
    update territories set village_rank = tmpl_rank where id = territory_id;
  else
    update territories set wall_rank = tmpl_rank where id = territory_id;
  end if;

  delete from card_instances where instance_id = card_instance_id;
end;
$$;

-- The signature of _compute_effective_stats/_compute_battle_effective_stats
-- changed here (added p_wall_rank). Postgres treats a different parameter
-- list as a brand-new overload rather than a replacement, so the pre-wall
-- 6/9-param versions must be dropped explicitly -- otherwise both overloads
-- coexist and any caller still invoking the old arg count becomes an
-- "is not unique" ambiguous-call error once the new default-valued overload
-- can also match that same arg count.
drop function if exists _compute_effective_stats(jsonb, text, nation_id, boolean, text, text);
drop function if exists _compute_battle_effective_stats(uuid, text, integer, jsonb, text, nation_id, boolean, text, text);

create or replace function _compute_effective_stats(
  p_base_stats jsonb,
  p_rank text,
  p_nation nation_id,
  p_is_defender boolean,
  p_castle_rank text,
  p_village_rank text,
  p_wall_rank text default null
) returns table (hp integer, str integer, lng integer, def integer)
language plpgsql
security definer
as $$
declare
  v_mult numeric;
  v_hp numeric; v_str numeric; v_lng numeric; v_def numeric;
  v_def_bonus_pct numeric := 0;
  v_atk_bonus_pct numeric := 0;
begin
  v_mult := case p_rank
    when 'common' then 1.0 when 'uncommon' then 1.15
    when 'rare' then 1.35 when 'epic' then 1.6 when 'legend' then 2.0 end;

  -- Step 1: rank scaling, rounded immediately (mirrors applyRank).
  v_hp := greatest(0, round((p_base_stats->>'hp')::numeric * v_mult));
  v_str := greatest(0, round((p_base_stats->>'str')::numeric * v_mult));
  v_lng := greatest(0, round((p_base_stats->>'lng')::numeric * v_mult));
  v_def := greatest(0, round((p_base_stats->>'def')::numeric * v_mult));

  -- Step 2: structure bonus, defender side only (unrounded intermediate).
  if p_is_defender then
    v_def_bonus_pct := coalesce(case p_village_rank
        when 'common' then 10 when 'uncommon' then 20 when 'rare' then 35
        when 'epic' then 55 when 'legend' then 80 else 0 end, 0)
      + coalesce(case p_castle_rank
        when 'common' then 20 when 'uncommon' then 35 when 'rare' then 55
        when 'epic' then 80 when 'legend' then 120 else 0 end, 0)
      + coalesce(case p_wall_rank
        when 'common' then 5 when 'uncommon' then 10 when 'rare' then 17
        when 'epic' then 27 when 'legend' then 40 else 0 end, 0);

    v_atk_bonus_pct := coalesce(case p_castle_rank
      when 'common' then 10 when 'uncommon' then 20 when 'rare' then 35
      when 'epic' then 55 when 'legend' then 80 else 0 end, 0)
      + coalesce(case p_wall_rank
        when 'common' then 5 when 'uncommon' then 10 when 'rare' then 17
        when 'epic' then 27 when 'legend' then 40 else 0 end, 0);

    if v_atk_bonus_pct > 0 then
      v_str := v_str * (1 + v_atk_bonus_pct / 100.0);
      v_lng := v_lng * (1 + v_atk_bonus_pct / 100.0);
    end if;

    v_def := v_def * (1 + v_def_bonus_pct / 100.0);
  end if;

  -- Step 3: nation perk (unrounded intermediate). Null nation (NPC) = no perk.
  case p_nation
    when 'england' then v_lng := v_lng * 1.15;
    when 'francia' then v_str := v_str * 1.15;
    when 'hre' then v_def := v_def * 1.15;
    when 'byzantium' then v_hp := v_hp * 1.15;
    else null; -- mongol_horde, scandinavia, or null (NPC): no combat perk
  end case;

  -- Step 4: single final rounding.
  return query select
    greatest(0, round(v_hp))::integer,
    greatest(0, round(v_str))::integer,
    greatest(0, round(v_lng))::integer,
    greatest(0, round(v_def))::integer;
end;
$$;

create or replace function _compute_battle_effective_stats(
  p_battle_id uuid,
  p_side text,
  p_round_number integer,
  p_base_stats jsonb,
  p_rank text,
  p_nation nation_id,
  p_is_defender boolean,
  p_castle_rank text,
  p_village_rank text,
  p_wall_rank text default null
)
returns table (str integer, lng integer, def integer, hp integer)
language plpgsql
security definer
as $$
declare
  v_eff record;
  v_boost_instance_id uuid;
  v_active_from integer;
  v_template record;
begin
  select * into v_eff from _compute_effective_stats(
    p_base_stats,
    p_rank,
    p_nation,
    p_is_defender,
    p_castle_rank,
    p_village_rank,
    p_wall_rank
  );

  if p_side = 'attacker' then
    select attacker_boost_instance_id, attacker_boost_active_from_round
      into v_boost_instance_id, v_active_from
    from battles
    where id = p_battle_id;
  else
    select defender_boost_instance_id, defender_boost_active_from_round
      into v_boost_instance_id, v_active_from
    from battles
    where id = p_battle_id;
  end if;

  if v_boost_instance_id is null or v_active_from is null or p_round_number < v_active_from then
    return query select v_eff.str, v_eff.lng, v_eff.def, v_eff.hp;
    return;
  end if;

  select
    ct.effect_kind,
    _scale_boost_pct(ct.pct_str, ct.rank) as pct_str,
    _scale_boost_pct(ct.pct_lng, ct.rank) as pct_lng,
    _scale_boost_pct(ct.pct_def, ct.rank) as pct_def,
    _scale_boost_pct(ct.pct_hp, ct.rank) as pct_hp
  into v_template
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = v_boost_instance_id;

  if not found or v_template.effect_kind <> 'stat_multiplier' then
    return query select v_eff.str, v_eff.lng, v_eff.def, v_eff.hp;
    return;
  end if;

  return query
  select
    round(v_eff.str * (100 + coalesce(v_template.pct_str, 0)) / 100.0)::integer,
    round(v_eff.lng * (100 + coalesce(v_template.pct_lng, 0)) / 100.0)::integer,
    round(v_eff.def * (100 + coalesce(v_template.pct_def, 0)) / 100.0)::integer,
    round(v_eff.hp * (100 + coalesce(v_template.pct_hp, 0)) / 100.0)::integer;
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
      t.wall_rank,
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
    case when p_is_defender then ctx.village_rank else null end,
    case when p_is_defender then ctx.wall_rank else null end
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
  v_wall_rank text;
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

  select castle_rank, village_rank, wall_rank into v_castle_rank, v_village_rank, v_wall_rank
  from territories where id = v_territory_id;

  select nation into v_defender_nation
  from players
  where id = v_defender_owner;

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select * into v_atk_eff from _compute_effective_stats(
    v_atk_base, v_atk_rank, v_atk_nation, false, null, null, null);

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
      v_candidate.base_stats, v_candidate.rank, v_defender_nation, true, v_castle_rank, v_village_rank, v_wall_rank);

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
  v_castle_rank text; v_village_rank text; v_wall_rank text;
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

  select castle_rank, village_rank, wall_rank into v_castle_rank, v_village_rank, v_wall_rank
  from territories where id = v_battle.territory_id;

  select * into v_atk_eff from _compute_battle_effective_stats(
    p_battle_id, 'attacker', v_next_round, v_atk_base, v_atk_rank, v_atk_nation, false, null, null
  );
  select * into v_def_eff from _compute_battle_effective_stats(
    p_battle_id, 'defender', v_next_round, v_def_base, v_def_rank, v_def_nation, true, v_castle_rank, v_village_rank, v_wall_rank
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
    v_structure_category := case
      when random() < 1.0/3 then 'castle'
      when random() < 0.5 then 'village'
      else 'wall'
    end;
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
        v_structure_category := case
          when random() < 1.0/3 then 'castle'
          when random() < 0.5 then 'village'
          else 'wall'
        end;
        insert into card_instances (template_id, owner_id, stationed_territory_id, status)
        values (v_structure_category || '-common', null, null, 'stationed')
        returning instance_id into v_instance_id;
        perform _deposit_or_grant_card(v_winner_id, v_instance_id);
      end if;
    end if;
  end if;
end;
$$;

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
        and t.castle_rank is null and t.village_rank is null and t.wall_rank is null
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

drop function if exists get_viewport(smallint, smallint, smallint, smallint);

create or replace function get_viewport(x1 smallint, y1 smallint, x2 smallint, y2 smallint)
returns table (
  id integer,
  x smallint,
  y smallint,
  difficulty smallint,
  castle_rank text,
  village_rank text,
  wall_rank text,
  owner_id uuid,
  owner_is_npc boolean,
  owner_display_name text,
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
      t.id, t.x, t.y, t.difficulty, t.castle_rank, t.village_rank, t.wall_rank, t.owner_id,
      coalesce(owner_player.is_npc, false),
      owner_player.display_name,
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
  wall_rank text,
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
      t.x, t.y, t.owner_id, coalesce(owner_player.is_npc, false), t.castle_rank, t.village_rank, t.wall_rank, t.claim_locked_by,
      t.battle_locked_by,
      (select b.id from battles b
       where b.territory_id = t.id and b.status not in ('resolved', 'expired')
       limit 1) as battle_id
    from territories t
    left join players owner_player on owner_player.id = t.owner_id
    where t.owner_id is not null or t.castle_rank is not null
       or t.village_rank is not null or t.wall_rank is not null or t.claim_locked_by is not null
       or t.battle_locked_by is not null;
end;
$$;
