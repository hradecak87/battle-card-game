-- Backlog #26: boost cards.

alter table card_templates
  add column if not exists boost_type text,
  add column if not exists effect_kind text,
  add column if not exists instant_effect_kind text,
  add column if not exists pct_str integer,
  add column if not exists pct_lng integer,
  add column if not exists pct_def integer,
  add column if not exists pct_hp integer;

alter table battles
  add column if not exists attacker_boost_instance_id uuid references card_instances(instance_id),
  add column if not exists defender_boost_instance_id uuid references card_instances(instance_id),
  add column if not exists attacker_boost_active_from_round integer,
  add column if not exists defender_boost_active_from_round integer;

alter table troop_movements
  add column if not exists boost_card_instance_id uuid references card_instances(instance_id);

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
    check (category in ('unit', 'castle', 'village', 'boost')),
  add constraint card_templates_rank_check
    check (rank in ('common', 'uncommon', 'rare', 'epic', 'legend')),
  add constraint card_templates_unit_shape_check
    check (category <> 'unit' or (unit_type is not null and base_stats is not null)),
  add constraint card_templates_non_unit_type_check
    check (category = 'unit' or unit_type is null),
  add constraint card_templates_structure_bonus_shape_check
    check (
      category in ('castle', 'village')
      or (defense_bonus_pct is null and attack_bonus_pct is null)
    ),
  add constraint card_templates_structure_bonus_required_check
    check (category not in ('castle', 'village') or defense_bonus_pct is not null),
  add constraint card_templates_village_attack_check
    check (category <> 'village' or attack_bonus_pct is null),
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

create or replace function _scale_boost_pct(p_base_pct integer, p_rank text)
returns integer
language sql
immutable
as $$
  select case
    when p_base_pct is null then null
    else round(
      p_base_pct * case p_rank
        when 'common' then 1.0
        when 'uncommon' then 1.15
        when 'rare' then 1.35
        when 'epic' then 1.6
        when 'legend' then 2.0
        else 1.0
      end
    )::integer
  end;
$$;

create or replace function _attach_attack_boost_to_battle()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.attacker_boost_instance_id is null then
    select boost_card_instance_id
    into new.attacker_boost_instance_id
    from troop_movements
    where id = new.movement_id;
  end if;
  return new;
end;
$$;

drop trigger if exists battles_attach_attack_boost on battles;
create trigger battles_attach_attack_boost
before insert on battles
for each row
execute function _attach_attack_boost_to_battle();

create or replace function _sync_attack_boost_movement()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.kind <> 'attack' or new.boost_card_instance_id is null then
    return new;
  end if;

  if new.status = 'completed' then
    update card_instances
    set stationed_territory_id = new.destination_territory_id,
        status = 'stationed'
    where instance_id = new.boost_card_instance_id;
  elsif new.status = 'cancelled' then
    update card_instances
    set stationed_territory_id = new.origin_territory_id,
        status = 'stationed'
    where instance_id = new.boost_card_instance_id;
  end if;

  return new;
end;
$$;

drop trigger if exists troop_movements_sync_attack_boost on troop_movements;
create trigger troop_movements_sync_attack_boost
after update of status on troop_movements
for each row
execute function _sync_attack_boost_movement();

create or replace function _compute_battle_effective_stats(
  p_battle_id uuid,
  p_side text,
  p_round_number integer,
  p_base_stats jsonb,
  p_rank text,
  p_nation nation_id,
  p_is_defender boolean,
  p_castle_rank text,
  p_village_rank text
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
    p_village_rank
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
        update card_instances set owner_id = v_battle.attacker_id where instance_id = v_target;
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
        update card_instances set owner_id = v_battle.defender_id where instance_id = v_target;
      end if;
    end if;
  end if;
end;
$$;

create or replace function get_visible_territory_cards(p_territory_id integer)
returns table (
  instance_id uuid,
  template_id text,
  owner_id uuid,
  stationed_territory_id integer,
  status text,
  is_masked boolean,
  card_templates jsonb
)
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
begin
  perform resolve_due_movements();
  perform resolve_due_battles();

  return query
  select
    ci.instance_id,
    case when ct.category = 'boost' and ci.owner_id is distinct from caller then 'masked-boost' else ci.template_id end,
    ci.owner_id,
    ci.stationed_territory_id,
    ci.status,
    (ct.category = 'boost' and ci.owner_id is distinct from caller) as is_masked,
    case
      when ct.category = 'boost' and ci.owner_id is distinct from caller then
        jsonb_build_object(
          'id', 'masked-boost',
          'name', null,
          'flavor_text', null,
          'rank', ct.rank,
          'category', ct.category,
          'unit_type', null,
          'base_stats', null,
          'total_supply', null,
          'defense_bonus_pct', null,
          'attack_bonus_pct', null,
          'boost_type', null,
          'effect_kind', null,
          'instant_effect_kind', null,
          'pct_str', null,
          'pct_lng', null,
          'pct_def', null,
          'pct_hp', null
        )
      else
        jsonb_build_object(
          'id', ct.id,
          'name', ct.name,
          'flavor_text', ct.flavor_text,
          'rank', ct.rank,
          'category', ct.category,
          'unit_type', ct.unit_type,
          'base_stats', ct.base_stats,
          'total_supply', ct.total_supply,
          'defense_bonus_pct', ct.defense_bonus_pct,
          'attack_bonus_pct', ct.attack_bonus_pct,
          'boost_type', ct.boost_type,
          'effect_kind', ct.effect_kind,
          'instant_effect_kind', ct.instant_effect_kind,
          'pct_str', ct.pct_str,
          'pct_lng', ct.pct_lng,
          'pct_def', ct.pct_def,
          'pct_hp', ct.pct_hp
        )
    end
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.stationed_territory_id = p_territory_id
  order by ct.category, ct.rank, ct.name nulls last, ci.instance_id;
end;
$$;

create or replace function activate_boost_card(
  p_battle_id uuid,
  p_card_instance_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_battle record;
  v_card record;
  v_caller_last_seen timestamptz;
  v_other_last_seen timestamptz;
begin
  perform resolve_due_battles();

  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle not found';
  end if;
  if v_battle.status <> 'active' then
    raise exception 'battle is not active';
  end if;

  if caller <> v_battle.attacker_id and caller <> v_battle.defender_id then
    raise exception 'caller is not a participant in this battle';
  end if;

  select last_seen_at into v_caller_last_seen from players where id = caller;
  select last_seen_at into v_other_last_seen
  from players
  where id = case when caller = v_battle.attacker_id then v_battle.defender_id else v_battle.attacker_id end;

  if v_caller_last_seen is null or v_caller_last_seen < now() - interval '2 minutes' then
    raise exception 'caller must be online to activate a boost card';
  end if;
  if v_other_last_seen is not null and v_other_last_seen < now() - interval '2 minutes' then
    raise exception 'both players must be online to activate a boost card';
  end if;

  select ci.instance_id, ci.owner_id, ci.stationed_territory_id, ci.status,
         ct.category, ct.boost_type
  into v_card
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_card_instance_id
  for update;

  if not found
     or v_card.owner_id <> caller
     or v_card.status <> 'stationed'
     or v_card.category <> 'boost' then
    raise exception 'card is not an eligible boost card';
  end if;

  if caller = v_battle.attacker_id then
    if v_battle.attacker_boost_active_from_round is not null then
      raise exception 'attacker already activated a boost card in this battle';
    end if;
    if v_card.boost_type <> 'offensive'
       or v_battle.attacker_boost_instance_id is distinct from p_card_instance_id
       or v_card.stationed_territory_id <> v_battle.territory_id then
      raise exception 'card is not the offensive boost attached to this battle';
    end if;

    update battles
    set attacker_boost_active_from_round = current_round + 1
    where id = p_battle_id;
  else
    if v_battle.defender_boost_active_from_round is not null then
      raise exception 'defender already activated a boost card in this battle';
    end if;
    if v_card.boost_type <> 'territorial' or v_card.stationed_territory_id <> v_battle.territory_id then
      raise exception 'card is not an eligible territorial boost for this battle';
    end if;

    update battles
    set defender_boost_instance_id = p_card_instance_id,
        defender_boost_active_from_round = current_round + 1
    where id = p_battle_id;
  end if;
end;
$$;

alter function declare_attack(integer, jsonb) rename to declare_attack_multi_origin_base_0025;
create or replace function declare_attack(
  target_territory_id integer,
  origin_groups jsonb,
  p_boost_card_instance_id uuid default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  movement_id uuid;
  v_result uuid;
  v_boost_origin integer;
begin
  if p_boost_card_instance_id is not null then
    select stationed_territory_id into v_boost_origin
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = p_boost_card_instance_id
      and ci.owner_id = caller
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

  v_result := public.declare_attack_multi_origin_base_0025(target_territory_id, origin_groups);

  if p_boost_card_instance_id is not null then
    update troop_movements
    set boost_card_instance_id = p_boost_card_instance_id
    where id = v_result;

    update card_instances
    set status = 'in_transit'
    where instance_id = p_boost_card_instance_id;
  end if;

  return v_result;
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
      values (v_unit_template_id, p_player_id, null, 'stationed');
    end loop;
  end if;

  if floor(v_new_level::numeric / 5) > floor(v_old_level::numeric / 5) then
    v_structure_category := case when random() < 0.5 then 'castle' else 'village' end;
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_structure_category || '-common', p_player_id, null, 'stationed');

    select id into v_boost_template_id
    from card_templates
    where category = 'boost' and rank in ('common', 'uncommon')
    order by random()
    limit 1;

    if v_boost_template_id is not null then
      insert into card_instances (template_id, owner_id, stationed_territory_id, status)
      values (v_boost_template_id, p_player_id, null, 'stationed');
    end if;
  end if;
end;
$$;

alter function _finalize_battle(uuid, text, boolean) rename to _finalize_battle_base_0025;

-- Reapply the current latest battle-finalize function with boost consumption
-- and the new 20% post-win boost reward.
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
  v_structure_category text;
  v_boost_template_id text;
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
          values (v_boost_template_id, v_winner_id, null, 'stationed');
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
  update card_instances set owner_id = v_winner_owner where instance_id = v_loser_card;

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

create or replace function get_battle(p_battle_id uuid)
returns table (
  battle jsonb,
  attacker_roster jsonb,
  defender_pool jsonb,
  rounds jsonb
)
language plpgsql
security definer
as $$
declare
  v_battle record;
  caller uuid := auth.uid();
begin
  perform resolve_due_battles();

  select * into v_battle from battles where id = p_battle_id;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  return query
  select
    (
      to_jsonb(b.*) || jsonb_build_object(
        'attacker_boost_cards',
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'instance_id', ci.instance_id,
            'owner_id', ci.owner_id,
            'status', ci.status,
            'template', case
              when b.attacker_boost_active_from_round is null and caller is distinct from b.attacker_id then
                jsonb_build_object(
                  'id', 'masked-boost',
                  'category', 'boost',
                  'rank', ct.rank,
                  'name', null,
                  'flavor_text', null,
                  'unit_type', null,
                  'base_stats', null,
                  'defense_bonus_pct', null,
                  'attack_bonus_pct', null,
                  'total_supply', null,
                  'minted_count', null,
                  'boost_type', null,
                  'effect_kind', null,
                  'instant_effect_kind', null,
                  'pct_str', null,
                  'pct_lng', null,
                  'pct_def', null,
                  'pct_hp', null,
                  'is_masked', true
                )
              else to_jsonb(ct.*) || jsonb_build_object('is_masked', false)
            end
          ))
          from card_instances ci
          join card_templates ct on ct.id = ci.template_id
          where ci.instance_id = b.attacker_boost_instance_id
            and ct.category = 'boost'
        ), '[]'::jsonb),
        'defender_boost_cards',
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'instance_id', ci.instance_id,
            'owner_id', ci.owner_id,
            'status', ci.status,
            'template', case
              when b.defender_boost_active_from_round is null and caller is distinct from b.defender_id then
                jsonb_build_object(
                  'id', 'masked-boost',
                  'category', 'boost',
                  'rank', ct.rank,
                  'name', null,
                  'flavor_text', null,
                  'unit_type', null,
                  'base_stats', null,
                  'defense_bonus_pct', null,
                  'attack_bonus_pct', null,
                  'total_supply', null,
                  'minted_count', null,
                  'boost_type', null,
                  'effect_kind', null,
                  'instant_effect_kind', null,
                  'pct_str', null,
                  'pct_lng', null,
                  'pct_def', null,
                  'pct_hp', null,
                  'is_masked', true
                )
              else to_jsonb(ct.*) || jsonb_build_object('is_masked', false)
            end
          ) order by ct.rank, ci.instance_id)
          from card_instances ci
          join card_templates ct on ct.id = ci.template_id
          where ci.stationed_territory_id = b.territory_id
            and ct.category = 'boost'
            and (
              (b.defender_id is not null and ci.owner_id = b.defender_id)
              or (b.defender_id is null and ci.owner_id is null)
            )
        ), '[]'::jsonb)
      )
    ) as battle,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'instance_id', ci.instance_id,
        'owner_id', ci.owner_id,
        'status', ci.status,
        'template', to_jsonb(ct.*),
        'is_resting', exists (
          select 1 from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
            and bur.resting_until_round >= b.current_round + 1
        ),
        'times_used', coalesce((
          select bur.times_used
          from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
        ), 0)
      ))
      from battle_attacker_roster bar
      join card_instances ci on ci.instance_id = bar.card_instance_id
      join card_templates ct on ct.id = ci.template_id
      where bar.battle_id = b.id
    ), '[]'::jsonb) as attacker_roster,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'instance_id', ci.instance_id,
        'owner_id', ci.owner_id,
        'status', ci.status,
        'template', to_jsonb(ct.*),
        'is_resting', exists (
          select 1 from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
            and bur.resting_until_round >= b.current_round + 1
        ),
        'times_used', coalesce((
          select bur.times_used
          from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
        ), 0)
      ))
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = b.territory_id
        and ct.category = 'unit'
        and (
          (b.defender_id is not null and ci.owner_id = b.defender_id)
          or (b.defender_id is null and ci.owner_id is null)
        )
    ), '[]'::jsonb) as defender_pool,
    coalesce((
      select jsonb_agg(
        (to_jsonb(br.*) || jsonb_build_object(
          'attacker_card', (
            select jsonb_build_object('instance_id', ci.instance_id, 'template', to_jsonb(ct.*))
            from card_instances ci join card_templates ct on ct.id = ci.template_id
            where ci.instance_id = br.attacker_card_instance_id
          ),
          'defender_card', (
            select jsonb_build_object('instance_id', ci.instance_id, 'template', to_jsonb(ct.*))
            from card_instances ci join card_templates ct on ct.id = ci.template_id
            where ci.instance_id = br.defender_card_instance_id
          )
        ))
        order by br.round_number
      )
      from battle_rounds br
      where br.battle_id = b.id
    ), '[]'::jsonb) as rounds
  from battles b
  where b.id = p_battle_id;
end;
$$;

-- Trading: boosts are now offer-able beside unit cards.
create or replace function validate_trade_cards(
  p_label text,
  p_card_ids uuid[],
  p_expected_owner uuid default null,
  p_require_eligibility boolean default true
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_id uuid;
  v_owner_id uuid;
  v_status text;
  v_stationed_territory_id integer;
  v_category text;
begin
  if coalesce(array_length(p_card_ids, 1), 0) = 0 then
    raise exception '% must not be empty', p_label;
  end if;

  foreach v_card_id in array p_card_ids loop
    select ci.owner_id, ci.status, ci.stationed_territory_id, ct.category
    into v_owner_id, v_status, v_stationed_territory_id, v_category
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.instance_id = v_card_id;

    if not found then
      raise exception '% card % not found', p_label, v_card_id;
    end if;

    if v_category not in ('unit', 'boost') then
      raise exception '% card % is not trade-eligible', p_label, v_card_id;
    end if;

    if p_expected_owner is not null and v_owner_id <> p_expected_owner then
      raise exception '% card % does not belong to the expected player', p_label, v_card_id;
    end if;

    if p_require_eligibility and v_status <> 'stationed' then
      raise exception '% card % is not trade-eligible (status %)', p_label, v_card_id, v_status;
    end if;
  end loop;
end;
$$;

create or replace function trade_cards_payload(p_card_ids uuid[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  with ids as (
    select card_id, ord
    from unnest(coalesce(p_card_ids, '{}'::uuid[])) with ordinality as t(card_id, ord)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'instance_id', ci.instance_id,
        'template_id', ci.template_id,
        'owner_id', ci.owner_id,
        'stationed_territory_id', ci.stationed_territory_id,
        'status', ci.status,
        'template_category', ct.category,
        'template_name', ct.name,
        'template_rank', ct.rank,
        'template_unit_type', ct.unit_type,
        'template_flavor_text', ct.flavor_text,
        'template_base_stats', ct.base_stats,
        'template_total_supply', ct.total_supply,
        'template_boost_type', ct.boost_type,
        'template_effect_kind', ct.effect_kind,
        'template_instant_effect_kind', ct.instant_effect_kind,
        'template_pct_str', ct.pct_str,
        'template_pct_lng', ct.pct_lng,
        'template_pct_def', ct.pct_def,
        'template_pct_hp', ct.pct_hp
      )
      order by ids.ord
    ),
    '[]'::jsonb
  )
  from ids
  join card_instances ci on ci.instance_id = ids.card_id
  join card_templates ct on ct.id = ci.template_id;
$$;
