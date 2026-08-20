-- Admin dashboard — manual SQL verification checklist
--
-- NOT part of the applied migration. Paste these into the Supabase SQL
-- editor *after* 0011_admin_dashboard.sql has been applied, to sanity-check
-- admin-only access and the new helper RPCs in a scratch/dev project.
--
-- Run the non-admin section while authenticated as a normal player.
-- Run the admin section in the same authenticated context; the script flips
-- `players.is_admin` for `auth.uid()` inside a transaction and rolls it back.

-- ---------------------------------------------------------------------
-- 1. Non-admin access must fail for every admin_* RPC.
-- ---------------------------------------------------------------------
-- Expect: ERROR "admin access required"
select admin_list_online_players();
-- Expect: ERROR "admin access required"
select admin_list_active_battles();
-- Expect: ERROR "admin access required"
select admin_list_player_cards(auth.uid());
-- Expect: ERROR "admin access required"
select admin_grant_xp(auth.uid(), 25);
-- Expect: ERROR "admin access required"
select admin_grant_card(auth.uid(), (select id from card_templates order by id limit 1), null);
-- Expect: ERROR "admin access required"
select admin_remove_card((select instance_id from card_instances where owner_id = auth.uid() limit 1));

-- ---------------------------------------------------------------------
-- 2. Temporarily promote the current authenticated test player to admin.
-- ---------------------------------------------------------------------
begin;

update players
set is_admin = true
where id = auth.uid();

-- Expect: exactly one row with is_admin = true
select id, display_name, is_admin
from players
where id = auth.uid();

-- ---------------------------------------------------------------------
-- 3. Read RPCs now succeed.
-- ---------------------------------------------------------------------
-- Expect: rows with online/offline booleans and any active battle refs.
select * from admin_list_online_players() order by display_name limit 10;

-- Expect: zero or more unresolved/active battles with territory coords.
select * from admin_list_active_battles() order by id limit 10;

-- Expect: zero or more card rows owned by the current player.
select * from admin_list_player_cards(auth.uid()) limit 10;

-- ---------------------------------------------------------------------
-- 4. XP grant clamps at zero and returns the updated total.
-- ---------------------------------------------------------------------
do $$
declare
  v_before integer;
  v_after integer;
  v_clamped integer;
begin
  select xp into v_before from players where id = auth.uid();

  v_after := admin_grant_xp(auth.uid(), 25);
  assert v_after = v_before + 25,
    format('Expected xp %s + 25 = %s, got %s', v_before, v_before + 25, v_after);

  v_clamped := admin_grant_xp(auth.uid(), -1000000);
  assert v_clamped = 0,
    format('Expected clamp to 0, got %s', v_clamped);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Card grant + remove round-trip.
-- ---------------------------------------------------------------------
do $$
declare
  v_template_id text;
  v_instance_id uuid;
begin
  select id into v_template_id from card_templates order by id limit 1;

  v_instance_id := admin_grant_card(auth.uid(), v_template_id, null);

  -- 2026-08-20: admin_grant_card() now defaults to the caller's home
  -- territory when p_territory_id is null (see 0051_admin_grant_card_home_default.sql),
  -- so the granted card is immediately usable instead of floating unstationed.
  assert exists (
    select 1
    from card_instances
    where instance_id = v_instance_id
      and owner_id = auth.uid()
      and template_id = v_template_id
      and stationed_territory_id = (select id from territories where owner_id = auth.uid() and is_home)
  ), 'Expected newly granted card instance to be stationed at the caller''s home territory';

  perform admin_remove_card(v_instance_id);

  assert not exists (
    select 1 from card_instances where instance_id = v_instance_id
  ), 'Expected granted test card to be removed again';
end;
$$;

rollback;
