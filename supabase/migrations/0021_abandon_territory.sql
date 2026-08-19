-- Backlog #19: ability to abandon an owned (non-home) territory, returning
-- it to unclaimed status. Garrisoned cards automatically start a normal
-- transfer back to the caller's home territory (same formula/duration as
-- start_transfer) — the player is warned client-side before confirming and
-- should redirect any cards they want elsewhere BEFORE abandoning, since
-- this always sends survivors home, never anywhere else.
--
-- Depends on `_min_group_speed` (0020_speed_attribute.sql).

create or replace function abandon_territory(p_territory_id integer)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  is_home_flag boolean;
  home_id integer;
  home_x smallint; home_y smallint;
  origin_x smallint; origin_y smallint;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  transfer_hrs numeric;
  arrives_at timestamptz;
  movement_id uuid;
  card_ids uuid[];
begin
  perform resolve_due_movements();

  select is_home, x, y into is_home_flag, origin_x, origin_y
  from territories
  where id = p_territory_id and owner_id = caller
  for update;
  if not found then
    raise exception 'caller does not own p_territory_id';
  end if;

  if is_home_flag then
    raise exception 'cannot abandon your home territory';
  end if;

  if exists (
    select 1 from battles
    where territory_id = p_territory_id
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'cannot abandon a territory with an unresolved battle';
  end if;

  if exists (
    select 1 from troop_movements
    where destination_territory_id = p_territory_id
      and status = 'in_transit'
  ) then
    raise exception 'cannot abandon a territory with incoming movements — wait for them to arrive or recall them first';
  end if;

  select nation into caller_nation from players where id = caller;

  select id, x, y into home_id, home_x, home_y
  from territories where owner_id = caller and is_home = true;
  if not found then
    raise exception 'caller has no home territory (data integrity issue)';
  end if;

  select array_agg(instance_id) into card_ids
  from card_instances
  where owner_id = caller
    and stationed_territory_id = p_territory_id
    and status = 'stationed';

  if card_ids is not null and array_length(card_ids, 1) > 0 then
    distance := greatest(abs(home_x - origin_x), abs(home_y - origin_y));
    group_speed := _min_group_speed(card_ids);
    speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
    transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
      * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);
    arrives_at := now() + (transfer_hrs || ' hours')::interval;

    insert into troop_movements
      (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
    values (caller, 'transfer', p_territory_id, home_id, arrives_at)
    returning id into movement_id;

    insert into troop_movement_units (movement_id, card_instance_id)
    select movement_id, unnest(card_ids);

    update card_instances
    set status = 'in_transit'
    where instance_id = any(card_ids);
  end if;

  -- Castle/village structures (if any) are left standing for whoever
  -- claims the territory next — only ownership is relinquished.
  update territories
  set owner_id = null
  where id = p_territory_id;
end;
$$;
