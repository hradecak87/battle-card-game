-- The world activity feed only ever logged 'territory_claimed' when a
-- claim *completes* — there was no event for a claim *starting*, for
-- either players or NPCs. NPCs expand very frequently via
-- resolve_due_npc_actions() -> _start_claim_core(), so this made a lot of
-- real world activity invisible in the feed for the entire duration of a
-- claim (which can be many hours). Add a 'claim_started' event, emitted
-- from _start_claim_core() itself so both the player-facing start_claim
-- RPC and the NPC expansion path get it for free.

alter table world_events
  drop constraint if exists world_events_event_type_check;

alter table world_events
  add constraint world_events_event_type_check
  check (event_type in (
    'attack_declared',
    'territory_claimed',
    'battle_won',
    'battle_surrendered',
    'territory_abandoned',
    'attack_recalled',
    'king_relocated',
    'player_leveled_up',
    'player_joined',
    'war_declared',
    'peace_signed',
    'claim_started'
  ));

create or replace function _start_claim_core(
  p_caller uuid,
  origin_territory_id integer,
  destination_territory_id integer,
  card_instance_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_nation nation_id;
  origin_x smallint; origin_y smallint;
  dest_x smallint; dest_y smallint;
  dest_difficulty smallint;
  dest_owner uuid; dest_locked_by uuid; dest_battle_locked_by uuid;
  distance numeric;
  group_speed numeric;
  speed_mult numeric;
  transfer_hrs numeric;
  occupation_hrs numeric;
  effective_count integer;
  active_claim_count integer;
  matching_count integer;
  arrives_at timestamptz;
  occupies_at timestamptz;
  movement_id uuid;
begin
  if card_instance_ids is null or array_length(card_instance_ids, 1) is null then
    raise exception 'card_instance_ids must be non-empty';
  end if;

  select nation into caller_nation from players where id = p_caller;

  select x, y into origin_x, origin_y
  from territories where id = origin_territory_id and owner_id = p_caller;
  if not found then
    raise exception 'caller does not own origin_territory_id';
  end if;

  select x, y, difficulty, owner_id, claim_locked_by, battle_locked_by
  into dest_x, dest_y, dest_difficulty, dest_owner, dest_locked_by, dest_battle_locked_by
  from territories where id = destination_territory_id;
  if dest_owner is not null or dest_locked_by is not null or dest_battle_locked_by is not null then
    raise exception 'destination territory is not available to claim';
  end if;
  if exists (
    select 1
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = destination_territory_id
      and ci.owner_id is null
      and ct.category = 'unit'
  ) then
    raise exception 'destination territory is not available to claim';
  end if;

  select count(*) into active_claim_count
  from territories where claim_locked_by = p_caller and owner_id is null;
  if active_claim_count >= 5 then
    raise exception 'concurrent claim limit (5) reached — wait for an in-progress claim to complete or cancel one first';
  end if;

  select count(*) into effective_count
  from territories where owner_id = p_caller or claim_locked_by = p_caller;
  if effective_count >= 32 then
    raise exception 'territory ownership cap (32) reached';
  end if;

  select count(*) into matching_count
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = any(card_instance_ids)
    and ci.owner_id = p_caller
    and ci.stationed_territory_id = origin_territory_id
    and ci.status = 'stationed'
    and ct.category = 'unit';
  if matching_count <> array_length(card_instance_ids, 1) then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  distance := greatest(abs(dest_x - origin_x), abs(dest_y - origin_y));

  group_speed := _min_group_speed(card_instance_ids);
  speed_mult := least(3.0, greatest(0.4, 5.0 / coalesce(group_speed, 5.0)));
  transfer_hrs := greatest(0.25, distance * 0.3 * speed_mult)
    * (case when caller_nation = 'mongol_horde' then 0.75 else 1.0 end);
  occupation_hrs := _claim_occupation_hours(p_caller, destination_territory_id, card_instance_ids);

  perform id from territories
  where id = destination_territory_id
    and owner_id is null
    and claim_locked_by is null
    and battle_locked_by is null
    and not exists (
      select 1
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = destination_territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
    )
  for update;
  if not found then
    raise exception 'destination territory is not available to claim';
  end if;

  perform instance_id from card_instances
  where instance_id = any(card_instance_ids)
    and owner_id = p_caller
    and stationed_territory_id = origin_territory_id
    and status = 'stationed'
  for update;
  if not found then
    raise exception 'one or more card instances are not eligible to send';
  end if;

  arrives_at := now() + (transfer_hrs || ' hours')::interval;
  occupies_at := arrives_at + (occupation_hrs || ' hours')::interval;

  update territories
  set claim_locked_by = p_caller,
      claim_started_at = now(),
      claim_transfer_arrives_at = arrives_at,
      claim_occupation_completes_at = occupies_at
  where id = destination_territory_id;

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (p_caller, 'claim', origin_territory_id, destination_territory_id, arrives_at)
  returning id into movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  select movement_id, unnest(card_instance_ids);

  update card_instances
  set status = 'in_transit'
  where instance_id = any(card_instance_ids);

  insert into world_events (event_type, payload)
  select
    'claim_started',
    jsonb_build_object(
      'player_id', p.id,
      'player_display_name', p.display_name,
      'player_home_x', home.x::integer,
      'player_home_y', home.y::integer,
      'territory_id', dest.id,
      'territory_x', dest.x::integer,
      'territory_y', dest.y::integer
    )
  from players p
  left join territories home
    on home.owner_id = p.id
   and home.is_home = true
  join territories dest
    on dest.id = destination_territory_id
  where p.id = p_caller;
end;
$$;
