-- ---------------------------------------------------------------------------
-- 0073_recall_loan_returns_to_origin.sql
--
-- Bug fix (reported during live playtesting): `_recall_loan_core` computed
-- the loan_return movement's distance/duration from the lender's HOME
-- territory to the loan's current (borrower's) territory. For a loan that
-- was originally lent from some nearby border territory (not home), this
-- made the return trip far longer and more confusing than the original
-- loan transfer ever was — e.g. a loan that took under an hour to deliver
-- could take over a week to "return home" if home was on the far side of
-- the map.
--
-- Fix: `_recall_loan_core` now looks up the origin territory of the most
-- recent `loan` movement that carried this specific card (via
-- `troop_movement_units` -> `troop_movements`) and returns the troops
-- there instead — i.e. back to wherever they actually departed from, not
-- necessarily home. Falls back to the lender's current home territory if
-- that original loan movement can't be found, or its origin territory is
-- no longer owned by the lender (e.g. lost since in battle) — same
-- fallback the old code always used.
--
-- The function's OUT columns `lender_home_territory_*` are renamed to
-- `return_territory_*` to reflect the new, more general meaning. No
-- external caller referenced those columns by name (only
-- `lender_id`/`loan_territory_*`/`borrower_id`/`borrower_display_name`),
-- so this is a safe rename.
-- ---------------------------------------------------------------------------

-- The OUT columns changed name (lender_home_territory_* ->
-- return_territory_*), so the return type differs and Postgres requires
-- dropping the old function before recreating it with `create or replace`.
drop function if exists _recall_loan_core(uuid, uuid);

create or replace function _recall_loan_core(
  p_caller uuid,
  p_card_instance_id uuid
)
returns table (
  lender_id uuid,
  lender_display_name text,
  borrower_id uuid,
  borrower_display_name text,
  loan_territory_id integer,
  loan_territory_x smallint,
  loan_territory_y smallint,
  loan_territory_name text,
  return_territory_id integer,
  return_territory_x smallint,
  return_territory_y smallint,
  return_territory_name text,
  return_movement_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card record;
  v_lender_nation nation_id;
  v_distance numeric;
  v_group_speed numeric;
  v_speed_mult numeric;
  v_transfer_hrs numeric;
  v_arrives_at timestamptz;
  v_origin_territory_id integer;
  v_origin_owner uuid;
begin
  select
    ci.instance_id,
    ci.owner_id as borrower_id_value,
    ci.loaned_from_id as lender_id_value,
    ci.stationed_territory_id as territory_id_value,
    t.x as territory_x_value,
    t.y as territory_y_value,
    t.name as territory_name_value,
    borrower.display_name as borrower_name_value,
    lender.display_name as lender_name_value,
    lender.nation as lender_nation_value
  into v_card
  from card_instances ci
  join territories t on t.id = ci.stationed_territory_id
  left join players borrower on borrower.id = ci.owner_id
  left join players lender on lender.id = ci.loaned_from_id
  where ci.instance_id = p_card_instance_id
  for update of ci;

  if not found then
    raise exception 'loaned card not found';
  end if;

  if v_card.lender_id_value is null or v_card.lender_id_value <> p_caller then
    raise exception 'caller does not own this loan';
  end if;

  if v_card.borrower_id_value is null then
    raise exception 'this loan is no longer active';
  end if;

  if v_card.territory_id_value is null then
    raise exception 'loaned card is not stationed on a territory';
  end if;

  if not exists (
    select 1
    from card_instances ci
    where ci.instance_id = p_card_instance_id
      and ci.status = 'stationed'
      and ci.loaned_from_id = p_caller
      and ci.owner_id is not null
  ) then
    raise exception 'only a stationed active loan can be recalled';
  end if;

  lender_id := v_card.lender_id_value;
  lender_display_name := v_card.lender_name_value;
  borrower_id := v_card.borrower_id_value;
  borrower_display_name := v_card.borrower_name_value;
  loan_territory_id := v_card.territory_id_value;
  loan_territory_x := v_card.territory_x_value;
  loan_territory_y := v_card.territory_y_value;
  loan_territory_name := v_card.territory_name_value;

  -- Prefer returning to wherever this card was actually lent from, not
  -- the lender's home — see migration header for rationale.
  select tm.origin_territory_id
  into v_origin_territory_id
  from troop_movement_units tmu
  join troop_movements tm on tm.id = tmu.movement_id
  where tmu.card_instance_id = p_card_instance_id
    and tm.kind = 'loan'
  order by tm.started_at desc
  limit 1;

  if v_origin_territory_id is not null then
    select owner_id into v_origin_owner
    from territories
    where id = v_origin_territory_id;
  end if;

  if v_origin_territory_id is not null and v_origin_owner = lender_id then
    select id, x, y, name
    into return_territory_id, return_territory_x, return_territory_y, return_territory_name
    from territories
    where id = v_origin_territory_id
    for update;
  end if;

  if return_territory_id is null then
    select id, x, y, name
    into return_territory_id, return_territory_x, return_territory_y, return_territory_name
    from territories
    where owner_id = lender_id
      and is_home = true
    for update;
  end if;

  if return_territory_id is null then
    raise exception 'lender home territory not found';
  end if;

  v_lender_nation := v_card.lender_nation_value;
  v_distance := greatest(abs(return_territory_x - loan_territory_x), abs(return_territory_y - loan_territory_y));
  v_group_speed := _min_group_speed(array[p_card_instance_id]);
  v_speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(v_group_speed, 5.0)));
  v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult)
    * (case when v_lender_nation = 'mongol_horde' then 0.75 else 1.0 end);
  v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

  insert into troop_movements (
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    started_at,
    transfer_arrives_at
  )
  values (
    lender_id,
    'loan_return',
    loan_territory_id,
    return_territory_id,
    now(),
    v_arrives_at
  )
  returning id into return_movement_id;

  insert into troop_movement_units (movement_id, card_instance_id, origin_territory_id)
  values (return_movement_id, p_card_instance_id, loan_territory_id);

  update card_instances
  set owner_id = lender_id,
      status = 'in_transit',
      loaned_from_id = null,
      loan_return_at = null
  where instance_id = p_card_instance_id;

  return next;
end;
$$;
