-- Verification for 0077_npc_wild_garrison_conquest.sql (rollback-wrapped:
-- run inside a transaction and roll back at the end).
--
-- Covers:
-- (a) the wild-garrison conquest branch is present in resolve_due_npc_actions(),
--     and a sufficiently strong NPC candidate can attack such a territory via
--     _declare_attack_core();
-- (b) an insufficiently strong NPC does not qualify for that candidate pool;
-- (c) the existing expansion and regular-attack candidate pools still admit
--     their previous target types unchanged.

begin;

do $$
declare
  v_strong_npc_id uuid := gen_random_uuid();
  v_weak_npc_id uuid := gen_random_uuid();
  v_human_id uuid := gen_random_uuid();
  v_free_territories integer[];
  v_used_territories integer[] := '{}'::integer[];
  v_strong_wild_origin_id integer;
  v_strong_wild_target_id integer;
  v_weak_wild_origin_id integer;
  v_weak_wild_target_id integer;
  v_expansion_origin_id integer;
  v_expansion_target_id integer;
  v_regular_origin_id integer;
  v_regular_target_id integer;
  v_high_template_id text;
  v_low_template_id text;
  v_function_def text;
  v_candidate_target_id integer;
  v_candidate_origin_id integer;
  v_candidate_card_ids uuid[];
  v_movement_id uuid;
begin
  assert to_regprocedure('resolve_due_npc_actions()') is not null,
    'missing resolve_due_npc_actions()';
  assert to_regprocedure('_declare_attack_core(uuid,integer,jsonb,uuid)') is not null,
    'missing _declare_attack_core(uuid,integer,jsonb,uuid)';

  v_function_def := pg_get_functiondef('resolve_due_npc_actions()'::regprocedure);

  assert position(
    '_territory_effective_unit_power(null,' in regexp_replace(v_function_def, '\s+', '', 'g')
  ) > 0,
    'resolve_due_npc_actions() is missing the wild-garrison conquest power comparison';
  assert position('v_wild_attack_target_id' in v_function_def) > 0,
    'resolve_due_npc_actions() is missing the wild-garrison candidate branch';

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_strong_npc_id,
      'authenticated',
      'authenticated',
      'npc-wild-garrison-strong@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Wild Strong NPC","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_weak_npc_id,
      'authenticated',
      'authenticated',
      'npc-wild-garrison-weak@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Wild Weak NPC","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_human_id,
      'authenticated',
      'authenticated',
      'npc-wild-garrison-human@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Wild Human Defender","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_strong_npc_id, 'Wild Strong NPC Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_weak_npc_id, 'Wild Weak NPC Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_human_id, 'Wild Human Realm', 'lion-gold');

  update players
  set is_npc = true,
      npc_next_action_at = null
  where id in (v_strong_npc_id, v_weak_npc_id);

  update card_instances
  set stationed_territory_id = null,
      status = 'stationed'
  where owner_id in (v_strong_npc_id, v_weak_npc_id, v_human_id);

  update territories
  set owner_id = null,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false,
      castle_rank = null,
      village_rank = null,
      wall_rank = null
  where owner_id in (v_strong_npc_id, v_weak_npc_id, v_human_id);

  select array_agg(id order by id)
  into v_free_territories
  from (
    select t.id
    from territories t
    where t.owner_id is null
      and t.claim_locked_by is null
      and t.battle_locked_by is null
      and not t.is_home
      and not exists (
        select 1
        from card_instances ci
        where ci.stationed_territory_id = t.id
      )
    order by t.id
    limit 40
  ) free_tiles;

  assert coalesce(array_length(v_free_territories, 1), 0) = 40,
    'need forty free territories for 0077 verification';

  select a.id, b.id
  into v_strong_wild_origin_id, v_strong_wild_target_id
  from territories a
  join territories b
    on abs(a.x - b.x) + abs(a.y - b.y) = 1
   and a.id < b.id
  where a.id = any(v_free_territories)
    and b.id = any(v_free_territories)
  order by a.id, b.id
  limit 1;

  assert v_strong_wild_origin_id is not null and v_strong_wild_target_id is not null,
    'need an adjacent pair for the strong wild-garrison scenario';

  v_used_territories := array_append(v_used_territories, v_strong_wild_origin_id);
  v_used_territories := array_append(v_used_territories, v_strong_wild_target_id);

  select a.id, b.id
  into v_weak_wild_origin_id, v_weak_wild_target_id
  from territories a
  join territories b
    on abs(a.x - b.x) + abs(a.y - b.y) = 1
   and a.id < b.id
  where a.id = any(v_free_territories)
    and b.id = any(v_free_territories)
    and a.id <> all(v_used_territories)
    and b.id <> all(v_used_territories)
  order by a.id, b.id
  limit 1;

  assert v_weak_wild_origin_id is not null and v_weak_wild_target_id is not null,
    'need an adjacent pair for the weak wild-garrison scenario';

  v_used_territories := v_used_territories || array[v_weak_wild_origin_id, v_weak_wild_target_id];

  select a.id, b.id
  into v_expansion_origin_id, v_expansion_target_id
  from territories a
  join territories b
    on abs(a.x - b.x) + abs(a.y - b.y) = 1
   and a.id < b.id
  where a.id = any(v_free_territories)
    and b.id = any(v_free_territories)
    and a.id <> all(v_used_territories)
    and b.id <> all(v_used_territories)
  order by a.id, b.id
  limit 1;

  assert v_expansion_origin_id is not null and v_expansion_target_id is not null,
    'need an adjacent pair for the expansion scenario';

  v_used_territories := v_used_territories || array[v_expansion_origin_id, v_expansion_target_id];

  select a.id, b.id
  into v_regular_origin_id, v_regular_target_id
  from territories a
  join territories b
    on abs(a.x - b.x) + abs(a.y - b.y) = 1
   and a.id < b.id
  where a.id = any(v_free_territories)
    and b.id = any(v_free_territories)
    and a.id <> all(v_used_territories)
    and b.id <> all(v_used_territories)
  order by a.id, b.id
  limit 1;

  assert v_regular_origin_id is not null and v_regular_target_id is not null,
    'need an adjacent pair for the regular-attack scenario';

  update territories
  set owner_id = v_strong_npc_id
  where id in (v_strong_wild_origin_id, v_expansion_origin_id, v_regular_origin_id);

  update territories
  set owner_id = v_weak_npc_id
  where id = v_weak_wild_origin_id;

  update territories
  set owner_id = v_human_id
  where id = v_regular_target_id;

  select template_id
  into v_high_template_id
  from (
    select
      ct.id as template_id,
      (e.hp + e.str + e.lng + e.def) as effective_power
    from card_templates ct
    cross join lateral _compute_effective_stats(
      ct.base_stats,
      ct.rank,
      'england'::nation_id,
      false,
      null,
      null
    ) e
    where ct.category = 'unit'
  ) ranked
  order by effective_power desc, template_id
  limit 1;

  select template_id
  into v_low_template_id
  from (
    select
      ct.id as template_id,
      (e.hp + e.str + e.lng + e.def) as effective_power
    from card_templates ct
    cross join lateral _compute_effective_stats(
      ct.base_stats,
      ct.rank,
      null,
      true,
      null,
      null
    ) e
    where ct.category = 'unit'
  ) ranked
  order by effective_power asc, template_id
  limit 1;

  assert v_high_template_id is not null,
    'need at least one high-power unit template';
  assert v_low_template_id is not null,
    'need at least one low-power unit template';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values
    (v_high_template_id, v_strong_npc_id, v_strong_wild_origin_id, 'stationed'),
    (v_high_template_id, v_strong_npc_id, v_strong_wild_origin_id, 'stationed'),
    (v_high_template_id, v_strong_npc_id, v_strong_wild_origin_id, 'stationed'),
    (v_high_template_id, v_strong_npc_id, v_regular_origin_id, 'stationed'),
    (v_high_template_id, v_strong_npc_id, v_regular_origin_id, 'stationed'),
    (v_low_template_id, v_strong_npc_id, v_expansion_origin_id, 'stationed'),
    (v_low_template_id, v_weak_npc_id, v_weak_wild_origin_id, 'stationed'),
    (v_low_template_id, null, v_strong_wild_target_id, 'stationed'),
    (v_high_template_id, null, v_weak_wild_target_id, 'stationed'),
    (v_low_template_id, v_human_id, v_regular_target_id, 'stationed');

  with adjacent_origin_pairs as (
    select
      target.id as target_id,
      o.id as origin_id,
      array_agg(ci.instance_id order by ci.instance_id) as card_ids,
      _territory_effective_unit_power(v_strong_npc_id, o.id, false) as attack_power
    from territories o
    join card_instances ci
      on ci.stationed_territory_id = o.id
     and ci.owner_id = v_strong_npc_id
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
    where o.owner_id = v_strong_npc_id
      and target.id = v_strong_wild_target_id
      and target.owner_id is null
      and target.claim_locked_by is null
      and target.battle_locked_by is null
      and exists (
        select 1
        from card_instances ci2
        join card_templates ct2 on ct2.id = ci2.template_id
        where ci2.stationed_territory_id = target.id
          and ci2.owner_id is null
          and ct2.category = 'unit'
      )
    group by target.id, o.id
  ),
  eligible_adjacent_targets as (
    select distinct on (target_id)
      target_id,
      origin_id,
      card_ids
    from adjacent_origin_pairs
    where attack_power >= _territory_effective_unit_power(null, target_id, true) * 1.2
    order by target_id, attack_power desc, origin_id
  )
  select target_id, origin_id, card_ids
  into v_candidate_target_id, v_candidate_origin_id, v_candidate_card_ids
  from eligible_adjacent_targets
  order by target_id, origin_id
  limit 1;

  assert v_candidate_target_id = v_strong_wild_target_id,
    format(
      'strong NPC should qualify for the wild-garrison target (expected target %s, got %s)',
      v_strong_wild_target_id,
      coalesce(v_candidate_target_id::text, 'null')
    );

  select _declare_attack_core(
    v_strong_npc_id,
    v_candidate_target_id,
    jsonb_build_array(
      jsonb_build_object(
        'origin_territory_id', v_candidate_origin_id,
        'card_instance_ids', to_jsonb(v_candidate_card_ids)
      )
    ),
    null
  )
  into v_movement_id;

  assert v_movement_id is not null,
    'strong NPC wild-garrison conquest should create an attack movement';
  assert exists (
    select 1
    from troop_movements tm
    where tm.id = v_movement_id
      and tm.kind = 'attack'
      and tm.player_id = v_strong_npc_id
      and tm.destination_territory_id = v_strong_wild_target_id
  ),
    'strong NPC wild-garrison conquest should target the seeded unclaimed territory';

  with adjacent_origin_pairs as (
    select
      target.id as target_id,
      o.id as origin_id,
      array_agg(ci.instance_id order by ci.instance_id) as card_ids,
      _territory_effective_unit_power(v_weak_npc_id, o.id, false) as attack_power
    from territories o
    join card_instances ci
      on ci.stationed_territory_id = o.id
     and ci.owner_id = v_weak_npc_id
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
    where o.owner_id = v_weak_npc_id
      and target.id = v_weak_wild_target_id
      and target.owner_id is null
      and target.claim_locked_by is null
      and target.battle_locked_by is null
      and exists (
        select 1
        from card_instances ci2
        join card_templates ct2 on ct2.id = ci2.template_id
        where ci2.stationed_territory_id = target.id
          and ci2.owner_id is null
          and ct2.category = 'unit'
      )
    group by target.id, o.id
  ),
  eligible_adjacent_targets as (
    select distinct on (target_id)
      target_id,
      origin_id,
      card_ids
    from adjacent_origin_pairs
    where attack_power >= _territory_effective_unit_power(null, target_id, true) * 1.2
    order by target_id, attack_power desc, origin_id
  )
  select target_id, origin_id, card_ids
  into v_candidate_target_id, v_candidate_origin_id, v_candidate_card_ids
  from eligible_adjacent_targets
  order by target_id, origin_id
  limit 1;

  assert v_candidate_target_id is null,
    'weak NPC should not qualify for the wild-garrison conquest candidate pool';

  with adjacent_origin_pairs as (
    select
      target.id as target_id,
      o.id as origin_id,
      array_agg(ci.instance_id order by ci.instance_id) as card_ids
    from territories o
    join card_instances ci
      on ci.stationed_territory_id = o.id
     and ci.owner_id = v_strong_npc_id
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
    where o.owner_id = v_strong_npc_id
      and target.id = v_expansion_target_id
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
  into v_candidate_target_id, v_candidate_origin_id, v_candidate_card_ids
  from adjacent_targets
  order by target_id, origin_id
  limit 1;

  assert v_candidate_target_id = v_expansion_target_id,
    format(
      'ungarrisoned unclaimed expansion target should remain eligible (expected target %s, got %s)',
      v_expansion_target_id,
      coalesce(v_candidate_target_id::text, 'null')
    );

  with adjacent_origin_pairs as (
    select
      target.id as target_id,
      target.owner_id as target_owner_id,
      target.claim_locked_by as target_claim_locked_by,
      o.id as origin_id,
      array_agg(ci.instance_id order by ci.instance_id) as card_ids,
      _territory_effective_unit_power(v_strong_npc_id, o.id, false) as attack_power
    from territories o
    join card_instances ci
      on ci.stationed_territory_id = o.id
     and ci.owner_id = v_strong_npc_id
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
    where o.owner_id = v_strong_npc_id
      and target.id = v_regular_target_id
      and target.battle_locked_by is null
      and (
        (target.owner_id is not null and target.owner_id <> v_strong_npc_id)
        or (target.owner_id is null and target.claim_locked_by is not null and target.claim_locked_by <> v_strong_npc_id)
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
  into v_candidate_target_id, v_candidate_origin_id, v_candidate_card_ids
  from eligible_adjacent_targets
  order by target_id, origin_id
  limit 1;

  assert v_candidate_target_id = v_regular_target_id,
    format(
      'regular owned/claimed attack target should remain eligible (expected target %s, got %s)',
      v_regular_target_id,
      coalesce(v_candidate_target_id::text, 'null')
    );
end;
$$;

rollback;
