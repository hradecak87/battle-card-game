-- Territory names — owner can set a custom display name for their territory.
--
-- NOT YET APPLIED: no live Supabase project has this migration applied yet.
-- Once the user gives explicit go-ahead, apply after 0007_combat_probability.sql.
-- See supabase/migrations/0008_territory_names.verification.sql for the manual
-- smoke-test checklist to run immediately after applying.

-- ---------------------------------------------------------------------
-- 1. Add the name column to territories.
-- ---------------------------------------------------------------------
alter table territories
  add column name text,
  add constraint territories_name_length
    check (name is null or char_length(name) between 1 and 40);

-- No RLS changes needed: territories already has a public "select all"
-- policy (territories_select_all in 0002_territories.sql) which is
-- row-level, not column-level — the new column is automatically readable
-- to all authenticated and anonymous callers via that existing policy.
-- All writes still go through the security definer RPC below.

-- ---------------------------------------------------------------------
-- 2. rename_territory RPC — owner-only territory renaming.
-- ---------------------------------------------------------------------
create or replace function rename_territory(
  territory_id integer,
  new_name text
)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_trimmed text;
begin
  -- Ownership check: raise immediately if the caller doesn't own this territory.
  perform id from territories where id = territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own territory %', territory_id;
  end if;

  v_trimmed := trim(new_name);

  -- An empty string (after trim) means "clear the name back to null".
  if v_trimmed = '' then
    update territories set name = null where id = territory_id;
    return;
  end if;

  -- Validate length (1–40 chars), matching the column constraint above.
  if char_length(v_trimmed) > 40 then
    raise exception 'territory name must be at most 40 characters';
  end if;

  update territories set name = v_trimmed where id = territory_id;
end;
$$;
