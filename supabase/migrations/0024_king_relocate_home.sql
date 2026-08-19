-- Backlog #28: "Král" as a one-time, level-gated special ability that
-- relocates the caller's existing home territory to another territory they
-- already own.
--
-- Deliberately implemented as a player ability, not a tradeable
-- card_instance: the existing client catalog is unit-only, while the real
-- gameplay requirement is a once-per-player strategic unlock tied to level,
-- not loot/drop circulation.

alter table players
  add column if not exists king_relocation_used_at timestamptz;

comment on column players.king_relocation_used_at is
  'When the player spent the one-time King ability to relocate their home territory. Null = unused.';

create or replace function relocate_home(p_new_territory_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_xp integer;
  v_level integer;
  v_used_at timestamptz;
  v_old_home_id integer;
  v_new_owner uuid;
  v_new_is_home boolean;
  v_new_claim_locked_by uuid;
  v_new_battle_locked_by uuid;
  v_required_level constant integer := 15;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();

  select xp, king_relocation_used_at
  into v_xp, v_used_at
  from players
  where id = v_caller
  for update;
  if not found then
    raise exception 'player % not found', v_caller;
  end if;

  if v_used_at is not null then
    raise exception 'king ability has already been used';
  end if;

  v_level := xp_level(v_xp);
  if v_level < v_required_level then
    raise exception 'king ability unlocks at level %', v_required_level;
  end if;

  select id
  into v_old_home_id
  from territories
  where owner_id = v_caller and is_home = true
  for update;
  if not found then
    raise exception 'caller has no home territory (data integrity issue)';
  end if;

  select owner_id, is_home, claim_locked_by, battle_locked_by
  into v_new_owner, v_new_is_home, v_new_claim_locked_by, v_new_battle_locked_by
  from territories
  where id = p_new_territory_id
  for update;
  if not found then
    raise exception 'p_new_territory_id not found';
  end if;

  if v_new_owner <> v_caller then
    raise exception 'caller does not own p_new_territory_id';
  end if;

  if p_new_territory_id = v_old_home_id or v_new_is_home then
    raise exception 'p_new_territory_id is already your home territory';
  end if;

  if v_new_claim_locked_by is not null then
    raise exception 'cannot relocate home to a territory with an active claim';
  end if;

  if v_new_battle_locked_by is not null or exists (
    select 1 from battles
    where territory_id = p_new_territory_id
      and status not in ('resolved', 'expired')
  ) then
    raise exception 'cannot relocate home to a territory with an unresolved battle';
  end if;

  update territories
  set is_home = false
  where id = v_old_home_id;

  update territories
  set is_home = true
  where id = p_new_territory_id;

  update players
  set king_relocation_used_at = clock_timestamp()
  where id = v_caller;
end;
$$;
