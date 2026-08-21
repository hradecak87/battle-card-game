begin;

do $$
declare
  v_player_ids uuid[] := '{}'::uuid[];
  v_index integer;
  v_coalition_a uuid;
  v_coalition_b uuid;
  v_coalition_c uuid;
  v_coalition_d uuid;
  v_coalition_e uuid;
  v_coalition_f uuid;
  v_coalition_g uuid;
  v_coalition_h uuid;
  v_coalition_i uuid;
  v_coalition_war uuid;
  v_coalition_cap uuid;
  v_coalition_cap2 uuid;
  v_coalition_battle uuid;
  v_invite_id uuid;
  v_request_id uuid;
  v_other_invite_id uuid;
  v_other_request_id uuid;
  v_members jsonb;
  v_count integer;
  v_failed boolean;
  v_name text := 'verification-reusable-coalition-0064';
begin
  assert to_regprocedure('coalition_get_mine()') is not null, 'missing coalition_get_mine()';
  assert to_regprocedure('coalition_list()') is not null, 'missing coalition_list()';
  assert to_regprocedure('coalition_list_invites()') is not null, 'missing coalition_list_invites()';
  assert to_regprocedure('coalition_list_join_requests(uuid)') is not null, 'missing coalition_list_join_requests(uuid)';
  assert to_regprocedure('coalition_create(text)') is not null, 'missing coalition_create(text)';
  assert to_regprocedure('coalition_invite(uuid,uuid)') is not null, 'missing coalition_invite(uuid,uuid)';
  assert to_regprocedure('coalition_request_join(uuid)') is not null, 'missing coalition_request_join(uuid)';
  assert to_regprocedure('coalition_accept_invite(uuid)') is not null, 'missing coalition_accept_invite(uuid)';
  assert to_regprocedure('coalition_accept_request(uuid)') is not null, 'missing coalition_accept_request(uuid)';
  assert to_regprocedure('coalition_reject_invite(uuid)') is not null, 'missing coalition_reject_invite(uuid)';
  assert to_regprocedure('coalition_cancel_invite(uuid)') is not null, 'missing coalition_cancel_invite(uuid)';
  assert to_regprocedure('coalition_reject_request(uuid)') is not null, 'missing coalition_reject_request(uuid)';
  assert to_regprocedure('coalition_cancel_request(uuid)') is not null, 'missing coalition_cancel_request(uuid)';
  assert to_regprocedure('coalition_kick(uuid)') is not null, 'missing coalition_kick(uuid)';
  assert to_regprocedure('coalition_transfer_leadership(uuid)') is not null, 'missing coalition_transfer_leadership(uuid)';
  assert to_regprocedure('coalition_leave()') is not null, 'missing coalition_leave()';
  assert to_regprocedure('coalition_disband()') is not null, 'missing coalition_disband()';
  assert to_regprocedure('coalition_declare_war(uuid)') is not null, 'missing coalition_declare_war(uuid)';
  assert to_regprocedure('coalition_declare_peace(uuid)') is not null, 'missing coalition_declare_peace(uuid)';
  assert to_regprocedure('_diplomacy_declare_war_core(uuid,uuid)') is not null, 'missing _diplomacy_declare_war_core(uuid,uuid)';

  -- Create a fully isolated cohort of throwaway authenticated players for
  -- this verification run.
  for v_index in 1..16 loop
    v_player_ids := array_append(v_player_ids, gen_random_uuid());

    insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      v_player_ids[v_index],
      'authenticated',
      'authenticated',
      format('coalition-verification-%s@example.com', v_index),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'display_name', format('Coalition Verify %s', v_index),
        'nation', 'england'
      ),
      now(),
      now()
    );

    perform _complete_kingdom_onboarding_core(
      v_player_ids[v_index],
      format('Verification Kingdom %s', v_index),
      'lion-gold'
    );
  end loop;

  -- Scenario A: create -> invite+accept -> request+accept -> kick ->
  -- leadership transfer -> non-leader leave -> sole-leader auto-disband.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[1]::text, true);
  select coalition_create('verification-coalition-a-0064') into v_coalition_a;
  select count(*)
  into v_count
  from coalition_list()
  where id = v_coalition_a
    and member_count = 1;
  execute 'reset role';
  assert v_count = 1, 'coalition_create should create a browsable one-member coalition';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[1]::text, true);
  select coalition_invite(v_coalition_a, v_player_ids[2]) into v_invite_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[2]::text, true);
  select count(*)
  into v_count
  from coalition_list_invites()
  where id = v_invite_id;
  perform coalition_accept_invite(v_invite_id);
  select members into v_members
  from coalition_get_mine()
  where id = v_coalition_a;
  execute 'reset role';
  assert v_count = 1, 'coalition_list_invites should show the pending invite to the invitee';
  assert jsonb_array_length(v_members) = 2, 'coalition_get_mine should list both leader and accepted member';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[3]::text, true);
  select coalition_request_join(v_coalition_a) into v_request_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[1]::text, true);
  select count(*)
  into v_count
  from coalition_list_join_requests(v_coalition_a)
  where id = v_request_id;
  perform coalition_accept_request(v_request_id);
  execute 'reset role';
  assert v_count = 1, 'coalition_list_join_requests should show the pending join request to the leader';

  select count(*)
  into v_count
  from coalition_members
  where coalition_id = v_coalition_a;
  assert v_count = 3, 'invite+accept and request+accept should yield three coalition members';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[1]::text, true);
  perform coalition_kick(v_player_ids[3]);
  perform coalition_transfer_leadership(v_player_ids[2]);
  execute 'reset role';

  select count(*)
  into v_count
  from coalition_members
  where coalition_id = v_coalition_a
    and player_id = v_player_ids[3];
  assert v_count = 0, 'coalition_kick should remove the targeted member';

  select count(*)
  into v_count
  from coalitions
  where id = v_coalition_a
    and leader_id = v_player_ids[2];
  assert v_count = 1, 'coalition_transfer_leadership should update the leader_id';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[1]::text, true);
  perform coalition_leave();
  execute 'reset role';

  select count(*)
  into v_count
  from coalition_members
  where coalition_id = v_coalition_a;
  assert v_count = 1, 'non-leader leave should keep the coalition active for the remaining leader';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[2]::text, true);
  perform coalition_leave();
  execute 'reset role';

  select count(*)
  into v_count
  from coalitions
  where id = v_coalition_a
    and disbanded_at is not null;
  assert v_count = 1, 'sole leader leaving should auto-disband the coalition';

  -- Scenario B: accepting one path cancels the other pending invite/request.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[4]::text, true);
  select coalition_create('verification-coalition-b-0064') into v_coalition_b;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[5]::text, true);
  select coalition_create('verification-coalition-c-0064') into v_coalition_c;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[4]::text, true);
  select coalition_invite(v_coalition_b, v_player_ids[6]) into v_invite_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[6]::text, true);
  select coalition_request_join(v_coalition_c) into v_request_id;
  perform coalition_accept_invite(v_invite_id);
  execute 'reset role';

  select count(*)
  into v_count
  from coalition_invites
  where id = v_invite_id
    and status = 'accepted';
  assert v_count = 1, 'accepting the invite should mark that invite accepted';

  select count(*)
  into v_count
  from coalition_join_requests
  where id = v_request_id
    and status = 'cancelled';
  assert v_count = 1, 'accepting one coalition path should cancel the player''s other pending coalition path';

  -- Scenario C: disband cancels own pending rows and the name becomes reusable.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[7]::text, true);
  select coalition_create(v_name) into v_coalition_d;
  select coalition_invite(v_coalition_d, v_player_ids[8]) into v_invite_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[9]::text, true);
  select coalition_request_join(v_coalition_d) into v_request_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[7]::text, true);
  perform coalition_disband();
  execute 'reset role';

  select count(*)
  into v_count
  from coalition_invites
  where id = v_invite_id
    and status = 'cancelled';
  assert v_count = 1, 'coalition_disband should cancel the coalition''s pending invites';

  select count(*)
  into v_count
  from coalition_join_requests
  where id = v_request_id
    and status = 'cancelled';
  assert v_count = 1, 'coalition_disband should cancel the coalition''s pending join requests';

  select count(*)
  into v_count
  from coalitions
  where id = v_coalition_d
    and disbanded_at is not null;
  assert v_count = 1, 'coalition_disband should keep the row and set disbanded_at';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[10]::text, true);
  select coalition_create(v_name) into v_coalition_e;
  execute 'reset role';
  assert v_coalition_e is not null, 'a disbanded coalition name should be reusable immediately';

  -- Scenario D: kicking/leaving must not touch unrelated pending rows.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[11]::text, true);
  select coalition_create('verification-coalition-f-0064') into v_coalition_f;
  select coalition_invite(v_coalition_f, v_player_ids[12]) into v_invite_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[12]::text, true);
  perform coalition_accept_invite(v_invite_id);
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[13]::text, true);
  select coalition_create('verification-coalition-g-0064') into v_coalition_g;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[14]::text, true);
  select coalition_create('verification-coalition-h-0064') into v_coalition_h;
  execute 'reset role';

  v_other_invite_id := gen_random_uuid();
  insert into coalition_invites (id, coalition_id, invited_player_id, invited_by, status)
  values (v_other_invite_id, v_coalition_g, v_player_ids[12], v_player_ids[13], 'pending');

  v_other_request_id := gen_random_uuid();
  insert into coalition_join_requests (id, coalition_id, player_id, status)
  values (v_other_request_id, v_coalition_h, v_player_ids[12], 'pending');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[11]::text, true);
  perform coalition_kick(v_player_ids[12]);
  execute 'reset role';

  select count(*)
  into v_count
  from coalition_invites
  where id = v_other_invite_id
    and status = 'pending';
  assert v_count = 1, 'kicking from one coalition must not cancel unrelated pending invites elsewhere';

  select count(*)
  into v_count
  from coalition_join_requests
  where id = v_other_request_id
    and status = 'pending';
  assert v_count = 1, 'kicking from one coalition must not cancel unrelated pending join requests elsewhere';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[15]::text, true);
  select coalition_create('verification-coalition-i-0064') into v_coalition_i;
  select coalition_invite(v_coalition_i, v_player_ids[16]) into v_invite_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[16]::text, true);
  perform coalition_accept_invite(v_invite_id);
  execute 'reset role';

  v_other_invite_id := gen_random_uuid();
  insert into coalition_invites (id, coalition_id, invited_player_id, invited_by, status)
  values (v_other_invite_id, v_coalition_g, v_player_ids[16], v_player_ids[13], 'pending');

  v_other_request_id := gen_random_uuid();
  insert into coalition_join_requests (id, coalition_id, player_id, status)
  values (v_other_request_id, v_coalition_h, v_player_ids[16], 'pending');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[16]::text, true);
  perform coalition_leave();
  execute 'reset role';

  select count(*)
  into v_count
  from coalition_invites
  where id = v_other_invite_id
    and status = 'pending';
  assert v_count = 1, 'leaving one coalition must not cancel unrelated pending invites elsewhere';

  select count(*)
  into v_count
  from coalition_join_requests
  where id = v_other_request_id
    and status = 'pending';
  assert v_count = 1, 'leaving one coalition must not cancel unrelated pending join requests elsewhere';

  -- Scenario E: join blocked by war, but allowed with pact and pact removed.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[7]::text, true);
  select coalition_create('verification-coalition-war-0064') into v_coalition_war;
  select coalition_invite(v_coalition_war, v_player_ids[8]) into v_invite_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[8]::text, true);
  perform coalition_accept_invite(v_invite_id);
  execute 'reset role';

  insert into diplomacy_relations (player_a_id, player_b_id, state)
  values (least(v_player_ids[8], v_player_ids[9]), greatest(v_player_ids[8], v_player_ids[9]), 'war');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[9]::text, true);
  v_failed := false;
  begin
    perform coalition_request_join(v_coalition_war);
  exception when others then
    v_failed := position('at war with a member' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'coalition_request_join should reject players at war with an existing member';

  delete from diplomacy_relations
  where player_a_id = least(v_player_ids[8], v_player_ids[9])
    and player_b_id = greatest(v_player_ids[8], v_player_ids[9]);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[7]::text, true);
  select coalition_invite(v_coalition_war, v_player_ids[3]) into v_invite_id;
  execute 'reset role';

  insert into diplomacy_relations (player_a_id, player_b_id, state)
  values (least(v_player_ids[3], v_player_ids[7]), greatest(v_player_ids[3], v_player_ids[7]), 'war');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[3]::text, true);
  v_failed := false;
  begin
    perform coalition_accept_invite(v_invite_id);
  exception when others then
    v_failed := position('at war with a member' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'coalition_accept_invite should reject stale invites that became invalid due to war';

  select count(*)
  into v_count
  from coalition_invites
  where id = v_invite_id
    and status = 'pending';
  assert v_count = 1, 'stale invite blocked by war should remain pending after the failed acceptance';

  delete from diplomacy_relations
  where player_a_id = least(v_player_ids[3], v_player_ids[7])
    and player_b_id = greatest(v_player_ids[3], v_player_ids[7]);

  insert into diplomacy_relations (player_a_id, player_b_id, state)
  values (least(v_player_ids[11], v_player_ids[12]), greatest(v_player_ids[11], v_player_ids[12]), 'non_aggression');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[12]::text, true);
  select coalition_request_join(v_coalition_f) into v_request_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[11]::text, true);
  perform coalition_accept_request(v_request_id);
  execute 'reset role';

  select count(*)
  into v_count
  from coalition_members
  where coalition_id = v_coalition_f
    and player_id = v_player_ids[12];
  assert v_count = 1, 'coalition_accept_request should allow joining over an existing non-aggression pact';

  select count(*)
  into v_count
  from diplomacy_relations
  where player_a_id = least(v_player_ids[11], v_player_ids[12])
    and player_b_id = greatest(v_player_ids[11], v_player_ids[12])
    and state = 'non_aggression';
  assert v_count = 0, 'joining a coalition should delete redundant non-aggression rows with current members';

  -- Free players before the capacity and coalition-war scenarios.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[4]::text, true);
  perform coalition_disband();
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[5]::text, true);
  perform coalition_disband();
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[10]::text, true);
  perform coalition_disband();
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[11]::text, true);
  perform coalition_transfer_leadership(v_player_ids[12]);
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[11]::text, true);
  perform coalition_leave();
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[12]::text, true);
  perform coalition_leave();
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[13]::text, true);
  perform coalition_disband();
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[14]::text, true);
  perform coalition_disband();
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[15]::text, true);
  perform coalition_disband();
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[7]::text, true);
  perform coalition_disband();
  execute 'reset role';

  -- Scenario F: capacity rejection at 10 and stale over-cap invite acceptance.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[1]::text, true);
  select coalition_create('verification-coalition-cap-0064') into v_coalition_cap;
  execute 'reset role';

  insert into coalition_members (coalition_id, player_id)
  select v_coalition_cap, player_id
  from unnest(array[
    v_player_ids[2], v_player_ids[3], v_player_ids[4], v_player_ids[5], v_player_ids[6],
    v_player_ids[7], v_player_ids[8], v_player_ids[9], v_player_ids[10]
  ]::uuid[]) as members(player_id);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[1]::text, true);
  v_failed := false;
  begin
    perform coalition_invite(v_coalition_cap, v_player_ids[11]);
  exception when others then
    v_failed := position('member cap (10) reached' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'coalition_invite should reject when the coalition already has 10 members';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[11]::text, true);
  v_failed := false;
  begin
    perform coalition_request_join(v_coalition_cap);
  exception when others then
    v_failed := position('member cap (10) reached' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'coalition_request_join should reject when the coalition already has 10 members';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[1]::text, true);
  perform coalition_disband();
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[12]::text, true);
  select coalition_create('verification-coalition-cap2-0064') into v_coalition_cap2;
  select coalition_invite(v_coalition_cap2, v_player_ids[11]) into v_invite_id;
  execute 'reset role';

  insert into coalition_members (coalition_id, player_id)
  select v_coalition_cap2, player_id
  from unnest(array[
    v_player_ids[1], v_player_ids[2], v_player_ids[3], v_player_ids[4],
    v_player_ids[5], v_player_ids[6], v_player_ids[7], v_player_ids[8]
  ]::uuid[]) as members(player_id);

  insert into coalition_members (coalition_id, player_id)
  values (v_coalition_cap2, v_player_ids[9]);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[11]::text, true);
  v_failed := false;
  begin
    perform coalition_accept_invite(v_invite_id);
  exception when others then
    v_failed := position('member cap (10) reached' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'coalition_accept_invite should reject stale invites once the coalition fills to 10';

  select count(*)
  into v_count
  from coalition_invites
  where id = v_invite_id
    and status = 'pending';
  assert v_count = 1, 'stale over-cap invite should remain pending after the failed acceptance';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[12]::text, true);
  perform coalition_disband();
  execute 'reset role';

  -- Scenario G: coalition-wide war and peace helpers.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[13]::text, true);
  select coalition_create('verification-coalition-battle-0064') into v_coalition_battle;
  select coalition_invite(v_coalition_battle, v_player_ids[14]) into v_invite_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[14]::text, true);
  perform coalition_accept_invite(v_invite_id);
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[15]::text, true);
  select coalition_request_join(v_coalition_battle) into v_request_id;
  execute 'reset role';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[13]::text, true);
  perform coalition_accept_request(v_request_id);
  v_failed := false;
  begin
    perform coalition_declare_war(v_player_ids[14]);
  exception when others then
    v_failed := position('own members' in sqlerrm) > 0;
  end;
  execute 'reset role';
  assert v_failed, 'coalition_declare_war should reject targeting one of the coalition''s own members';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[13]::text, true);
  perform coalition_declare_war(v_player_ids[16]);
  execute 'reset role';

  select count(*)
  into v_count
  from diplomacy_relations
  where state = 'war'
    and player_a_id in (
      least(v_player_ids[13], v_player_ids[16]),
      least(v_player_ids[14], v_player_ids[16]),
      least(v_player_ids[15], v_player_ids[16])
    )
    and player_b_id in (
      greatest(v_player_ids[13], v_player_ids[16]),
      greatest(v_player_ids[14], v_player_ids[16]),
      greatest(v_player_ids[15], v_player_ids[16])
    );
  assert v_count = 3, 'coalition_declare_war should create war rows for every coalition member';

  select count(*)
  into v_count
  from world_events
  where event_type = 'coalition_war_declared'
    and payload->>'coalition_id' = v_coalition_battle::text
    and payload->>'target_id' = v_player_ids[16]::text;
  assert v_count = 1, 'coalition_declare_war should log exactly one coalition_war_declared event';

  select count(*)
  into v_count
  from world_events
  where event_type = 'war_declared'
    and payload->>'defender_id' = v_player_ids[16]::text
    and payload->>'attacker_id' in (
      v_player_ids[13]::text,
      v_player_ids[14]::text,
      v_player_ids[15]::text
    );
  assert v_count = 3, 'coalition_declare_war should still log one per-member war_declared event';

  perform _diplomacy_propose_peace_core(
    v_player_ids[14],
    v_player_ids[16],
    'white_peace',
    '{}'::uuid[],
    null
  );

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[13]::text, true);
  perform coalition_declare_peace(v_player_ids[16]);
  execute 'reset role';

  select count(*)
  into v_count
  from diplomacy_offers
  where target_id = v_player_ids[16]
    and kind = 'white_peace'
    and status = 'pending'
    and initiator_id in (v_player_ids[13], v_player_ids[14], v_player_ids[15]);
  assert v_count = 3, 'coalition_declare_peace should leave one pending white-peace offer per at-war member, including the pre-existing duplicate';

  select count(*)
  into v_count
  from diplomacy_offers
  where initiator_id = v_player_ids[14]
    and target_id = v_player_ids[16]
    and kind = 'white_peace'
    and status = 'pending';
  assert v_count = 1, 'coalition_declare_peace should skip duplicate pending offers instead of creating a second one';

  select count(*)
  into v_count
  from diplomacy_relations
  where state = 'war'
    and player_a_id in (
      least(v_player_ids[13], v_player_ids[16]),
      least(v_player_ids[14], v_player_ids[16]),
      least(v_player_ids[15], v_player_ids[16])
    )
    and player_b_id in (
      greatest(v_player_ids[13], v_player_ids[16]),
      greatest(v_player_ids[14], v_player_ids[16]),
      greatest(v_player_ids[15], v_player_ids[16])
    );
  assert v_count = 3, 'coalition_declare_peace must not delete any war rows';

  select count(*)
  into v_count
  from world_events
  where event_type = 'coalition_peace_signed'
    and payload->>'coalition_id' = v_coalition_battle::text
    and payload->>'target_id' = v_player_ids[16]::text;
  assert v_count = 1, 'coalition_declare_peace should log exactly one coalition_peace_signed event';
end;
$$;

rollback;
