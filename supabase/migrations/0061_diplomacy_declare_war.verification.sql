-- 0061_diplomacy_declare_war.verification.sql
--
-- Safe verification for the manual diplomacy_declare_war RPC.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_caller uuid;
  v_target uuid;
  v_npc_owner uuid;
  v_relation_count integer;
  v_war_event_count integer;
  v_raised boolean;
begin
  assert to_regprocedure('diplomacy_declare_war(uuid)') is not null,
    'missing diplomacy_declare_war(uuid)';

  select id into v_caller
  from players
  where coalesce(is_npc, false) = false
  order by created_at, id
  limit 1;

  select id into v_target
  from players
  where coalesce(is_npc, false) = false
    and id <> v_caller
  order by created_at, id
  limit 1;

  select id into v_npc_owner
  from players
  where coalesce(is_npc, false) = true
  order by created_at, id
  limit 1;

  assert v_caller is not null and v_target is not null and v_npc_owner is not null,
    'need two human players and one NPC player for diplomacy_declare_war verification';

  -- Cannot declare war on yourself.
  v_raised := false;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_caller::text, true);
    perform diplomacy_declare_war(v_caller);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_raised := true;
  end;
  assert v_raised, 'declaring war on yourself should raise an exception';

  -- Cannot declare war on an NPC kingdom.
  v_raised := false;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_caller::text, true);
    perform diplomacy_declare_war(v_npc_owner);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_raised := true;
  end;
  assert v_raised, 'declaring war on an NPC kingdom should raise an exception';

  -- Successful manual declaration against a real player.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_caller::text, true);
  perform diplomacy_declare_war(v_target);
  execute 'reset role';

  select count(*) into v_relation_count
  from diplomacy_relations
  where player_a_id = least(v_caller, v_target)
    and player_b_id = greatest(v_caller, v_target);

  select count(*) into v_war_event_count
  from world_events
  where event_type = 'war_declared'
    and payload->>'attacker_id' = v_caller::text
    and payload->>'defender_id' = v_target::text;

  assert v_relation_count = 1, 'manual war declaration should create exactly one diplomacy relation row';
  assert v_war_event_count = 1, 'manual war declaration should log exactly one war_declared world event';

  -- Declaring war again against the same target should raise (already at war).
  v_raised := false;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_caller::text, true);
    perform diplomacy_declare_war(v_target);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_raised := true;
  end;
  assert v_raised, 'declaring war on an already-at-war player should raise an exception';

  select count(*) into v_relation_count
  from diplomacy_relations
  where player_a_id = least(v_caller, v_target)
    and player_b_id = greatest(v_caller, v_target);

  assert v_relation_count = 1, 'a rejected repeat declaration must not duplicate the relation row';
end;
$$;

rollback;
