-- Verification for 0075_npc_garrison_reinforcement.sql (rollback-wrapped:
-- run inside a transaction and roll back at the end).
--
-- Covers:
-- (a) an under-target, unattacked territory is topped up from the nearest
--     surplus source to its base target;
-- (b) a territory attacked in 10h is reinforced up to ceil(base * 1.5) using
--     up to 2 sources;
-- (c) a source is never drained below its own base target;
-- (d) a source whose transfer would arrive after the attacker is skipped;
-- (e) already-in-transit reinforcements are counted so a second 30-minute run
--     does not send a duplicate wave;
-- (f) selected cards are the highest-effective-power stationed cards, not an
--     arbitrary subset.

begin;

do $$
declare
  i integer;
  v_npc_id uuid := gen_random_uuid();
  v_attacker_id uuid := gen_random_uuid();
  v_free_territories integer[];
  v_target_a_id integer;
  v_source_a_near_id integer;
  v_source_a_far_id integer;
  v_target_b_id integer;
  v_source_b1_id integer;
  v_source_b2_id integer;
  v_target_c_id integer;
  v_source_c_far_id integer;
  v_attacker_origin_id integer;
  v_ranked_power_templates text[];
  v_slowest_templates text[];
  v_dest_better_template_id text;
  v_source_better_template_id text;
  v_low_power_templates text[];
  v_card_id uuid;
  v_expected_a_cards uuid[];
  v_wrong_source_context_cards uuid[];
  v_actual_a_cards uuid[];
  v_target_a_movement_id uuid;
  v_target_a_transfer_count integer;
  v_target_a_current_count integer;
  v_target_b_transfer_count integer;
  v_target_b_incoming_count integer;
  v_target_b_source_count integer;
  v_target_c_transfer_count integer;
  v_source_b1_remaining integer;
  v_source_b2_remaining integer;
  v_target_b_base integer;
  v_target_b_expected integer;
  v_estimated_c_hours numeric;
begin
  assert to_regprocedure('_start_transfer_core(uuid,integer,integer,uuid[])') is not null,
    'missing _start_transfer_core(uuid,integer,integer,uuid[])';
  assert to_regprocedure('resolve_due_npc_garrison_reinforcement()') is not null,
    'missing resolve_due_npc_garrison_reinforcement()';

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_npc_id,
      'authenticated',
      'authenticated',
      'npc-garrison-reinforcement@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Garrison NPC","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_attacker_id,
      'authenticated',
      'authenticated',
      'npc-garrison-attacker@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Garrison Attacker","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_npc_id, 'Garrison NPC Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_attacker_id, 'Garrison Attacker Realm', 'lion-gold');

  update players
  set is_npc = true,
      npc_next_action_at = null,
      npc_garrison_reeval_at = now() - interval '1 minute'
  where id = v_npc_id;

  update card_instances
  set stationed_territory_id = null,
      status = 'stationed'
  where owner_id in (v_npc_id, v_attacker_id);

  update territories
  set owner_id = null,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where owner_id in (v_npc_id, v_attacker_id);

  select array_agg(id order by id)
  into v_free_territories
  from (
    select t.id
    from territories t
    where t.owner_id is null
      and t.claim_locked_by is null
      and t.battle_locked_by is null
      and t.difficulty = 1
      and not t.is_home
      and not exists (
        select 1
        from card_instances ci
        where ci.stationed_territory_id = t.id
      )
    order by t.id
    limit 80
  ) free_tiles;

  assert coalesce(array_length(v_free_territories, 1), 0) = 80,
    'need eighty free difficulty-1 territories for 0075 verification';

  select a.id, b.id
  into v_target_a_id, v_source_a_near_id
  from territories a
  join territories b
    on abs(a.x - b.x) + abs(a.y - b.y) = 1
   and a.id < b.id
  where a.id = any(v_free_territories)
    and b.id = any(v_free_territories)
  order by a.id, b.id
  limit 1;

  assert v_target_a_id is not null and v_source_a_near_id is not null,
    'need an adjacent target/source pair for scenario (a)';

  select candidate.id
  into v_source_a_far_id
  from territories candidate
  join territories target on target.id = v_target_a_id
  where candidate.id = any(v_free_territories)
    and candidate.id not in (v_target_a_id, v_source_a_near_id)
  order by greatest(abs(candidate.x - target.x), abs(candidate.y - target.y)) desc, candidate.id
  limit 1;

  assert v_source_a_far_id is not null,
    'need a farther surplus source for scenario (a)';

  select a.id, b.id
  into v_target_b_id, v_source_b1_id
  from territories a
  join territories b
    on abs(a.x - b.x) + abs(a.y - b.y) = 1
   and a.id < b.id
  where a.id = any(v_free_territories)
    and b.id = any(v_free_territories)
    and a.id not in (v_target_a_id, v_source_a_near_id, v_source_a_far_id)
    and b.id not in (v_target_a_id, v_source_a_near_id, v_source_a_far_id)
  order by a.id, b.id
  limit 1;

  assert v_target_b_id is not null and v_source_b1_id is not null,
    'need an adjacent target/source pair for scenario (b)';

  select candidate.id
  into v_source_b2_id
  from territories candidate
  join territories target on target.id = v_target_b_id
  where candidate.id = any(v_free_territories)
    and candidate.id not in (
      v_target_a_id,
      v_source_a_near_id,
      v_source_a_far_id,
      v_target_b_id,
      v_source_b1_id
    )
    and greatest(abs(candidate.x - target.x), abs(candidate.y - target.y)) <= 10
  order by greatest(abs(candidate.x - target.x), abs(candidate.y - target.y)) asc, candidate.id
  limit 1;

  assert v_source_b2_id is not null,
    'need a second nearby surplus source for scenario (b)';

  select candidate.id
  into v_target_c_id
  from territories candidate
  where candidate.id = any(v_free_territories)
    and candidate.id not in (
      v_target_a_id,
      v_source_a_near_id,
      v_source_a_far_id,
      v_target_b_id,
      v_source_b1_id,
      v_source_b2_id
    )
  order by candidate.id
  limit 1;

  assert v_target_c_id is not null,
    'need a third target territory for scenario (d)';

  select candidate.id
  into v_source_c_far_id
  from territories candidate
  join territories target on target.id = v_target_c_id
  where candidate.id = any(v_free_territories)
    and candidate.id not in (
      v_target_a_id,
      v_source_a_near_id,
      v_source_a_far_id,
      v_target_b_id,
      v_source_b1_id,
      v_source_b2_id,
      v_target_c_id
    )
    and greatest(abs(candidate.x - target.x), abs(candidate.y - target.y)) >= 12
  order by greatest(abs(candidate.x - target.x), abs(candidate.y - target.y)) desc, candidate.id
  limit 1;

  assert v_source_c_far_id is not null,
    'need a late-arriving far source for scenario (d)';

  select candidate.id
  into v_attacker_origin_id
  from territories candidate
  where candidate.id = any(v_free_territories)
    and candidate.id not in (
      v_target_a_id,
      v_source_a_near_id,
      v_source_a_far_id,
      v_target_b_id,
      v_source_b1_id,
      v_source_b2_id,
      v_target_c_id,
      v_source_c_far_id
    )
  order by candidate.id
  limit 1;

  assert v_attacker_origin_id is not null,
    'need an attacker origin territory';

  update territories
  set owner_id = v_npc_id
  where id in (
    v_target_a_id,
    v_source_a_near_id,
    v_source_a_far_id
  );

  update territories
  set castle_rank = 'legend',
      village_rank = null,
      wall_rank = null
  where id = v_target_a_id;

  update territories
  set castle_rank = null,
      village_rank = null,
      wall_rank = 'legend'
  where id = v_source_a_near_id;

  update territories
  set owner_id = v_attacker_id
  where id = v_attacker_origin_id;

  select array_agg(template_id order by effective_power desc, template_id)
  into v_ranked_power_templates
  from (
    select
      ct.id as template_id,
      (e.hp + e.str + e.lng + e.def) as effective_power
    from card_templates ct
    cross join lateral _compute_effective_stats(
      ct.base_stats,
      ct.rank,
      'england',
      true,
      null,
      null,
      null
    ) e
    where ct.category = 'unit'
    order by effective_power desc, ct.id
    limit 8
  ) ranked_templates;

  assert coalesce(array_length(v_ranked_power_templates, 1), 0) = 8,
    'need eight unit templates for 0075 verification';

  select array_agg(ct.id order by (ct.base_stats->>'speed')::numeric asc, ct.id)
  into v_slowest_templates
  from (
    select ct.id, ct.base_stats
    from card_templates ct
    where ct.category = 'unit'
    order by (ct.base_stats->>'speed')::numeric asc, ct.id
    limit 2
  ) ct;

  assert coalesce(array_length(v_slowest_templates, 1), 0) = 2,
    'need two slow unit templates for 0075 verification';

  select pair.dest_better_template_id, pair.source_better_template_id
  into v_dest_better_template_id, v_source_better_template_id
  from (
    with scored as (
      select
        ct.id,
        (dest_e.hp + dest_e.str + dest_e.lng + dest_e.def) as dest_power,
        (source_e.hp + source_e.str + source_e.lng + source_e.def) as source_power
      from card_templates ct
      cross join lateral _compute_effective_stats(
        ct.base_stats,
        ct.rank,
        'england',
        true,
        'legend',
        null,
        null
      ) dest_e
      cross join lateral _compute_effective_stats(
        ct.base_stats,
        ct.rank,
        'england',
        true,
        null,
        null,
        'legend'
      ) source_e
      where ct.category = 'unit'
    )
    select
      a.id as dest_better_template_id,
      b.id as source_better_template_id
    from scored a
    join scored b
      on b.id <> a.id
    where a.dest_power > b.dest_power
      and a.source_power < b.source_power
    order by
      (a.dest_power - b.dest_power) desc,
      (b.source_power - a.source_power) desc,
      a.id,
      b.id
    limit 1
  ) pair;

  assert v_dest_better_template_id is not null and v_source_better_template_id is not null,
    'need a unit-template pair whose ranking differs between destination and source fortification contexts';

  select array_agg(low_templates.id order by low_templates.intrinsic_power asc, low_templates.id)
  into v_low_power_templates
  from (
    select
      ct.id,
      (e.hp + e.str + e.lng + e.def) as intrinsic_power
    from card_templates ct
    cross join lateral _compute_effective_stats(
      ct.base_stats,
      ct.rank,
      'england',
      true,
      null,
      null,
      null
    ) e
    where ct.category = 'unit'
      and ct.id not in (v_dest_better_template_id, v_source_better_template_id)
    order by intrinsic_power asc, ct.id
    limit 3
  ) low_templates;

  assert coalesce(array_length(v_low_power_templates, 1), 0) = 3,
    'need three low-power filler unit templates for scenario (f)';

  -- Scenario (a) + (f): target A starts 2 cards short of its base target.
  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_ranked_power_templates[8], v_npc_id, v_target_a_id, 'stationed');

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_dest_better_template_id, v_npc_id, v_source_a_near_id, 'stationed')
  returning instance_id into v_card_id;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_source_better_template_id, v_npc_id, v_source_a_near_id, 'stationed')
  returning instance_id into v_card_id;

  for i in 1..3 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_low_power_templates[i], v_npc_id, v_source_a_near_id, 'stationed')
    returning instance_id into v_card_id;
  end loop;

  for i in 4..8 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_ranked_power_templates[i], v_npc_id, v_source_a_far_id, 'stationed');
  end loop;

  select array_agg(card_id order by effective_power desc, card_id)
  into v_expected_a_cards
  from (
    select
      ci.instance_id as card_id,
      (e.hp + e.str + e.lng + e.def) as effective_power
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    cross join lateral _compute_effective_stats(
      ct.base_stats,
      ct.rank,
      'england',
      true,
      'legend',
      null,
      null
    ) e
    where ci.owner_id = v_npc_id
      and ci.stationed_territory_id = v_source_a_near_id
      and ci.status = 'stationed'
    order by effective_power desc, ci.instance_id
    limit 2
  ) ranked_cards;

  select array_agg(card_id order by effective_power desc, card_id)
  into v_wrong_source_context_cards
  from (
    select
      ci.instance_id as card_id,
      (e.hp + e.str + e.lng + e.def) as effective_power
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    cross join lateral _compute_effective_stats(
      ct.base_stats,
      ct.rank,
      'england',
      true,
      null,
      null,
      'legend'
    ) e
    where ci.owner_id = v_npc_id
      and ci.stationed_territory_id = v_source_a_near_id
      and ci.status = 'stationed'
    order by effective_power desc, ci.instance_id
    limit 2
  ) ranked_cards;

  assert v_expected_a_cards <> v_wrong_source_context_cards,
    'scenario (f) setup is invalid: destination-context and source-context rankings must differ';

  update players
  set npc_garrison_reeval_at = now() - interval '1 minute'
  where id = v_npc_id;

  perform resolve_due_npc_garrison_reinforcement();

  select tm.id, count(*)
  into v_target_a_movement_id, v_target_a_transfer_count
  from troop_movements tm
  join troop_movement_units tmu on tmu.movement_id = tm.id
  where tm.player_id = v_npc_id
    and tm.kind = 'transfer'
    and tm.status = 'in_transit'
    and tm.origin_territory_id = v_source_a_near_id
    and tm.destination_territory_id = v_target_a_id
  group by tm.id;

  assert v_target_a_movement_id is not null and v_target_a_transfer_count = 2,
    'scenario (a): nearest surplus source should send exactly two cards to target A';

  select array_agg(tmu.card_instance_id order by tmu.card_instance_id)
  into v_actual_a_cards
  from troop_movement_units tmu
  where tmu.movement_id = v_target_a_movement_id;

  assert v_actual_a_cards = (
    select array_agg(card_id order by card_id)
    from unnest(v_expected_a_cards) as card_id
  ), 'scenario (f): transferred cards must be the highest-effective-power stationed cards';

  select count(*)
  into v_target_a_current_count
  from (
    select ci.instance_id
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id and ct.category = 'unit'
    where ci.owner_id = v_npc_id
      and ci.stationed_territory_id = v_target_a_id
      and ci.status = 'stationed'
    union all
    select tmu.card_instance_id
    from troop_movements tm
    join troop_movement_units tmu on tmu.movement_id = tm.id
    where tm.player_id = v_npc_id
      and tm.kind = 'transfer'
      and tm.status = 'in_transit'
      and tm.destination_territory_id = v_target_a_id
  ) counted_cards;

  assert v_target_a_current_count = _npc_garrison_target_size(1::smallint),
    'scenario (a): target A should be topped up exactly to its base target';

  update players
  set npc_garrison_reeval_at = now() - interval '1 minute'
  where id = v_npc_id;

  perform resolve_due_npc_garrison_reinforcement();

  select count(*)
  into v_target_a_transfer_count
  from troop_movements tm
  where tm.player_id = v_npc_id
    and tm.kind = 'transfer'
    and tm.status = 'in_transit'
    and tm.destination_territory_id = v_target_a_id;

  assert v_target_a_transfer_count = 1,
    'scenario (e): second reevaluation must count the in-transit wave and avoid sending a duplicate';

  -- Scenario (b) + (c) + (d): two-source attacked reinforcement, plus a late source skip.
  update territories
  set owner_id = v_npc_id
  where id in (v_target_b_id, v_source_b1_id, v_source_b2_id);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_ranked_power_templates[8], v_npc_id, v_target_b_id, 'stationed');

  for i in 1..5 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_ranked_power_templates[i], v_npc_id, v_source_b1_id, 'stationed');
  end loop;

  for i in 2..6 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_ranked_power_templates[i], v_npc_id, v_source_b2_id, 'stationed');
  end loop;

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
      v_attacker_id,
      'attack',
      v_attacker_origin_id,
      v_target_b_id,
      now() + interval '10 hours',
      'in_transit'
    );

  update players
  set npc_garrison_reeval_at = now() - interval '1 minute'
  where id = v_npc_id;

  perform resolve_due_npc_garrison_reinforcement();

  select count(*)
  into v_target_b_transfer_count
  from troop_movements tm
  where tm.player_id = v_npc_id
    and tm.kind = 'transfer'
    and tm.status = 'in_transit'
    and tm.destination_territory_id = v_target_b_id;

  if v_target_b_transfer_count <> 2 then
    raise exception 'scenario (b): expected 2 reinforcement transfers to target B, got %', v_target_b_transfer_count;
  end if;

  select count(*)
  into v_target_b_source_count
  from (
    select distinct tm.origin_territory_id
    from troop_movements tm
    where tm.player_id = v_npc_id
      and tm.kind = 'transfer'
      and tm.status = 'in_transit'
      and tm.destination_territory_id = v_target_b_id
  ) used_sources;

  assert v_target_b_source_count = 2,
    'scenario (b): the attacked target should use exactly two distinct surplus sources';

  v_target_b_base := _npc_garrison_target_size(1::smallint);
  v_target_b_expected := ceil(v_target_b_base::numeric * 1.5)::integer;

  select count(*)
  into v_target_b_incoming_count
  from (
    select ci.instance_id
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id and ct.category = 'unit'
    where ci.owner_id = v_npc_id
      and ci.stationed_territory_id = v_target_b_id
      and ci.status = 'stationed'
    union all
    select tmu.card_instance_id
    from troop_movements tm
    join troop_movement_units tmu on tmu.movement_id = tm.id
    where tm.player_id = v_npc_id
      and tm.kind = 'transfer'
      and tm.status = 'in_transit'
      and tm.destination_territory_id = v_target_b_id
      and tm.transfer_arrives_at <= now() + interval '10 hours'
  ) counted_cards;

  assert v_target_b_incoming_count = v_target_b_expected,
    'scenario (b): attacked target should be reinforced to ceil(base * 1.5)';

  select count(*)
  into v_source_b1_remaining
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id and ct.category = 'unit'
  where ci.owner_id = v_npc_id
    and ci.stationed_territory_id = v_source_b1_id
    and ci.status = 'stationed';

  select count(*)
  into v_source_b2_remaining
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id and ct.category = 'unit'
  where ci.owner_id = v_npc_id
    and ci.stationed_territory_id = v_source_b2_id
    and ci.status = 'stationed';

  assert v_source_b1_remaining = _npc_garrison_target_size(1::smallint),
    'scenario (c): source B1 must not be drained below its own base target';
  assert v_source_b2_remaining = _npc_garrison_target_size(1::smallint),
    'scenario (c): source B2 must not be drained below its own base target';

  update territories
  set owner_id = v_npc_id
  where id in (v_target_c_id, v_source_c_far_id);

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_ranked_power_templates[8], v_npc_id, v_target_c_id, 'stationed');

  for i in 1..5 loop
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values (v_slowest_templates[((i - 1) % 2) + 1], v_npc_id, v_source_c_far_id, 'stationed');
  end loop;

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
      v_attacker_id,
      'attack',
      v_attacker_origin_id,
      v_target_c_id,
      now() + interval '10 hours',
      'in_transit'
    );

  select greatest(
    0.25,
    greatest(abs(source.x - target.x), abs(source.y - target.y))
    * 0.3
    * least(
      3.0,
      greatest(
        0.4,
        5.0 / coalesce((
          select min((ct.base_stats->>'speed')::numeric)
          from card_instances ci
          join card_templates ct on ct.id = ci.template_id
          where ci.owner_id = v_npc_id
            and ci.stationed_territory_id = v_source_c_far_id
            and ci.status = 'stationed'
        ), 5.0)
      )
    )
  )
  into v_estimated_c_hours
  from territories source
  join territories target on target.id = v_target_c_id
  where source.id = v_source_c_far_id;

  assert v_estimated_c_hours > 10,
    'scenario (d) setup is invalid: far source would actually arrive before the attacker';

  update players
  set npc_garrison_reeval_at = now() - interval '1 minute'
  where id = v_npc_id;

  perform resolve_due_npc_garrison_reinforcement();

  select count(*)
  into v_target_c_transfer_count
  from troop_movements tm
  where tm.player_id = v_npc_id
    and tm.kind = 'transfer'
    and tm.status = 'in_transit'
    and tm.destination_territory_id = v_target_c_id;

  assert v_target_c_transfer_count = 0,
    'scenario (d): a reinforcement wave that cannot arrive before the attacker must be skipped';
end;
$$;

rollback;
