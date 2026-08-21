-- Troop lending for coalition allies.

alter table card_instances
  add column if not exists loaned_from_id uuid references players(id),
  add column if not exists loan_return_at timestamptz;

create index if not exists card_instances_loan_return_at_idx
  on card_instances (loan_return_at)
  where status = 'stationed' and loan_return_at is not null;

alter table troop_movements
  add column if not exists loan_duration_hours numeric;

alter table troop_movements
  drop constraint if exists troop_movements_kind_check;

alter table troop_movements
  add constraint troop_movements_kind_check
  check (kind in ('transfer', 'claim', 'attack', 'loan', 'loan_return'));

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
      'attack_cancelled',
      'loan_arrived',
      'loan_returned',
      'loan_auto_recalled'
    )
  );

create or replace function _deposit_or_grant_card(
  p_player_id uuid,
  p_instance_id uuid,
  p_status text default 'stationed'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xp integer;
  v_level integer;
  v_deck_count integer;
  v_deposit_count integer;
begin
  perform _expire_deposit(p_player_id);

  select xp
  into v_xp
  from players
  where id = p_player_id
  for update;

  if not found then
    raise exception 'player % not found', p_player_id;
  end if;

  v_level := _level_for_xp(v_xp);

  select count(*)
  into v_deck_count
  from card_instances
  where owner_id = p_player_id
    and status in ('stationed', 'in_transit');

  if v_deck_count < _deck_limit(v_level) then
    update card_instances
    set owner_id = p_player_id,
        status = p_status,
        deposit_expires_at = null,
        loaned_from_id = null,
        loan_return_at = null
    where instance_id = p_instance_id;
    return;
  end if;

  select count(*)
  into v_deposit_count
  from card_instances
  where owner_id = p_player_id
    and status = 'deposit';

  if v_deposit_count < _deposit_limit(v_level) then
    update card_instances
    set owner_id = p_player_id,
        stationed_territory_id = null,
        status = 'deposit',
        deposit_expires_at = now() + interval '3 days',
        loaned_from_id = null,
        loan_return_at = null
    where instance_id = p_instance_id;
    return;
  end if;

  update card_instances
  set owner_id = p_player_id,
      stationed_territory_id = null,
      deposit_expires_at = null,
      loaned_from_id = null,
      loan_return_at = null
  where instance_id = p_instance_id;

  perform _return_card(p_instance_id, 'deposit_overflow');
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
  v_territory_difficulty smallint;
  v_garrison_target_size integer;
  v_garrison_count integer;
  v_weakest_garrison_card uuid;
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
  if v_winner_owner is not null then
    perform _deposit_or_grant_card(v_winner_owner, v_loser_card);
  else
    select difficulty into v_territory_difficulty
    from territories where id = v_battle.territory_id;

    v_garrison_target_size := _npc_garrison_target_size(v_territory_difficulty);

    select count(*) into v_garrison_count
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id is null
      and ct.category = 'unit';

    if v_garrison_count < v_garrison_target_size then
      update card_instances
      set owner_id = null,
          stationed_territory_id = v_battle.territory_id,
          status = 'stationed',
          deposit_expires_at = null,
          loaned_from_id = null,
          loan_return_at = null
      where instance_id = v_loser_card;
    else
      select ci.instance_id into v_weakest_garrison_card
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = v_battle.territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
        and ci.instance_id <> v_winner_card
      order by _army_power(array[ci.instance_id]) asc
      limit 1;

      if v_weakest_garrison_card is not null
         and _army_power(array[v_loser_card]) > _army_power(array[v_weakest_garrison_card]) then
        begin
          delete from card_instances where instance_id = v_weakest_garrison_card;
        exception
          when foreign_key_violation then
            update card_instances
            set owner_id = null,
                stationed_territory_id = null,
                status = 'stationed',
                deposit_expires_at = null,
                loaned_from_id = null,
                loan_return_at = null
            where instance_id = v_weakest_garrison_card;
        end;

        update card_instances
        set owner_id = null,
            stationed_territory_id = v_battle.territory_id,
            status = 'stationed',
            deposit_expires_at = null,
            loaned_from_id = null,
            loan_return_at = null
        where instance_id = v_loser_card;
      else
        perform _return_card(v_loser_card, 'wild_garrison_full');
      end if;
    end if;
  end if;

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

drop function if exists get_visible_territory_cards(integer);

create or replace function get_visible_territory_cards(p_territory_id integer)
returns table (
  instance_id uuid,
  template_id text,
  owner_id uuid,
  stationed_territory_id integer,
  status text,
  loaned_from_id uuid,
  loan_return_at timestamptz,
  loaned_from_display_name text,
  is_masked boolean,
  card_templates jsonb
)
language plpgsql
security definer
set search_path = public
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
    ci.loaned_from_id,
    ci.loan_return_at,
    lender.display_name,
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
  left join players lender on lender.id = ci.loaned_from_id
  where ci.stationed_territory_id = p_territory_id
  order by ct.category, ct.rank, ct.name nulls last, ci.instance_id;
end;
$$;

create or replace function lend_troops(
  p_destination_territory_id integer,
  p_card_instance_ids uuid[],
  p_duration_hours numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  v_origin_territory_id integer;
  v_origin_x smallint;
  v_origin_y smallint;
  v_dest_x smallint;
  v_dest_y smallint;
  v_destination_owner uuid;
  v_distance numeric;
  v_group_speed numeric;
  v_speed_mult numeric;
  v_transfer_hrs numeric;
  v_arrives_at timestamptz;
  v_matching_count integer;
  v_origin_count integer;
  v_movement_id uuid;
begin
  perform resolve_due_movements();
  perform resolve_due_battles();

  if caller is null then
    raise exception 'not authenticated';
  end if;

  if p_card_instance_ids is null or array_length(p_card_instance_ids, 1) is null then
    raise exception 'p_card_instance_ids must be non-empty';
  end if;

  if p_duration_hours < 0 or p_duration_hours > 336 then
    raise exception 'p_duration_hours must be between 0 and 336';
  end if;

  select nation into caller_nation
  from players
  where id = caller;

  select t.owner_id, t.x, t.y
  into v_destination_owner, v_dest_x, v_dest_y
  from territories t
  where t.id = p_destination_territory_id
  for update;

  if not found or v_destination_owner is null then
    raise exception 'destination territory must be owned by a coalition ally';
  end if;

  if v_destination_owner = caller then
    raise exception 'cannot lend troops to your own territory';
  end if;

  if not exists (
    select 1
    from coalition_members cm_self
    join coalition_members cm_other
      on cm_other.coalition_id = cm_self.coalition_id
     and cm_other.player_id = v_destination_owner
    join coalitions c
      on c.id = cm_self.coalition_id
    where cm_self.player_id = caller
      and c.disbanded_at is null
  ) then
    raise exception 'destination territory must be owned by a coalition ally';
  end if;

  if exists (
    select 1
    from battles
    where territory_id = p_destination_territory_id
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'cannot lend troops to a territory with an unresolved battle';
  end if;

  with locked_cards as (
    select ci.instance_id, ci.stationed_territory_id
    from card_instances ci
    join card_templates ct
      on ct.id = ci.template_id
     and ct.category = 'unit'
    where ci.instance_id = any(p_card_instance_ids)
      and ci.owner_id = caller
      and ci.status = 'stationed'
      and ci.loaned_from_id is null
    for update of ci
  )
  select count(*), min(stationed_territory_id), count(distinct stationed_territory_id)
  into v_matching_count, v_origin_territory_id, v_origin_count
  from locked_cards;

  if v_matching_count <> array_length(p_card_instance_ids, 1) then
    raise exception 'one or more card instances are not eligible to lend';
  end if;

  if v_origin_count <> 1 or v_origin_territory_id is null then
    raise exception 'all lent cards must come from the same territory';
  end if;

  select x, y
  into v_origin_x, v_origin_y
  from territories
  where id = v_origin_territory_id
    and owner_id = caller;

  if not found then
    raise exception 'caller does not own the selected origin territory';
  end if;

  v_distance := greatest(abs(v_dest_x - v_origin_x), abs(v_dest_y - v_origin_y));
  v_group_speed := _min_group_speed(p_card_instance_ids);
  v_speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(v_group_speed, 5.0)));
  v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);
  v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

  insert into troop_movements (
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    transfer_arrives_at,
    loan_duration_hours
  )
  values (
    caller,
    'loan',
    v_origin_territory_id,
    p_destination_territory_id,
    v_arrives_at,
    p_duration_hours
  )
  returning id into v_movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select v_movement_id, unnest(p_card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(p_card_instance_ids);
end;
$$;

create or replace function _recall_loan_core(
  p_caller uuid,
  p_card_instance_id uuid
)
returns table (
  lender_id uuid,
  lender_display_name text,
  borrower_id uuid,
  borrower_display_name text,
  loan_territory_id integer,
  loan_territory_x smallint,
  loan_territory_y smallint,
  loan_territory_name text,
  lender_home_territory_id integer,
  lender_home_territory_x smallint,
  lender_home_territory_y smallint,
  lender_home_territory_name text,
  return_movement_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card record;
  v_lender_nation nation_id;
  v_distance numeric;
  v_group_speed numeric;
  v_speed_mult numeric;
  v_transfer_hrs numeric;
  v_arrives_at timestamptz;
begin
  select
    ci.instance_id,
    ci.owner_id as borrower_id_value,
    ci.loaned_from_id as lender_id_value,
    ci.stationed_territory_id as territory_id_value,
    t.x as territory_x_value,
    t.y as territory_y_value,
    t.name as territory_name_value,
    borrower.display_name as borrower_name_value,
    lender.display_name as lender_name_value,
    lender.nation as lender_nation_value
  into v_card
  from card_instances ci
  join territories t on t.id = ci.stationed_territory_id
  left join players borrower on borrower.id = ci.owner_id
  left join players lender on lender.id = ci.loaned_from_id
  where ci.instance_id = p_card_instance_id
  for update of ci;

  if not found then
    raise exception 'loaned card not found';
  end if;

  if v_card.lender_id_value is null or v_card.lender_id_value <> p_caller then
    raise exception 'caller does not own this loan';
  end if;

  if v_card.borrower_id_value is null then
    raise exception 'this loan is no longer active';
  end if;

  if v_card.territory_id_value is null then
    raise exception 'loaned card is not stationed on a territory';
  end if;

  if not exists (
    select 1
    from card_instances ci
    where ci.instance_id = p_card_instance_id
      and ci.status = 'stationed'
      and ci.loaned_from_id = p_caller
      and ci.owner_id is not null
  ) then
    raise exception 'only a stationed active loan can be recalled';
  end if;

  lender_id := v_card.lender_id_value;
  lender_display_name := v_card.lender_name_value;
  borrower_id := v_card.borrower_id_value;
  borrower_display_name := v_card.borrower_name_value;
  loan_territory_id := v_card.territory_id_value;
  loan_territory_x := v_card.territory_x_value;
  loan_territory_y := v_card.territory_y_value;
  loan_territory_name := v_card.territory_name_value;

  select id, x, y, name
  into lender_home_territory_id, lender_home_territory_x, lender_home_territory_y, lender_home_territory_name
  from territories
  where owner_id = lender_id
    and is_home = true
  for update;

  if lender_home_territory_id is null then
    raise exception 'lender home territory not found';
  end if;

  v_lender_nation := v_card.lender_nation_value;
  v_distance := greatest(abs(lender_home_territory_x - loan_territory_x), abs(lender_home_territory_y - loan_territory_y));
  v_group_speed := _min_group_speed(array[p_card_instance_id]);
  v_speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(v_group_speed, 5.0)));
  v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult)
    * (case when v_lender_nation = 'mongol_horde' then 0.75 else 1.0 end);
  v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

  insert into troop_movements (
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    started_at,
    transfer_arrives_at
  )
  values (
    lender_id,
    'loan_return',
    loan_territory_id,
    lender_home_territory_id,
    now(),
    v_arrives_at
  )
  returning id into return_movement_id;

  insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
  values (return_movement_id, p_card_instance_id, loan_territory_id);

  update card_instances
  set owner_id = lender_id,
      status = 'in_transit',
      loaned_from_id = null,
      loan_return_at = null
  where instance_id = p_card_instance_id;

  return next;
end;
$$;

create or replace function recall_loan(p_card_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_ctx record;
begin
  perform resolve_due_movements();
  perform resolve_due_battles();

  if caller is null then
    raise exception 'not authenticated';
  end if;

  select *
  into v_ctx
  from _recall_loan_core(caller, p_card_instance_id);

  perform _notify(
    v_ctx.lender_id,
    'loan_returned',
    jsonb_build_object(
      'territory_id', v_ctx.loan_territory_id,
      'territory_x', v_ctx.loan_territory_x::integer,
      'territory_y', v_ctx.loan_territory_y::integer,
      'territory_name', v_ctx.loan_territory_name,
      'other_player_id', v_ctx.borrower_id,
      'other_display_name', coalesce(v_ctx.borrower_display_name, 'Neznámý hráč')
    )
  );
end;
$$;

create or replace function get_my_loans()
returns table (
  destination_territory_id integer,
  destination_territory_x smallint,
  destination_territory_y smallint,
  destination_territory_name text,
  borrower_id uuid,
  borrower_display_name text,
  loan_return_at timestamptz,
  card_instance_ids uuid[],
  card_names text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();
  perform resolve_due_battles();

  return query
  select
    ci.stationed_territory_id,
    t.x,
    t.y,
    t.name,
    ci.owner_id,
    borrower.display_name,
    ci.loan_return_at,
    array_agg(ci.instance_id order by ci.instance_id),
    array_agg(coalesce(ct.name, ci.template_id) order by ci.instance_id)
  from card_instances ci
  join territories t on t.id = ci.stationed_territory_id
  join players borrower on borrower.id = ci.owner_id
  join card_templates ct on ct.id = ci.template_id
  where ci.loaned_from_id = v_player_id
    and ci.owner_id is not null
    and ci.status = 'stationed'
  group by
    ci.stationed_territory_id,
    t.x,
    t.y,
    t.name,
    ci.owner_id,
    borrower.display_name,
    ci.loan_return_at
  order by ci.loan_return_at nulls last, ci.stationed_territory_id;
end;
$$;

create or replace function resolve_due_movements()
returns void
language plpgsql
security definer
set search_path = public
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
  v_loan_arrival record;
  v_due_loan record;
  v_loan_ctx record;
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

  for v_loan_arrival in
    with completed_loans as (
      update troop_movements
      set status = 'completed'
      where status = 'in_transit'
        and transfer_arrives_at <= now()
        and kind = 'loan'
      returning id, player_id, destination_territory_id, loan_duration_hours
    )
    select
      cl.id,
      cl.player_id,
      cl.destination_territory_id,
      cl.loan_duration_hours,
      t.owner_id as borrower_id,
      t.x as territory_x,
      t.y as territory_y,
      t.name as territory_name,
      lender.display_name as lender_display_name
    from completed_loans cl
    join territories t on t.id = cl.destination_territory_id
    left join players lender on lender.id = cl.player_id
  loop
    update card_instances ci
    set owner_id = v_loan_arrival.borrower_id,
        loaned_from_id = v_loan_arrival.player_id,
        loan_return_at = now() + (coalesce(v_loan_arrival.loan_duration_hours, 0) || ' hours')::interval
    from troop_movement_units tmu
    where tmu.movement_id = v_loan_arrival.id
      and ci.instance_id = tmu.card_instance_id;

    if v_loan_arrival.borrower_id is not null then
      perform _notify(
        v_loan_arrival.borrower_id,
        'loan_arrived',
        jsonb_build_object(
          'territory_id', v_loan_arrival.destination_territory_id,
          'territory_x', v_loan_arrival.territory_x::integer,
          'territory_y', v_loan_arrival.territory_y::integer,
          'territory_name', v_loan_arrival.territory_name,
          'other_player_id', v_loan_arrival.player_id,
          'other_display_name', coalesce(v_loan_arrival.lender_display_name, 'Neznámý hráč')
        )
      );
    end if;
  end loop;

  update troop_movements
  set status = 'completed'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'loan_return';

  update troop_movements
  set status = 'occupying'
  where status = 'in_transit'
    and transfer_arrives_at <= now()
    and kind = 'claim';

  for v_due_loan in
    select ci.instance_id, ci.loaned_from_id
    from card_instances ci
    where ci.status = 'stationed'
      and ci.owner_id is not null
      and ci.loaned_from_id is not null
      and ci.loan_return_at is not null
      and ci.loan_return_at <= now()
    order by ci.loan_return_at, ci.instance_id
    for update of ci skip locked
  loop
    begin
      select *
      into v_loan_ctx
      from _recall_loan_core(v_due_loan.loaned_from_id, v_due_loan.instance_id);

      perform _notify(
        v_loan_ctx.lender_id,
        'loan_returned',
        jsonb_build_object(
          'territory_id', v_loan_ctx.loan_territory_id,
          'territory_x', v_loan_ctx.loan_territory_x::integer,
          'territory_y', v_loan_ctx.loan_territory_y::integer,
          'territory_name', v_loan_ctx.loan_territory_name,
          'other_player_id', v_loan_ctx.borrower_id,
          'other_display_name', coalesce(v_loan_ctx.borrower_display_name, 'Neznámý hráč')
        )
      );
    exception
      when others then
        raise log 'resolve_due_movements failed to auto-recall loaned card % (sqlstate %, error %)', v_due_loan.instance_id, SQLSTATE, SQLERRM;
    end;
  end loop;

  for v_completed_claim in
    update territories
    set owner_id = claim_locked_by,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null,
        battle_locked_by = null,
        is_home = false
    where claim_locked_by is not null
      and claim_occupation_completes_at <= now()
    returning id, owner_id
  loop
    insert into world_events (event_type, payload)
    select
      'territory_claimed',
      jsonb_build_object(
        'player_id', p.id,
        'player_display_name', p.display_name,
        'player_home_x', home.x::integer,
        'player_home_y', home.y::integer,
        'territory_id', t.id,
        'territory_x', t.x::integer,
        'territory_y', t.y::integer
      )
    from players p
    left join territories home
      on home.owner_id = p.id
     and home.is_home = true
    join territories t
      on t.id = v_completed_claim.id
    where p.id = v_completed_claim.owner_id;

    insert into card_xp (card_instance_id, xp, updated_at)
    select tmu.card_instance_id, card_xp.xp + 1, now()
    from troop_movements tm
    join troop_movement_units tmu on tmu.movement_id = tm.id
    join card_xp on card_xp.card_instance_id = tmu.card_instance_id
    where tm.kind = 'claim'
      and tm.status = 'occupying'
      and tm.destination_territory_id = v_completed_claim.id
    on conflict (card_instance_id)
    do update set xp = card_xp.xp + 1,
                  updated_at = now();

    update troop_movements
    set status = 'completed'
    where kind = 'claim'
      and status = 'occupying'
      and destination_territory_id = v_completed_claim.id;
  end loop;
end;
$$;
