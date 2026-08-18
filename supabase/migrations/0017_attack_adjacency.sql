-- Backlog #10: attacks must go through adjacent/border territory.
--
-- Redefines declare_attack() (originally defined in 0003_battles.sql) to add
-- one new invariant: a target territory that has an owner (owner_id is not
-- null) may only be attacked if at least one of its 4 orthogonal neighbors
-- (up/down/left/right — not diagonals) is NOT owned by that same owner.
-- That includes neighbors owned by a different player, neighbors that are
-- unclaimed/NPC-garrisoned (owner_id is null), and neighbors that don't
-- exist because the target sits on the edge of the grid. If all 4 in-grid
-- neighbors belong to the same owner, the target is an "interior" territory
-- and cannot be attacked directly until one of its owner's border
-- territories falls first.
--
-- Territories with owner_id is null (truly empty or NPC-garrisoned) are
-- exempt and remain always attackable — see the design doc
-- (docs/superpowers/specs/2026-08-19-attack-adjacency-design.md) for why NPC
-- land isn't grouped into a contiguous landmass yet.
--
-- Everything else in this function is unchanged from its current
-- (0003_battles.sql) definition.

create or replace function declare_attack(
  origin_territory_id integer,
  target_territory_id integer,
  card_instance_ids uuid[]
)
returns uuid
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  caller_nation nation_id;
  origin_x smallint; origin_y smallint;
  target_x smallint; target_y smallint;
  target_owner uuid;
  target_claim_locked_by uuid;
  target_battle_locked_by uuid;
  target_is_home boolean;
  distance numeric;
  transfer_hrs numeric;
  effective_count integer;
  matching_count integer;
  arrives_at timestamptz;
  movement_id uuid;
begin
  perform resolve_due_battles();
  perform resolve_due_movements();

  if card_instance_ids is null or array_length(card_instance_ids, 1) is null then
    raise exception 'card_instance_ids must be non-empty';
  end if;

  select nation into caller_nation from players where id = caller;

  select x, y into origin_x, origin_y
  from territories where id = origin_territory_id and owner_id = caller;
  if not found then
    raise exception 'caller does not own origin_territory_id';
  end if;

  select x, y, owner_id, claim_locked_by, battle_locked_by, is_home
  into target_x, target_y, target_owner, target_claim_locked_by, target_battle_locked_by, target_is_home
  from territories where id = target_territory_id;
  if not found then
    raise exception 'target territory is not available to attack';
  end if;

  select count(*) into matching_count
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = any(card_instance_ids)
    and ci.owner_id = caller
    and ci.stationed_territory_id = origin_territory_id
    and ci.status = 'stationed'
    and ct.category = 'unit';
  if matching_count <> array_length(card_instance_ids, 1) then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  if target_owner = caller or target_claim_locked_by = caller then
    raise exception 'caller cannot attack their own owned/claimed territory';
  end if;
  if target_battle_locked_by is not null then
    raise exception 'target territory already has a battle in progress';
  end if;

  if target_owner is not null and not exists (
    select 1
    from (values (target_x - 1, target_y), (target_x + 1, target_y),
                 (target_x, target_y - 1), (target_x, target_y + 1)) as n(nx, ny)
    left join territories t2 on t2.x = n.nx and t2.y = n.ny
    where t2.id is null or t2.owner_id is distinct from target_owner
  ) then
    raise exception 'target territory is surrounded by owner''s own territory and cannot be attacked directly';
  end if;

  if not target_is_home then
    select count(*) into effective_count
    from territories where owner_id = caller or claim_locked_by = caller;
    if effective_count >= 32 then
      raise exception 'territory ownership cap (32) reached';
    end if;
  end if;

  distance := greatest(abs(target_x - origin_x), abs(target_y - origin_y));
  transfer_hrs := greatest(0.25, distance * 0.3)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);

  select x, y, owner_id, claim_locked_by, battle_locked_by, is_home
  into target_x, target_y, target_owner, target_claim_locked_by, target_battle_locked_by, target_is_home
  from territories
  where id = target_territory_id
  for update;
  if not found then
    raise exception 'target territory is not available to attack';
  end if;
  if target_owner = caller or target_claim_locked_by = caller then
    raise exception 'caller cannot attack their own owned/claimed territory';
  end if;
  if target_battle_locked_by is not null then
    raise exception 'target territory already has a battle in progress';
  end if;

  if target_owner is not null and not exists (
    select 1
    from (values (target_x - 1, target_y), (target_x + 1, target_y),
                 (target_x, target_y - 1), (target_x, target_y + 1)) as n(nx, ny)
    left join territories t2 on t2.x = n.nx and t2.y = n.ny
    where t2.id is null or t2.owner_id is distinct from target_owner
  ) then
    raise exception 'target territory is surrounded by owner''s own territory and cannot be attacked directly';
  end if;

  if not target_is_home then
    select count(*) into effective_count
    from territories where owner_id = caller or claim_locked_by = caller;
    if effective_count >= 32 then
      raise exception 'territory ownership cap (32) reached';
    end if;
  end if;

  -- Row-lock the selected instances and re-verify immediately before writing.
  perform instance_id from card_instances
  where instance_id = any(card_instance_ids)
    and owner_id = caller
    and stationed_territory_id = origin_territory_id
    and status = 'stationed'
  for update;
  if not found then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  arrives_at := now() + (transfer_hrs || ' hours')::interval;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (caller, 'attack', origin_territory_id, target_territory_id, arrives_at)
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);

  update territories
  set battle_locked_by = caller
  where id = target_territory_id;

  return movement_id;
end;
$$;
