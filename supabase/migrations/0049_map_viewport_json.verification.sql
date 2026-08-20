-- Verification for 0049_map_viewport_json.sql: get_viewport now returns a
-- single jsonb array instead of one row per territory, and must return
-- correct data for viewport sizes that exceed 1000 tiles (which the old
-- `returns table` version silently truncated).
do $$
declare
  v_result jsonb;
  v_count integer;
  v_sample_row jsonb;
begin
  -- Sanity: a normal small viewport still returns the right shape/columns.
  select get_viewport(0::smallint, 0::smallint, 4::smallint, 4::smallint) into v_result;
  if jsonb_typeof(v_result) <> 'array' then
    raise exception 'get_viewport must return a jsonb array, got %', jsonb_typeof(v_result);
  end if;

  select jsonb_array_length(v_result) into v_count;
  if v_count <> 25 then
    raise exception 'expected 25 tiles for a 5x5 viewport, got %', v_count;
  end if;

  select v_result -> 0 into v_sample_row;
  if not (v_sample_row ? 'id' and v_sample_row ? 'x' and v_sample_row ? 'y'
          and v_sample_row ? 'difficulty' and v_sample_row ? 'owner_is_npc') then
    raise exception 'get_viewport row is missing expected columns: %', v_sample_row;
  end if;

  -- The whole point of this migration: a viewport well over the old
  -- 1000-row PostgREST cap (49x49 = 2401 tiles) must come back complete,
  -- not silently truncated.
  select get_viewport(0::smallint, 0::smallint, 48::smallint, 48::smallint) into v_result;
  select jsonb_array_length(v_result) into v_count;
  if v_count <> 2401 then
    raise exception 'expected 2401 tiles for a 49x49 viewport, got % (regression: row cap truncation?)', v_count;
  end if;

  -- Empty/out-of-range viewport returns an empty array, not null.
  select get_viewport(300::smallint, 300::smallint, 305::smallint, 305::smallint) into v_result;
  if v_result is null or jsonb_typeof(v_result) <> 'array' or jsonb_array_length(v_result) <> 0 then
    raise exception 'expected an empty jsonb array for an out-of-bounds viewport, got %', v_result;
  end if;

  raise notice 'get_viewport jsonb verification passed';
end;
$$;
