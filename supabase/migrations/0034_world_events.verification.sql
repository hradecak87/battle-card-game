begin;

do $$
declare
  v_constraint_name text;
  v_invalid_failed boolean := false;
begin
  assert to_regclass('world_events') is not null, 'missing world_events table';

  assert exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'world_events'
      and indexname = 'world_events_created_at_idx'
  ), 'missing world_events_created_at_idx';

  select c.conname
  into v_constraint_name
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any(c.conkey)
  where c.conrelid = 'world_events'::regclass
    and c.contype = 'c'
    and a.attname = 'event_type';

  assert v_constraint_name is not null, 'missing world_events event_type check constraint';

  insert into world_events (event_type, payload)
  values ('attack_declared', '{"ok":true}'::jsonb);

  begin
    insert into world_events (event_type, payload)
    values ('not_a_real_event', '{}'::jsonb);
  exception
    when check_violation then
      v_invalid_failed := true;
  end;

  assert v_invalid_failed, 'invalid event_type should fail the check constraint';
end;
$$;

rollback;
