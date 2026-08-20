-- 0045_diplomacy_war_creation.verification.sql
--
-- Safe verification for diplomacy war creation wiring.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_attacker uuid;
  v_defender uuid;
  v_npc_owner uuid;
  v_origin_territory_id integer;
  v_defender_target_a integer;
  v_defender_target_b integer;
  v_npc_target integer;
  v_empty_target integer;
  v_template_id text;
  v_card_a uuid;
  v_card_b uuid;
  v_card_c uuid;
  v_card_d uuid;
  v_movement_id uuid;
  v_relation_count integer;
  v_war_event_count integer;
  v_total_relations integer;
begin
  assert to_regprocedure('_declare_attack_core(uuid, integer, jsonb, uuid)') is not null,
    'missing _declare_attack_core(uuid, integer, jsonb, uuid)';

  select id into v_attacker
  from players
  where coalesce(is_npc, false) = false
  order by created_at, id
  limit 1;

  select id into v_defender
  from players
  where coalesce(is_npc, false) = false
    and id <> v_attacker
  order by created_at, id
  limit 1;

  select id into v_npc_owner
  from players
  where coalesce(is_npc, false) = true
  order by created_at, id
  limit 1;

  assert v_attacker is not null and v_defender is not null and v_npc_owner is not null,
    'need two human players and one NPC player for diplomacy war-creation verification';

  select id into v_template_id
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  assert v_template_id is not null, 'need at least one unit template for diplomacy war-creation verification';

  select id into v_origin_territory_id
  from territories
  where owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not is_home
  order by id
  limit 1;

  select id into v_defender_target_a
  from territories
  where id > v_origin_territory_id
    and owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not is_home
  order by id
  limit 1;

  select id into v_defender_target_b
  from territories
  where id > v_defender_target_a
    and owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not is_home
  order by id
  limit 1;

  select id into v_npc_target
  from territories
  where id > v_defender_target_b
    and owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not is_home
  order by id
  limit 1;

  select id into v_empty_target
  from territories
  where id > v_npc_target
    and owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not is_home
  order by id
  limit 1;

  assert v_origin_territory_id is not null
    and v_defender_target_a is not null
    and v_defender_target_b is not null
    and v_npc_target is not null
    and v_empty_target is not null,
    'need five unlocked empty territories for diplomacy war-creation verification';

  update territories
  set owner_id = v_attacker,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_origin_territory_id;

  update territories
  set owner_id = v_defender,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id in (v_defender_target_a, v_defender_target_b);

  update territories
  set owner_id = v_npc_owner,
      claim_locked_by = null,
      claim_started_at = null,
      claim_transfer_arrives_at = null,
      claim_occupation_completes_at = null,
      battle_locked_by = null,
      is_home = false
  where id = v_npc_target;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_attacker, v_origin_territory_id, 'stationed')
  returning instance_id into v_card_a;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_attacker, v_origin_territory_id, 'stationed')
  returning instance_id into v_card_b;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_attacker, v_origin_territory_id, 'stationed')
  returning instance_id into v_card_c;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_attacker, v_origin_territory_id, 'stationed')
  returning instance_id into v_card_d;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);

  select declare_attack(
    v_origin_territory_id,
    v_defender_target_a,
    array[v_card_a]::uuid[],
    null
  ) into v_movement_id;

  execute 'reset role';

  assert v_movement_id is not null, 'expected first PvP declare_attack call to succeed';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where player_a_id = least(v_attacker, v_defender)
    and player_b_id = greatest(v_attacker, v_defender);

  select count(*)
  into v_war_event_count
  from world_events
  where event_type = 'war_declared'
    and payload->>'attacker_id' = v_attacker::text
    and payload->>'defender_id' = v_defender::text;

  assert v_relation_count = 1, 'first PvP attack should create exactly one diplomacy relation row';
  assert v_war_event_count = 1, 'first PvP attack should log exactly one war_declared world event';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);

  select declare_attack(
    v_origin_territory_id,
    v_defender_target_b,
    array[v_card_b]::uuid[],
    null
  ) into v_movement_id;

  execute 'reset role';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where player_a_id = least(v_attacker, v_defender)
    and player_b_id = greatest(v_attacker, v_defender);

  select count(*)
  into v_war_event_count
  from world_events
  where event_type = 'war_declared'
    and payload->>'attacker_id' = v_attacker::text
    and payload->>'defender_id' = v_defender::text;

  assert v_relation_count = 1, 'second PvP attack against the same pair must not duplicate the war row';
  assert v_war_event_count = 1, 'second PvP attack against the same pair must not log a second war_declared event';

  select count(*)
  into v_total_relations
  from diplomacy_relations
  where v_attacker in (player_a_id, player_b_id);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);

  select declare_attack(
    v_origin_territory_id,
    v_npc_target,
    array[v_card_c]::uuid[],
    null
  ) into v_movement_id;

  execute 'reset role';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where player_a_id = least(v_attacker, v_npc_owner)
    and player_b_id = greatest(v_attacker, v_npc_owner);

  assert v_relation_count = 0, 'attacking an NPC-owned territory must not create a diplomacy relation row';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where v_attacker in (player_a_id, player_b_id);

  assert v_relation_count = v_total_relations,
    'attacking an NPC-owned territory must not change the attacker''s diplomacy relation count';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_attacker::text, true);

  select declare_attack(
    v_origin_territory_id,
    v_empty_target,
    array[v_card_d]::uuid[],
    null
  ) into v_movement_id;

  execute 'reset role';

  select count(*)
  into v_relation_count
  from diplomacy_relations
  where v_attacker in (player_a_id, player_b_id);

  assert v_relation_count = v_total_relations,
    'attacking an empty territory must not create a diplomacy relation row';
end;
$$;

rollback;
