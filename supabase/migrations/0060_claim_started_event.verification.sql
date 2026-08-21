-- 0060_claim_started_event.verification.sql
--
-- Safe verification for the new claim_started world event.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_caller uuid;
  v_npc_owner uuid;
  v_origin_territory_id integer;
  v_dest_territory_id integer;
  v_npc_origin_territory_id integer;
  v_npc_dest_territory_id integer;
  v_template_id text;
  v_card_a uuid;
  v_card_b uuid;
  v_event_count integer;
begin
  assert to_regprocedure('_start_claim_core(uuid, integer, integer, uuid[])') is not null,
    'missing _start_claim_core(uuid, integer, integer, uuid[])';

  select id into v_caller
  from players
  where coalesce(is_npc, false) = false
  order by created_at, id
  limit 1;

  select id into v_npc_owner
  from players
  where coalesce(is_npc, false) = true
  order by created_at, id
  limit 1;

  assert v_caller is not null and v_npc_owner is not null,
    'need one human player and one NPC player for claim_started verification';

  select id into v_template_id
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  assert v_template_id is not null, 'need at least one unit template for claim_started verification';

  select id into v_origin_territory_id
  from territories
  where owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_dest_territory_id
  from territories
  where id > v_origin_territory_id
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_npc_origin_territory_id
  from territories
  where id > v_dest_territory_id
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  select id into v_npc_dest_territory_id
  from territories
  where id > v_npc_origin_territory_id
    and owner_id is null and claim_locked_by is null and battle_locked_by is null and not is_home
  order by id
  limit 1;

  assert v_origin_territory_id is not null
    and v_dest_territory_id is not null
    and v_npc_origin_territory_id is not null
    and v_npc_dest_territory_id is not null,
    'need four unlocked empty territories for claim_started verification';

  update territories
  set owner_id = v_caller,
      claim_locked_by = null, claim_started_at = null,
      claim_transfer_arrives_at = null, claim_occupation_completes_at = null,
      battle_locked_by = null, is_home = false
  where id = v_origin_territory_id;

  update territories
  set owner_id = v_npc_owner,
      claim_locked_by = null, claim_started_at = null,
      claim_transfer_arrives_at = null, claim_occupation_completes_at = null,
      battle_locked_by = null, is_home = false
  where id = v_npc_origin_territory_id;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_caller, v_origin_territory_id, 'stationed')
  returning instance_id into v_card_a;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_id, v_npc_owner, v_npc_origin_territory_id, 'stationed')
  returning instance_id into v_card_b;

  -- Player-initiated claim.
  perform _start_claim_core(v_caller, v_origin_territory_id, v_dest_territory_id, array[v_card_a]::uuid[]);

  select count(*) into v_event_count
  from world_events
  where event_type = 'claim_started'
    and payload->>'player_id' = v_caller::text
    and (payload->>'territory_id')::integer = v_dest_territory_id;

  assert v_event_count = 1, 'player claim start should log exactly one claim_started world event';

  -- NPC-initiated claim (same shared core function).
  perform _start_claim_core(v_npc_owner, v_npc_origin_territory_id, v_npc_dest_territory_id, array[v_card_b]::uuid[]);

  select count(*) into v_event_count
  from world_events
  where event_type = 'claim_started'
    and payload->>'player_id' = v_npc_owner::text
    and (payload->>'territory_id')::integer = v_npc_dest_territory_id;

  assert v_event_count = 1, 'NPC claim start should log exactly one claim_started world event';
end;
$$;

rollback;
