begin;

do $$
declare
  v_player_a uuid;
  v_player_b uuid;
  v_player_c uuid;
  v_coalition_id uuid := gen_random_uuid();
  v_event_type text;
begin
  select p1.id, p2.id, p3.id
  into v_player_a, v_player_b, v_player_c
  from players p1
  join players p2 on p2.id <> p1.id
  join players p3 on p3.id <> p1.id and p3.id <> p2.id
  where not exists (
      select 1
      from diplomacy_relations r
      where r.player_a_id = least(p1.id, p2.id)
        and r.player_b_id = greatest(p1.id, p2.id)
    )
    and not exists (
      select 1
      from diplomacy_offers o
      where o.status = 'pending'
        and (
          (o.initiator_id = p1.id and o.target_id = p2.id)
          or (o.initiator_id = p2.id and o.target_id = p1.id)
        )
    )
  order by p1.created_at, p2.created_at, p3.created_at
  limit 1;

  assert v_player_a is not null and v_player_b is not null and v_player_c is not null,
    'need three distinct players without an existing relation/pending offer pair';

  insert into coalitions (id, name, leader_id)
  values (v_coalition_id, 'verification-coalition-0062', v_player_a);

  insert into coalition_members (coalition_id, player_id)
  values (v_coalition_id, v_player_a);

  insert into coalition_invites (coalition_id, invited_player_id, invited_by, status)
  values (v_coalition_id, v_player_b, v_player_a, 'pending');

  insert into coalition_join_requests (coalition_id, player_id, status)
  values (v_coalition_id, v_player_c, 'pending');

  insert into diplomacy_relations (player_a_id, player_b_id, state)
  values (least(v_player_a, v_player_b), greatest(v_player_a, v_player_b), 'war');

  insert into diplomacy_relations (player_a_id, player_b_id, state)
  values (least(v_player_a, v_player_c), greatest(v_player_a, v_player_c), 'non_aggression');

  insert into diplomacy_offers (
    initiator_id,
    target_id,
    kind,
    offered_card_ids,
    offered_territory_id,
    status
  )
  values (
    v_player_a,
    v_player_b,
    'white_peace',
    '{}'::uuid[],
    null,
    'pending'
  );

  insert into diplomacy_offers (
    initiator_id,
    target_id,
    kind,
    offered_card_ids,
    offered_territory_id,
    status
  )
  values (
    v_player_c,
    v_player_a,
    'non_aggression',
    '{}'::uuid[],
    null,
    'pending'
  );

  foreach v_event_type in array array[
    'coalition_created',
    'coalition_member_joined',
    'coalition_member_left',
    'coalition_member_kicked',
    'coalition_leadership_transferred',
    'coalition_disbanded',
    'coalition_war_declared',
    'coalition_peace_signed',
    'non_aggression_signed',
    'non_aggression_broken'
  ] loop
    insert into world_events (event_type, payload)
    values (v_event_type, '{}'::jsonb);
  end loop;

  assert exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'coalitions'
      and policyname = 'coalitions_select_authenticated'
  ), 'missing coalitions_select_authenticated policy';

  assert exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'coalition_members'
      and policyname = 'coalition_members_select_authenticated'
  ), 'missing coalition_members_select_authenticated policy';

  assert exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'coalition_invites'
      and policyname = 'coalition_invites_select_participants'
  ), 'missing coalition_invites_select_participants policy';

  assert exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'coalition_join_requests'
      and policyname = 'coalition_join_requests_select_participants'
  ), 'missing coalition_join_requests_select_participants policy';
end;
$$;

rollback;
