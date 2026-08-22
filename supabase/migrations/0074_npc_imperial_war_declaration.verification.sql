-- Verification for 0074_npc_imperial_war_declaration.sql (rollback-
-- wrapped: run inside a transaction and roll back at the end).
--
-- Covers:
-- 1. The war-focus lookup only considers `state = 'war'`, not
--    `non_aggression`.
-- 2. An eligible NPC can declare imperial war on a bordering human when
--    the declaration roll is forced to succeed.
-- 3. An ineligible NPC (< 16 owned territories) never declares war.

begin;

do $$
declare
  v_big_npc_id uuid := gen_random_uuid();
  v_small_npc_id uuid := gen_random_uuid();
  v_border_human_id uuid := gen_random_uuid();
  v_nap_human_id uuid := gen_random_uuid();
  v_fallback_npc_id uuid := gen_random_uuid();
  v_coalition_human_id uuid := gen_random_uuid();
  v_remote_human_id uuid := gen_random_uuid();
  v_fallback_coalition_id uuid := gen_random_uuid();
  v_free_territories integer[];
  v_big_npc_border_territory integer;
  v_border_human_territory integer;
  v_big_npc_extra_territories integer[];
  v_fallback_npc_border_territory integer;
  v_coalition_human_territory integer;
  v_fallback_npc_extra_territories integer[];
  v_remote_human_territory integer;
  v_unit_template_id text;
  v_focus_enemy_id uuid;
  v_declared_target uuid;
  v_relation_state text;
  v_relation_count integer;
begin
  assert to_regprocedure('_maybe_declare_npc_imperial_war(uuid,numeric)') is not null,
    'missing _maybe_declare_npc_imperial_war(uuid,numeric)';
  assert to_regprocedure('resolve_due_npc_actions()') is not null,
    'missing resolve_due_npc_actions()';

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (
      v_big_npc_id,
      'authenticated',
      'authenticated',
      'npc-imperial-war-big-npc@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Imperial Big NPC","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_small_npc_id,
      'authenticated',
      'authenticated',
      'npc-imperial-war-small-npc@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Imperial Small NPC","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_border_human_id,
      'authenticated',
      'authenticated',
      'npc-imperial-war-border-human@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Imperial Border Human","nation":"francia"}'::jsonb,
      now(),
      now()
    ),
    (
      v_nap_human_id,
      'authenticated',
      'authenticated',
      'npc-imperial-war-nap-human@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Imperial NAP Human","nation":"francia"}'::jsonb,
      now(),
      now()
    ),
    (
      v_fallback_npc_id,
      'authenticated',
      'authenticated',
      'npc-imperial-war-fallback-npc@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Imperial Fallback NPC","nation":"england"}'::jsonb,
      now(),
      now()
    ),
    (
      v_coalition_human_id,
      'authenticated',
      'authenticated',
      'npc-imperial-war-coalition-human@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Imperial Coalition Human","nation":"francia"}'::jsonb,
      now(),
      now()
    ),
    (
      v_remote_human_id,
      'authenticated',
      'authenticated',
      'npc-imperial-war-remote-human@example.com',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Imperial Remote Human","nation":"francia"}'::jsonb,
      now(),
      now()
    );

  perform _complete_kingdom_onboarding_core(v_big_npc_id, 'Big NPC Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_small_npc_id, 'Small NPC Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_border_human_id, 'Border Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_nap_human_id, 'NAP Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_fallback_npc_id, 'Fallback Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_coalition_human_id, 'Coalition Realm', 'lion-gold');
  perform _complete_kingdom_onboarding_core(v_remote_human_id, 'Remote Realm', 'lion-gold');

  update players
  set is_npc = true,
      npc_next_action_at = null
  where id in (v_big_npc_id, v_small_npc_id, v_fallback_npc_id);

  update card_instances
  set stationed_territory_id = null
  where owner_id in (
    v_big_npc_id,
    v_small_npc_id,
    v_border_human_id,
    v_nap_human_id,
    v_fallback_npc_id,
    v_coalition_human_id,
    v_remote_human_id
  )
    and status = 'stationed';

  update territories
  set owner_id = null,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where owner_id in (
    v_big_npc_id,
    v_small_npc_id,
    v_border_human_id,
    v_nap_human_id,
    v_fallback_npc_id,
    v_coalition_human_id,
    v_remote_human_id
  );

  select array_agg(id order by id)
  into v_free_territories
  from (
    select id
    from territories
    where owner_id is null
      and claim_locked_by is null
      and battle_locked_by is null
      and not is_home
      and not exists (
        select 1
        from card_instances ci
        where ci.stationed_territory_id = territories.id
      )
    order by id
    limit 40
  ) free_tiles;

  assert coalesce(array_length(v_free_territories, 1), 0) = 40,
    'need forty free territories for 0074 verification';

  select a.id, b.id
  into v_big_npc_border_territory, v_border_human_territory
  from territories a
  join territories b
    on abs(a.x - b.x) + abs(a.y - b.y) = 1
   and a.id < b.id
  where a.id = any(v_free_territories)
    and b.id = any(v_free_territories)
  order by a.id, b.id
  limit 1;

  assert v_big_npc_border_territory is not null and v_border_human_territory is not null,
    'need an adjacent pair of free territories for 0074 verification';

  select array_agg(free_id order by free_id)
  into v_big_npc_extra_territories
  from (
    select free_id
    from unnest(v_free_territories) as free_id
    where free_id not in (v_big_npc_border_territory, v_border_human_territory)
    order by free_id
    limit 15
  ) remaining;

  assert coalesce(array_length(v_big_npc_extra_territories, 1), 0) = 15,
    'need fifteen additional free territories for 0074 verification';

  select a.id, b.id
  into v_fallback_npc_border_territory, v_coalition_human_territory
  from territories a
  join territories b
    on abs(a.x - b.x) + abs(a.y - b.y) = 1
   and a.id < b.id
  where a.id = any(v_free_territories)
    and b.id = any(v_free_territories)
    and a.id not in (
      v_big_npc_border_territory,
      v_border_human_territory
    )
    and a.id <> all(v_big_npc_extra_territories)
    and b.id not in (
      v_big_npc_border_territory,
      v_border_human_territory
    )
    and b.id <> all(v_big_npc_extra_territories)
  order by a.id, b.id
  limit 1;

  assert v_fallback_npc_border_territory is not null and v_coalition_human_territory is not null,
    'need a second adjacent pair of free territories for 0074 verification';

  select array_agg(free_id order by free_id)
  into v_fallback_npc_extra_territories
  from (
    select free_id
    from unnest(v_free_territories) as free_id
    where free_id not in (
      v_big_npc_border_territory,
      v_border_human_territory,
      v_fallback_npc_border_territory,
      v_coalition_human_territory
    )
      and free_id <> all(v_big_npc_extra_territories)
    order by free_id
    limit 15
  ) remaining;

  assert coalesce(array_length(v_fallback_npc_extra_territories, 1), 0) = 15,
    'need fifteen additional fallback NPC territories for 0074 verification';

  select candidate.id
  into v_remote_human_territory
  from territories candidate
  where candidate.id = any(v_free_territories)
    and candidate.id not in (
      v_big_npc_border_territory,
      v_border_human_territory,
      v_fallback_npc_border_territory,
      v_coalition_human_territory
    )
    and candidate.id <> all(v_big_npc_extra_territories)
    and candidate.id <> all(v_fallback_npc_extra_territories)
    and not exists (
      select 1
      from territories npc_t
      where (
        npc_t.id = v_fallback_npc_border_territory
        or npc_t.id = any(v_fallback_npc_extra_territories)
      )
        and abs(candidate.x - npc_t.x) + abs(candidate.y - npc_t.y) = 1
    )
  order by candidate.id
  limit 1;

  assert v_remote_human_territory is not null,
    'need one remote eligible human territory for 0074 verification';

  update territories
  set owner_id = v_big_npc_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_big_npc_border_territory
     or id = any(v_big_npc_extra_territories);

  update territories
  set owner_id = v_border_human_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_border_human_territory;

  update territories
  set owner_id = v_fallback_npc_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_fallback_npc_border_territory
     or id = any(v_fallback_npc_extra_territories);

  update territories
  set owner_id = v_coalition_human_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_coalition_human_territory;

  update territories
  set owner_id = v_remote_human_id,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_remote_human_territory;

  select id
  into v_unit_template_id
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  assert v_unit_template_id is not null, 'need a unit template for 0074 verification';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values
    (v_unit_template_id, v_big_npc_id, v_big_npc_border_territory, 'stationed'),
    (v_unit_template_id, v_big_npc_id, v_big_npc_border_territory, 'stationed'),
    (v_unit_template_id, v_big_npc_id, v_big_npc_border_territory, 'stationed'),
    (v_unit_template_id, v_border_human_id, v_border_human_territory, 'stationed'),
    (v_unit_template_id, v_fallback_npc_id, v_fallback_npc_border_territory, 'stationed'),
    (v_unit_template_id, v_fallback_npc_id, v_fallback_npc_border_territory, 'stationed'),
    (v_unit_template_id, v_fallback_npc_id, v_fallback_npc_border_territory, 'stationed'),
    (v_unit_template_id, v_remote_human_id, v_remote_human_territory, 'stationed');

  insert into diplomacy_relations (player_a_id, player_b_id, state)
  values (
    least(v_big_npc_id, v_nap_human_id),
    greatest(v_big_npc_id, v_nap_human_id),
    'non_aggression'
  );

  select opponent_id
  into v_focus_enemy_id
  from (
    select case
      when r.player_a_id = v_big_npc_id then r.player_b_id
      else r.player_a_id
    end as opponent_id
    from diplomacy_relations r
    where v_big_npc_id in (r.player_a_id, r.player_b_id)
      and r.state = 'war'
  ) war_opponents
  order by _npc_diplomacy_power(opponent_id) asc, opponent_id
  limit 1;

  assert v_focus_enemy_id is null,
    'non_aggression relation must not be treated as a war-focus enemy';

  select _maybe_declare_npc_imperial_war(v_big_npc_id, 0.05)
  into v_declared_target;

  assert v_declared_target = v_border_human_id,
    'eligible NPC should declare war on the bordering human when forced to succeed';

  select state
  into v_relation_state
  from diplomacy_relations
  where player_a_id = least(v_big_npc_id, v_border_human_id)
    and player_b_id = greatest(v_big_npc_id, v_border_human_id);

  assert v_relation_state = 'war',
    'imperial declaration should create a diplomacy_relations row with state = war';

  insert into coalitions (id, name, leader_id)
  values (v_fallback_coalition_id, 'Imperial Fallback Coalition', v_fallback_npc_id);

  insert into coalition_members (coalition_id, player_id)
  values
    (v_fallback_coalition_id, v_fallback_npc_id),
    (v_fallback_coalition_id, v_coalition_human_id);

  insert into diplomacy_relations (player_a_id, player_b_id, state)
  values
    (
      least(v_fallback_npc_id, v_border_human_id),
      greatest(v_fallback_npc_id, v_border_human_id),
      'non_aggression'
    ),
    (
      least(v_fallback_npc_id, v_nap_human_id),
      greatest(v_fallback_npc_id, v_nap_human_id),
      'non_aggression'
    );

  select _maybe_declare_npc_imperial_war(v_fallback_npc_id, 0.05)
  into v_declared_target;

  assert v_declared_target = v_remote_human_id,
    'if bordering humans are coalition-excluded, declaration should fall back to an eligible non-bordering human';

  select _maybe_declare_npc_imperial_war(v_small_npc_id, 0.05)
  into v_declared_target;

  assert v_declared_target is null,
    'NPC with fewer than sixteen owned territories must not declare imperial war';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where v_small_npc_id in (player_a_id, player_b_id);

  assert v_relation_count = 0,
    'ineligible NPC must not create any diplomacy relation';
end $$;

rollback;
