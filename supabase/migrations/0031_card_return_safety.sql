-- Card return safety follow-up for backlog #27.
--
-- Keeps return/deposit overflow behavior compatible with historical battle /
-- movement foreign keys by falling back to an ownerless central-pool row
-- when hard-delete is no longer legal, and serializes deposit withdrawal on
-- the owning player row.

create or replace function _return_card(p_instance_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_template_id text;
  v_rank text;
begin
  select ci.owner_id, ci.template_id, ct.rank
  into v_player_id, v_template_id, v_rank
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_instance_id
  for update;

  if not found then
    return;
  end if;

  begin
    delete from card_instances
    where instance_id = p_instance_id;
  exception
    when foreign_key_violation then
      update card_instances
      set owner_id = null,
          stationed_territory_id = null,
          status = 'stationed',
          deposit_expires_at = null
      where instance_id = p_instance_id;
  end;

  if v_rank in ('rare', 'epic', 'legend') then
    if v_player_id is null then
      raise exception 'cannot log returned rare+ card % without owner', p_instance_id;
    end if;

    insert into card_return_log (player_id, template_id, rank, reason)
    values (v_player_id, v_template_id, v_rank, p_reason);
  end if;
end;
$$;

create or replace function withdraw_from_deposit(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
  v_xp integer;
  v_level integer;
  v_deck_count integer;
  v_home_territory_id integer;
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();
  perform _expire_deposit(v_player_id);

  select xp into v_xp
  from players
  where id = v_player_id
  for update;

  if not found then
    raise exception 'player % not found', v_player_id;
  end if;

  perform 1
  from card_instances ci
  where ci.instance_id = p_instance_id
    and ci.owner_id = v_player_id
    and ci.status = 'deposit'
  for update;

  if not found then
    raise exception 'card instance % is not in your deposit', p_instance_id;
  end if;

  v_level := _level_for_xp(v_xp);

  select count(*)
  into v_deck_count
  from card_instances
  where owner_id = v_player_id
    and status in ('stationed', 'in_transit');

  if v_deck_count >= _deck_limit(v_level) then
    raise exception 'balíček je stále plný — nejdřív vrať jinou kartu do centrální sady';
  end if;

  select id
  into v_home_territory_id
  from territories
  where owner_id = v_player_id
    and is_home = true
  limit 1;

  if v_home_territory_id is null then
    raise exception 'caller has no home territory';
  end if;

  update card_instances
  set status = 'stationed',
      stationed_territory_id = v_home_territory_id,
      deposit_expires_at = null
  where instance_id = p_instance_id;
end;
$$;
