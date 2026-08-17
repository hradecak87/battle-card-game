-- Territory names — manual SQL verification checklist
--
-- NOT part of the applied migration. Paste these into the Supabase SQL
-- editor *after* 0008_territory_names.sql has been applied, to sanity-check
-- schema-level invariants without needing the app running.
-- Run in a scratch/dev project only.

-- ---------------------------------------------------------------------
-- 1. Column exists with the correct constraint.
-- ---------------------------------------------------------------------
-- Expect: column "name" of type text, nullable, default null.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'territories' and column_name = 'name';

-- Expect: SUCCEEDS — null is explicitly allowed.
update territories set name = null where id = (select id from territories limit 1);

-- Expect: FAILS — empty string violates the between 1 and 40 constraint.
update territories set name = '' where id = (select id from territories limit 1);

-- Expect: FAILS — 41 characters violates the between 1 and 40 constraint.
update territories set name = repeat('a', 41) where id = (select id from territories limit 1);

-- ---------------------------------------------------------------------
-- 2. Owner can rename their territory.
-- ---------------------------------------------------------------------
-- Setup: pick a territory owned by the current test player, e.g.
--   select id from territories where owner_id = auth.uid() limit 1;
-- Substitute as :territory_id below.

-- Expect: SUCCEEDS. Verify with:
--   select name from territories where id = :territory_id;
select rename_territory(:territory_id, 'Hrad Orlík');

-- Expect: name = 'Hrad Orlík'
select name from territories where id = :territory_id;

-- ---------------------------------------------------------------------
-- 3. Non-owner rename raises an exception.
-- ---------------------------------------------------------------------
-- Setup: pick a territory owned by a *different* player, e.g.
--   select id from territories where owner_id != auth.uid() and owner_id is not null limit 1;
-- Substitute as :other_territory_id below.

-- Expect: FAILS with "caller does not own territory <id>".
select rename_territory(:other_territory_id, 'Skradený název');

-- Expect: FAILS with same error for an unowned territory.
select rename_territory((select id from territories where owner_id is null limit 1), 'Test');

-- ---------------------------------------------------------------------
-- 4. Clearing the name via empty string sets it back to null.
-- ---------------------------------------------------------------------
-- Expect: SUCCEEDS. The name set in step 2 should now be null.
select rename_territory(:territory_id, '');

-- Expect: name = null
select name from territories where id = :territory_id;

-- Also test clearing via a whitespace-only string (trim → '').
select rename_territory(:territory_id, 'Dočasné jméno');
select rename_territory(:territory_id, '   ');

-- Expect: name = null
select name from territories where id = :territory_id;

-- ---------------------------------------------------------------------
-- 5. Name over 40 characters raises an exception.
-- ---------------------------------------------------------------------
-- Expect: FAILS with "territory name must be at most 40 characters".
select rename_territory(:territory_id, repeat('x', 41));
