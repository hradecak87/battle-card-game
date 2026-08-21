-- Verification for 0066_search_players.sql (rollback-wrapped: run inside a
-- transaction and roll back at the end, leaving no test data behind).

begin;

do $$
declare
  v_player_ids uuid[] := '{}'::uuid[];
  v_index integer;
  v_count integer;
  v_failed boolean;
begin
  assert to_regprocedure('search_players(text,integer)') is not null, 'missing search_players(text,integer)';

  -- Player 1: searcher. Player 2: findable target (distinctive name/kingdom/email).
  -- Player 3: unrelated control player.
  for v_index in 1..3 loop
    v_player_ids := array_append(v_player_ids, gen_random_uuid());

    insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      v_player_ids[v_index],
      'authenticated',
      'authenticated',
      case v_index
        when 2 then 'findme-zylo-target@example.com'
        else format('search-verification-%s@example.com', v_index)
      end,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'display_name',
        case v_index
          when 2 then 'Zylo Findable'
          else format('Search Verify %s', v_index)
        end,
        'nation', 'england'
      ),
      now(),
      now()
    );

    perform _complete_kingdom_onboarding_core(
      v_player_ids[v_index],
      case v_index
        when 2 then 'Zylokingdom'
        else format('Search Verify Kingdom %s', v_index)
      end,
      'lion-gold'
    );
  end loop;

  -- Match by display_name substring.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_player_ids[1]::text, true);
  select count(*) into v_count from search_players('Zylo Findable', 8) where id = v_player_ids[2];
  assert v_count = 1, 'expected display_name match';

  -- Match by kingdom_name substring.
  select count(*) into v_count from search_players('Zylokingdom', 8) where id = v_player_ids[2];
  assert v_count = 1, 'expected kingdom_name match';

  -- Match by email substring (email is a match criterion only, never a returned column).
  select count(*) into v_count from search_players('findme-zylo-target', 8) where id = v_player_ids[2];
  assert v_count = 1, 'expected email match';

  -- Unrelated control player never matches an unrelated query term.
  select count(*) into v_count from search_players('Zylo Findable', 8) where id = v_player_ids[3];
  assert v_count = 0, 'unrelated player should not match';

  -- Caller is excluded from their own search results.
  select count(*) into v_count from search_players('Search Verify 1', 8) where id = v_player_ids[1];
  assert v_count = 0, 'caller should be excluded from own results';

  -- Query below 2 chars returns nothing (avoids scanning the whole table on every keystroke).
  select count(*) into v_count from search_players('z', 8);
  assert v_count = 0, 'expected no results for 1-char query';

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);

  -- Unauthenticated caller is rejected.
  v_failed := false;
  begin
    perform search_players('Zylo Findable', 8);
  exception when others then
    v_failed := true;
    assert sqlerrm like '%authenticated%', format('expected auth error, got: %s', sqlerrm);
  end;
  assert v_failed, 'expected unauthenticated search_players to fail';
end $$;

rollback;
