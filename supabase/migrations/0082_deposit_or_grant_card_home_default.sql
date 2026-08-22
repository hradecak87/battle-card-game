-- Bug fix: _deposit_or_grant_card() left a newly granted card unstationed
-- (stationed_territory_id = null) in its "under the deck limit" branch,
-- even though it sets status = 'stationed'. Every caller (level-up
-- rewards, daily-reward streak bonuses, the scout starter kit/streak
-- grant, the 5% battle-win scout drop) inserts the new card_instances row
-- with stationed_territory_id = null and relies on this function to place
-- it -- so the card ended up permanently "stationed" nowhere.
--
-- Symptom reported by the user: a scout card granted via the daily
-- reward showed up in /collection under "Na cestě" (its `locationLabel()`
-- falls back to "Na cestě" whenever a card has no joined `territories`
-- row -- see app/collection/page.tsx), even though its status was
-- actually 'stationed', not 'in_transit'. The card was never anywhere,
-- not literally "on its way" anywhere.
--
-- Fix: mirror the identical home-territory-default fix already applied
-- to `admin_grant_card()` in 0051_admin_grant_card_home_default.sql --
-- when granting into the "stationed" branch (p_status = 'stationed'),
-- default stationed_territory_id to the player's home territory so the
-- card is immediately usable and shows up in the correct place.

create or replace function _deposit_or_grant_card(
  p_player_id uuid,
  p_instance_id uuid,
  p_status text default 'stationed'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xp integer;
  v_level integer;
  v_deck_count integer;
  v_deposit_count integer;
  v_home_territory_id integer;
begin
  perform _expire_deposit(p_player_id);

  select xp
  into v_xp
  from players
  where id = p_player_id
  for update;

  if not found then
    raise exception 'player % not found', p_player_id;
  end if;

  v_level := _level_for_xp(v_xp);

  select count(*)
  into v_deck_count
  from card_instances
  where owner_id = p_player_id
    and status in ('stationed', 'in_transit');

  if v_deck_count < _deck_limit(v_level) then
    if p_status = 'stationed' then
      select id into v_home_territory_id
      from territories
      where owner_id = p_player_id and is_home;
    end if;

    update card_instances
    set owner_id = p_player_id,
        status = p_status,
        stationed_territory_id = case when p_status = 'stationed' then v_home_territory_id else stationed_territory_id end,
        deposit_expires_at = null,
        loaned_from_id = null,
        loan_return_at = null
    where instance_id = p_instance_id;
    return;
  end if;

  select count(*)
  into v_deposit_count
  from card_instances
  where owner_id = p_player_id
    and status = 'deposit';

  if v_deposit_count < _deposit_limit(v_level) then
    update card_instances
    set owner_id = p_player_id,
        stationed_territory_id = null,
        status = 'deposit',
        deposit_expires_at = now() + interval '3 days',
        loaned_from_id = null,
        loan_return_at = null
    where instance_id = p_instance_id;
    return;
  end if;

  update card_instances
  set owner_id = p_player_id,
      stationed_territory_id = null,
      deposit_expires_at = null,
      loaned_from_id = null,
      loan_return_at = null
  where instance_id = p_instance_id;

  perform _return_card(p_instance_id, 'deposit_overflow');
end;
$$;

-- One-off backfill: any already-granted card sitting in this broken
-- 'stationed' + null-territory limbo (e.g. the user's own scout card)
-- gets moved to its owner's home territory now, instead of only fixing
-- it for future grants.
update card_instances ci
set stationed_territory_id = t.id
from territories t
where ci.status = 'stationed'
  and ci.stationed_territory_id is null
  and ci.owner_id is not null
  and t.owner_id = ci.owner_id
  and t.is_home;
