-- 0043_diplomacy.verification.sql
--
-- Safe verification for diplomacy schema/RLS.
-- Runs in a transaction and finishes with ROLLBACK.

begin;

do $$
declare
  v_player_a uuid;
  v_player_b uuid;
  v_player_c uuid;
  v_duplicate_failed boolean := false;
  v_pending_count integer;
begin
  assert to_regclass('diplomacy_relations') is not null, 'missing diplomacy_relations table';
  assert to_regclass('diplomacy_offers') is not null, 'missing diplomacy_offers table';

  assert exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'diplomacy_offers'
      and indexname = 'diplomacy_offers_pending_initiator_target_idx'
  ), 'missing diplomacy_offers_pending_initiator_target_idx';

  select id into v_player_a
  from players
  order by created_at, id
  limit 1;

  select id into v_player_b
  from players
  where id <> v_player_a
  order by created_at, id
  limit 1;

  select id into v_player_c
  from players
  where id not in (v_player_a, v_player_b)
  order by created_at, id
  limit 1;

  assert v_player_a is not null and v_player_b is not null and v_player_c is not null,
    'need at least three players for diplomacy verification';

  insert into diplomacy_relations (player_a_id, player_b_id)
  values (least(v_player_a, v_player_b), greatest(v_player_a, v_player_b));

  insert into diplomacy_offers (initiator_id, target_id, kind, offered_card_ids)
  values (v_player_a, v_player_b, 'white_peace', '{}'::uuid[]);

  begin
    insert into diplomacy_offers (initiator_id, target_id, kind, offered_card_ids)
    values (v_player_a, v_player_b, 'white_peace', '{}'::uuid[]);
  exception
    when unique_violation then
      v_duplicate_failed := true;
  end;

  assert v_duplicate_failed,
    'expected second pending diplomacy offer from the same initiator to the same target to fail';

  insert into world_events (event_type, payload)
  values
    ('war_declared', '{"ok": true}'::jsonb),
    ('peace_signed', '{"ok": true}'::jsonb);
end;
$$;

set local role authenticated;

do $$
declare
  v_player_a uuid;
  v_player_b uuid;
  v_player_c uuid;
  v_visible_relations integer;
  v_visible_offers integer;
begin
  select id into v_player_a
  from players
  order by created_at, id
  limit 1;

  select id into v_player_b
  from players
  where id <> v_player_a
  order by created_at, id
  limit 1;

  select id into v_player_c
  from players
  where id not in (v_player_a, v_player_b)
  order by created_at, id
  limit 1;

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);

  select count(*)
  into v_visible_relations
  from diplomacy_relations
  where player_a_id = least(v_player_a, v_player_b)
    and player_b_id = greatest(v_player_a, v_player_b);

  select count(*)
  into v_visible_offers
  from diplomacy_offers
  where initiator_id = v_player_a
    and target_id = v_player_b
    and status = 'pending';

  assert v_visible_relations = 1, 'participant should see their diplomacy relation row';
  assert v_visible_offers = 1, 'participant should see their diplomacy offer row';

  perform set_config('request.jwt.claim.sub', v_player_c::text, true);

  select count(*)
  into v_visible_relations
  from diplomacy_relations
  where player_a_id = least(v_player_a, v_player_b)
    and player_b_id = greatest(v_player_a, v_player_b);

  select count(*)
  into v_visible_offers
  from diplomacy_offers
  where initiator_id = v_player_a
    and target_id = v_player_b
    and status = 'pending';

  assert v_visible_relations = 0, 'third player must not see another pair''s diplomacy relation row';
  assert v_visible_offers = 0, 'third player must not see another pair''s diplomacy offer row';
end;
$$;

rollback;
