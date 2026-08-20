-- Quick UX fix batch: surface *whose* territory something is, in two spots
-- where only "cizí hráč"/the attacker's name was visible before:
--   1. get_viewport(): map tile hover tooltip now shows the owner's display
--      name (not just "Cizí hráč"/"NPC říše").
--   2. world_list_attacks_in_transit(): /world's "Útoky na cestě" section
--      now shows who (if anyone) currently owns the target territory, so an
--      entry reads "NPC Anglie útočí na území (1, 58) hráče XY" instead of
--      just naming the attacker. Target may have no owner (empty/peaceful
--      claim in progress), so these columns are nullable.
--
-- Both functions gain new output columns, so they must be dropped first —
-- `create or replace function` cannot change a function's return type.

drop function if exists get_viewport(smallint, smallint, smallint, smallint);

create or replace function get_viewport(x1 smallint, y1 smallint, x2 smallint, y2 smallint)
returns table (
  id integer,
  x smallint,
  y smallint,
  difficulty smallint,
  castle_rank text,
  village_rank text,
  owner_id uuid,
  owner_is_npc boolean,
  owner_display_name text,
  is_home boolean,
  claim_locked_by uuid,
  claim_started_at timestamptz,
  claim_transfer_arrives_at timestamptz,
  claim_occupation_completes_at timestamptz,
  battle_locked_by uuid,
  battle_id uuid,
  name text
)
language plpgsql
as $$
begin
  perform resolve_due_movements();
  perform resolve_due_battles();
  return query
    select
      t.id, t.x, t.y, t.difficulty, t.castle_rank, t.village_rank, t.owner_id,
      coalesce(owner_player.is_npc, false),
      owner_player.display_name,
      t.is_home, t.claim_locked_by, t.claim_started_at, t.claim_transfer_arrives_at,
      t.claim_occupation_completes_at, t.battle_locked_by,
      (select b.id from battles b
       where b.territory_id = t.id and b.status not in ('resolved', 'expired')
       limit 1) as battle_id,
      t.name
    from territories t
    left join players owner_player on owner_player.id = t.owner_id
    where t.x between x1 and x2 and t.y between y1 and y2;
end;
$$;

drop function if exists world_list_attacks_in_transit();

create or replace function world_list_attacks_in_transit()
returns table (
  movement_id uuid,
  attacker_id uuid,
  attacker_display_name text,
  attacker_home_x integer,
  attacker_home_y integer,
  target_territory_id integer,
  target_x integer,
  target_y integer,
  target_owner_id uuid,
  target_owner_display_name text,
  target_owner_is_npc boolean,
  arrives_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  return query
  select
    tm.id,
    tm.player_id,
    p.display_name,
    home.x::integer,
    home.y::integer,
    tm.destination_territory_id,
    dest.x::integer,
    dest.y::integer,
    dest.owner_id,
    dest_owner.display_name,
    coalesce(dest_owner.is_npc, false),
    tm.transfer_arrives_at
  from troop_movements tm
  join players p on p.id = tm.player_id
  left join territories home on home.owner_id = tm.player_id and home.is_home = true
  join territories dest on dest.id = tm.destination_territory_id
  left join players dest_owner on dest_owner.id = dest.owner_id
  where tm.kind = 'attack'
    and tm.status = 'in_transit'
  order by tm.transfer_arrives_at asc, tm.id asc;
end;
$$;

revoke execute on function world_list_attacks_in_transit() from public, anon;
grant execute on function world_list_attacks_in_transit() to authenticated;
