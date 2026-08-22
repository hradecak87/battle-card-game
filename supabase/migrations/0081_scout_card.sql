-- Scout card feature: schema, scouting RPCs, resolution, masking, and rewards.

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
    check (category in ('unit', 'castle', 'village', 'wall', 'boost', 'scout')),
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
    ),
  add constraint card_templates_scout_shape_check
    check (
      category <> 'scout'
      or (
        unit_type is null
        and defense_bonus_pct is null
        and attack_bonus_pct is null
        and base_stats is not null
        and (base_stats->>'str')::numeric = 0
        and (base_stats->>'lng')::numeric = 0
        and (base_stats->>'def')::numeric = 0
        and (base_stats->>'hp')::numeric = 0
        and (base_stats->>'speed')::numeric = 30
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
values (
  'scout',
  'scout',
  null,
  'uncommon',
  'Zvěd',
  'Rychlý jezdec bez bojové hodnoty, vyslaný jen za jediným účelem: zjistit, co skrývá nepřátelské území.',
  '{"str": 0, "lng": 0, "def": 0, "hp": 0, "speed": 30}'::jsonb,
  null,
  null,
  null
)
on conflict (id) do nothing;

alter table troop_movements
  drop constraint if exists troop_movements_kind_check;

alter table troop_movements
  add constraint troop_movements_kind_check
  check (kind in ('transfer', 'claim', 'attack', 'loan', 'loan_return', 'scout', 'scout_return', 'scout_peek'));

alter table troop_movements
  add column if not exists scout_target_movement_id uuid null references troop_movements(id);

create table if not exists scout_reports (
  id bigserial primary key,
  scout_player_id uuid not null references players(id),
  target_territory_id integer references territories(id),
  target_movement_id uuid references troop_movements(id),
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null,
  snapshot jsonb not null,
  check (
    (target_territory_id is not null and target_movement_id is null)
    or (target_territory_id is null and target_movement_id is not null)
  )
);

create unique index if not exists scout_reports_territory_unique_idx
  on scout_reports (scout_player_id, target_territory_id)
  where target_territory_id is not null;

create unique index if not exists scout_reports_movement_unique_idx
  on scout_reports (scout_player_id, target_movement_id)
  where target_movement_id is not null;

create index if not exists scout_reports_expiry_idx on scout_reports (expires_at);

alter table scout_reports enable row level security;

drop policy if exists scout_reports_select_own on scout_reports;
create policy scout_reports_select_own on scout_reports
  for select using (scout_player_id = auth.uid());

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
      'loan_auto_recalled',
      'scout_killed',
      'scout_detected',
      'scout_returned'
    )
  );

create or replace function send_scout(
  p_target_territory_id integer,
  p_card_instance_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_home_id integer;
  v_target_owner uuid;
  v_from_x smallint;
  v_from_y smallint;
  v_to_x smallint;
  v_to_y smallint;
  v_distance numeric;
  v_speed_mult numeric;
  v_transfer_hrs numeric;
  v_arrives_at timestamptz;
  v_movement_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();

  select id, x, y
  into v_home_id, v_from_x, v_from_y
  from territories
  where owner_id = v_caller
    and is_home = true;
  if v_home_id is null then
    raise exception 'no home territory found';
  end if;

  perform 1
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_card_instance_id
    and ci.owner_id = v_caller
    and ci.status = 'stationed'
    and ci.stationed_territory_id = v_home_id
    and ct.category = 'scout'
  for update of ci;
  if not found then
    raise exception 'card is not an available scout stationed at your home territory';
  end if;

  select owner_id, x, y
  into v_target_owner, v_to_x, v_to_y
  from territories
  where id = p_target_territory_id;
  if v_to_x is null then
    raise exception 'target territory % not found', p_target_territory_id;
  end if;
  if v_target_owner = v_caller then
    raise exception 'cannot scout your own territory';
  end if;

  v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
  v_speed_mult := least(3.0, greatest(0.4, 5.0 / 30.0));
  v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult);
  v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

  insert into troop_movements (
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    transfer_arrives_at
  )
  values (
    v_caller,
    'scout',
    v_home_id,
    p_target_territory_id,
    v_arrives_at
  )
  returning id into v_movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  values (v_movement_id, p_card_instance_id);

  update card_instances
  set status = 'in_transit'
  where instance_id = p_card_instance_id;

  return v_movement_id;
end;
$$;

create or replace function send_scout_peek(
  p_target_movement_id uuid,
  p_card_instance_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_home_id integer;
  v_target_destination_id integer;
  v_movement_id uuid;
  v_delay_hrs numeric;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();

  select id
  into v_home_id
  from territories
  where owner_id = v_caller
    and is_home = true;
  if v_home_id is null then
    raise exception 'no home territory found';
  end if;

  perform 1
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_card_instance_id
    and ci.owner_id = v_caller
    and ci.status = 'stationed'
    and ci.stationed_territory_id = v_home_id
    and ct.category = 'scout'
  for update of ci;
  if not found then
    raise exception 'card is not an available scout stationed at your home territory';
  end if;

  select destination_territory_id
  into v_target_destination_id
  from troop_movements
  where id = p_target_movement_id
    and kind = 'attack'
    and status = 'in_transit';
  if v_target_destination_id is null then
    raise exception 'target attack movement not found or no longer in transit';
  end if;

  perform 1
  from territories
  where id = v_target_destination_id
    and owner_id = v_caller;
  if not found then
    raise exception 'target movement is not attacking your territory';
  end if;

  v_delay_hrs := 1 + random() * 2;

  insert into troop_movements (
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    transfer_arrives_at,
    scout_target_movement_id
  )
  values (
    v_caller,
    'scout_peek',
    v_home_id,
    v_home_id,
    now() + (v_delay_hrs || ' hours')::interval,
    p_target_movement_id
  )
  returning id into v_movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  values (v_movement_id, p_card_instance_id);

  update card_instances
  set status = 'in_transit'
  where instance_id = p_card_instance_id;

  return v_movement_id;
end;
$$;

create or replace function resolve_due_scouts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scout record;
  v_card_instance_id uuid;
  v_killed boolean;
  v_detected boolean;
  v_target_owner uuid;
  v_caller_display text;
  v_return_hrs numeric;
  v_distance numeric;
  v_from_x smallint;
  v_from_y smallint;
  v_to_x smallint;
  v_to_y smallint;
  v_movement_id uuid;
  v_snapshot jsonb;
  v_target_territory_id integer;
  v_target_still_active boolean;
begin
  for v_scout in
    select id, player_id, origin_territory_id, destination_territory_id
    from troop_movements
    where kind = 'scout'
      and status = 'in_transit'
      and transfer_arrives_at <= now()
  loop
    update troop_movements
    set status = 'completed'
    where id = v_scout.id;

    select card_instance_id
    into v_card_instance_id
    from troop_movement_units
    where movement_id = v_scout.id;

    select owner_id
    into v_target_owner
    from territories
    where id = v_scout.destination_territory_id;

    select display_name
    into v_caller_display
    from players
    where id = v_scout.player_id;

    v_killed := random() < 0.20;
    if v_killed then
      delete from troop_movement_units
      where card_instance_id = v_card_instance_id;

      begin
        delete from card_instances
        where instance_id = v_card_instance_id;
      exception
        when foreign_key_violation then
          update card_instances
          set owner_id = null,
              stationed_territory_id = null,
              status = 'stationed'
          where instance_id = v_card_instance_id;
      end;

      perform _notify(
        v_scout.player_id,
        'scout_killed',
        jsonb_build_object('territory_id', v_scout.destination_territory_id)
      );
    end if;

    if v_target_owner is not null then
      v_detected := random() < 0.50;
      if v_detected then
        perform _notify(
          v_target_owner,
          'scout_detected',
          jsonb_build_object(
            'territory_id', v_scout.destination_territory_id,
            'scout_player_id', v_scout.player_id,
            'scout_display_name', v_caller_display
          )
        );
      end if;
    end if;

    if not v_killed then
      select x, y
      into v_from_x, v_from_y
      from territories
      where id = v_scout.destination_territory_id;

      select x, y
      into v_to_x, v_to_y
      from territories
      where id = v_scout.origin_territory_id;

      v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
      v_return_hrs := greatest(0.25, v_distance * 0.3 * least(3.0, greatest(0.4, 5.0 / 30.0)));

      insert into troop_movements (
        player_id,
        kind,
        origin_territory_id,
        destination_territory_id,
        transfer_arrives_at
      )
      values (
        v_scout.player_id,
        'scout_return',
        v_scout.destination_territory_id,
        v_scout.origin_territory_id,
        now() + (v_return_hrs || ' hours')::interval
      )
      returning id into v_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id)
      values (v_movement_id, v_card_instance_id);
    end if;
  end loop;

  for v_scout in
    select id, player_id, origin_territory_id, destination_territory_id
    from troop_movements
    where kind = 'scout_return'
      and status = 'in_transit'
      and transfer_arrives_at <= now()
  loop
    update troop_movements
    set status = 'completed'
    where id = v_scout.id;

    update card_instances ci
    set status = 'stationed',
        stationed_territory_id = v_scout.destination_territory_id
    from troop_movement_units tmu
    where tmu.movement_id = v_scout.id
      and ci.instance_id = tmu.card_instance_id;

    select destination_territory_id
    into v_target_territory_id
    from troop_movements sc
    join troop_movement_units tmu on tmu.movement_id = sc.id
    where sc.kind = 'scout'
      and sc.status = 'completed'
      and tmu.card_instance_id in (
        select card_instance_id
        from troop_movement_units
        where movement_id = v_scout.id
      )
    order by sc.transfer_arrives_at desc
    limit 1;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'template_id', ct.id,
          'category', ct.category,
          'unit_type', ct.unit_type,
          'rank', ct.rank,
          'name', ct.name,
          'flavor_text', ct.flavor_text,
          'base_stats', ct.base_stats,
          'total_supply', ct.total_supply
        )
      ),
      '[]'::jsonb
    )
    into v_snapshot
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_target_territory_id
      and ci.status = 'stationed'
      and ct.category = 'unit';

    insert into scout_reports (
      scout_player_id,
      target_territory_id,
      captured_at,
      expires_at,
      snapshot
    )
    values (
      v_scout.player_id,
      v_target_territory_id,
      now(),
      now() + interval '10 days',
      v_snapshot
    )
    on conflict (scout_player_id, target_territory_id) where target_territory_id is not null
    do update
    set captured_at = excluded.captured_at,
        expires_at = excluded.expires_at,
        snapshot = excluded.snapshot;

    perform _notify(
      v_scout.player_id,
      'scout_returned',
      jsonb_build_object('territory_id', v_target_territory_id)
    );
  end loop;

  for v_scout in
    select id, player_id, destination_territory_id, scout_target_movement_id
    from troop_movements
    where kind = 'scout_peek'
      and status = 'in_transit'
      and transfer_arrives_at <= now()
  loop
    update troop_movements
    set status = 'completed'
    where id = v_scout.id;

    select card_instance_id
    into v_card_instance_id
    from troop_movement_units
    where movement_id = v_scout.id;

    v_killed := random() < 0.20;
    if v_killed then
      delete from troop_movement_units
      where card_instance_id = v_card_instance_id;

      begin
        delete from card_instances
        where instance_id = v_card_instance_id;
      exception
        when foreign_key_violation then
          update card_instances
          set owner_id = null,
              stationed_territory_id = null,
              status = 'stationed'
          where instance_id = v_card_instance_id;
      end;

      perform _notify(
        v_scout.player_id,
        'scout_killed',
        jsonb_build_object('movement_id', v_scout.scout_target_movement_id)
      );
    else
      update card_instances
      set status = 'stationed',
          stationed_territory_id = v_scout.destination_territory_id
      where instance_id = v_card_instance_id;
    end if;

    select player_id
    into v_target_owner
    from troop_movements
    where id = v_scout.scout_target_movement_id;

    if v_target_owner is not null then
      v_detected := random() < 0.50;
      if v_detected then
        select display_name
        into v_caller_display
        from players
        where id = v_scout.player_id;

        perform _notify(
          v_target_owner,
          'scout_detected',
          jsonb_build_object(
            'movement_id', v_scout.scout_target_movement_id,
            'scout_player_id', v_scout.player_id,
            'scout_display_name', v_caller_display
          )
        );
      end if;
    end if;

    if not v_killed then
      select status = 'in_transit'
      into v_target_still_active
      from troop_movements
      where id = v_scout.scout_target_movement_id;

      if coalesce(v_target_still_active, false) then
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'template_id', ct.id,
              'category', ct.category,
              'unit_type', ct.unit_type,
              'rank', ct.rank,
              'name', ct.name,
              'flavor_text', ct.flavor_text,
              'base_stats', ct.base_stats,
              'total_supply', ct.total_supply
            )
          ),
          '[]'::jsonb
        )
        into v_snapshot
        from troop_movement_units tmu
        join card_instances ci on ci.instance_id = tmu.card_instance_id
        join card_templates ct on ct.id = ci.template_id
        where tmu.movement_id = v_scout.scout_target_movement_id
          and ct.category = 'unit';

        insert into scout_reports (
          scout_player_id,
          target_movement_id,
          captured_at,
          expires_at,
          snapshot
        )
        values (
          v_scout.player_id,
          v_scout.scout_target_movement_id,
          now(),
          now() + interval '10 days',
          v_snapshot
        )
        on conflict (scout_player_id, target_movement_id) where target_movement_id is not null
        do update
        set captured_at = excluded.captured_at,
            expires_at = excluded.expires_at,
            snapshot = excluded.snapshot;

        perform _notify(
          v_scout.player_id,
          'scout_returned',
          jsonb_build_object('movement_id', v_scout.scout_target_movement_id)
        );
      end if;
    end if;
  end loop;

  delete from scout_reports
  where expires_at <= now();
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
  perform resolve_due_scouts();
  perform resolve_due_npc_actions();
  perform resolve_due_npc_garrison_reinforcement();
  perform resolve_due_npc_daily_rewards();
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

    update troop_movements
    set status = 'completed'
    where kind = 'claim'
      and status = 'occupying'
      and destination_territory_id = v_completed_claim.id;
  end loop;
end;
$$;

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
  v_target_owner uuid;
  v_report_snapshot jsonb := null;
begin
  perform resolve_due_movements();
  perform resolve_due_battles();

  select t.owner_id
  into v_target_owner
  from territories t
  where t.id = p_territory_id;

  if caller is not null and v_target_owner is distinct from caller then
    select snapshot
    into v_report_snapshot
    from scout_reports
    where scout_player_id = caller
      and target_territory_id = p_territory_id
      and expires_at > now()
    order by captured_at desc
    limit 1;
  end if;

  return query
  with visible_non_units as (
    select
      ci.instance_id,
      case when ct.category = 'boost' and ci.owner_id is distinct from caller then 'masked-boost' else ci.template_id end as template_id,
      ci.owner_id,
      ci.stationed_territory_id,
      ci.status,
      ci.loaned_from_id,
      ci.loan_return_at,
      lender.display_name as loaned_from_display_name,
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
      end as card_templates
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    left join players lender on lender.id = ci.loaned_from_id
    where ci.stationed_territory_id = p_territory_id
      and ct.category <> 'unit'
  ),
  visible_live_units as (
    select
      ci.instance_id,
      ci.template_id,
      ci.owner_id,
      ci.stationed_territory_id,
      ci.status,
      ci.loaned_from_id,
      ci.loan_return_at,
      lender.display_name as loaned_from_display_name,
      false as is_masked,
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
      ) as card_templates
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    left join players lender on lender.id = ci.loaned_from_id
    where ci.stationed_territory_id = p_territory_id
      and ct.category = 'unit'
      and (
        caller is null
        or ci.owner_id = caller
        or v_target_owner = caller
      )
  ),
  masked_live_units as (
    select
      ci.instance_id,
      'masked-unit'::text as template_id,
      ci.owner_id,
      ci.stationed_territory_id,
      ci.status,
      ci.loaned_from_id,
      ci.loan_return_at,
      lender.display_name as loaned_from_display_name,
      true as is_masked,
      jsonb_build_object(
        'id', 'masked-unit',
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
      ) as card_templates
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    left join players lender on lender.id = ci.loaned_from_id
    where ci.stationed_territory_id = p_territory_id
      and ct.category = 'unit'
      and caller is not null
      and ci.owner_id is distinct from caller
      and v_report_snapshot is null
  ),
  snapshotted_units as (
    select
      gen_random_uuid() as instance_id,
      coalesce(snapshot_item->>'template_id', 'masked-unit') as template_id,
      v_target_owner as owner_id,
      p_territory_id as stationed_territory_id,
      'stationed'::text as status,
      null::uuid as loaned_from_id,
      null::timestamptz as loan_return_at,
      null::text as loaned_from_display_name,
      false as is_masked,
      jsonb_build_object(
        'id', ct.id,
        'name', coalesce(snapshot_item->>'name', ct.name),
        'flavor_text', coalesce(snapshot_item->>'flavor_text', ct.flavor_text),
        'rank', coalesce(snapshot_item->>'rank', ct.rank),
        'category', coalesce(snapshot_item->>'category', ct.category),
        'unit_type', coalesce(snapshot_item->>'unit_type', ct.unit_type),
        'base_stats', coalesce(snapshot_item->'base_stats', ct.base_stats),
        'total_supply', coalesce((snapshot_item->>'total_supply')::integer, ct.total_supply),
        'defense_bonus_pct', ct.defense_bonus_pct,
        'attack_bonus_pct', ct.attack_bonus_pct,
        'boost_type', ct.boost_type,
        'effect_kind', ct.effect_kind,
        'instant_effect_kind', ct.instant_effect_kind,
        'pct_str', ct.pct_str,
        'pct_lng', ct.pct_lng,
        'pct_def', ct.pct_def,
        'pct_hp', ct.pct_hp
      ) as card_templates
    from jsonb_array_elements(coalesce(v_report_snapshot, '[]'::jsonb)) snapshot_item
    join card_templates ct
      on ct.id = snapshot_item->>'template_id'
     and ct.category = 'unit'
    where caller is not null
      and v_target_owner is distinct from caller
      and v_report_snapshot is not null
  )
  select *
  from (
    select * from visible_non_units
    union all
    select * from visible_live_units
    union all
    select * from masked_live_units
    union all
    select * from snapshotted_units
  ) visible_cards
  order by
    (visible_cards.card_templates->>'category'),
    (visible_cards.card_templates->>'rank'),
    (visible_cards.card_templates->>'name') nulls last,
    visible_cards.instance_id;
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

  if mod(v_new_streak, 2) = 0 then
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values ('scout', null, null, 'stationed')
    returning instance_id into v_instance_id;
    perform _deposit_or_grant_card(v_player_id, v_instance_id);

    v_granted_cards := v_granted_cards || jsonb_build_array(
      jsonb_build_object('template_id', 'scout', 'rank', 'uncommon')
    );
  end if;

  return jsonb_build_object(
    'streak', v_new_streak,
    'claimed_at', v_claimed_at,
    'granted_cards', v_granted_cards
  );
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
  v_is_npc boolean := false;
begin
  perform resolve_due_movements();

  if not is_valid_coat_of_arms_id(new_coat_of_arms_id) then
    raise exception 'invalid coat_of_arms_id: %', new_coat_of_arms_id;
  end if;
  if char_length(trimmed_name) < 3 or char_length(trimmed_name) > 30 then
    raise exception 'kingdom_name must be 3-30 characters';
  end if;

  select coalesce(is_npc, false)
  into v_is_npc
  from players
  where id = p_caller;

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

  if not v_is_npc then
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values ('scout', null, null, 'stationed')
    returning instance_id into v_instance_id;
    perform _deposit_or_grant_card(p_caller, v_instance_id);
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
    if exists (
      select 1
      from players
      where id = v_battle.attacker_id
        and coalesce(is_npc, false) = false
    ) then
      perform _notify(
        v_battle.attacker_id,
        'battle_resolved',
        (
          select jsonb_build_object(
            'territory_id', t.id,
            'x', t.x::integer,
            'y', t.y::integer,
            'outcome', case when p_winner_side = 'attacker' then 'won' else 'lost' end,
            'other_player_id', v_battle.defender_id
          )
          from territories t
          where t.id = v_battle.territory_id
        )
      );
    end if;

    if v_battle.defender_id is not null and exists (
      select 1
      from players
      where id = v_battle.defender_id
        and coalesce(is_npc, false) = false
    ) then
      perform _notify(
        v_battle.defender_id,
        'battle_resolved',
        (
          select jsonb_build_object(
            'territory_id', t.id,
            'x', t.x::integer,
            'y', t.y::integer,
            'outcome', case when p_winner_side = 'defender' then 'won' else 'lost' end,
            'other_player_id', v_battle.attacker_id
          )
          from territories t
          where t.id = v_battle.territory_id
        )
      );

      if v_capture then
        perform _notify(
          v_battle.defender_id,
          'territory_lost',
          (
            select jsonb_build_object(
              'territory_id', t.id,
              'x', t.x::integer,
              'y', t.y::integer,
              'other_player_id', attacker.id,
              'other_display_name', attacker.display_name
            )
            from territories t
            join players attacker
              on attacker.id = v_battle.attacker_id
            where t.id = v_battle.territory_id
          )
        );
      end if;
    end if;

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

      if random() < 0.05 then
        insert into card_instances (template_id, owner_id, stationed_territory_id, status)
        values ('scout', null, null, 'stationed')
        returning instance_id into v_instance_id;
        perform _deposit_or_grant_card(v_winner_id, v_instance_id);
      end if;
    end if;
  end if;
end;
$$;

create or replace function get_coalition_movements()
returns table (
  id uuid,
  player_id uuid,
  kind text,
  origin_territory_id integer,
  destination_territory_id integer,
  started_at timestamptz,
  transfer_arrives_at timestamptz,
  status text,
  cancelled_at timestamptz,
  display_name text,
  kingdom_name text,
  is_npc boolean
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

  return query
    select
      tm.id,
      tm.player_id,
      tm.kind::text,
      tm.origin_territory_id,
      tm.destination_territory_id,
      tm.started_at,
      tm.transfer_arrives_at,
      tm.status::text,
      tm.cancelled_at,
      p.display_name,
      p.kingdom_name,
      p.is_npc
    from troop_movements tm
    join players p
      on p.id = tm.player_id
    where tm.player_id <> v_player_id
      and tm.player_id in (select _coalition_member_ids(v_player_id))
      and tm.status in ('in_transit', 'occupying')
      and tm.kind not in ('scout', 'scout_return', 'scout_peek');
end;
$$;
