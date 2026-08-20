-- Card limit + overflow deposit (backlog #27)
--
-- Adds per-player deck/deposit capacity helpers, deposit expiry + return
-- plumbing, and player-facing RPCs/read paths for returning and withdrawing
-- cards without requiring any background cron.

alter table card_instances
  drop constraint if exists card_instances_status_check;

alter table card_instances
  add constraint card_instances_status_check
  check (status in ('stationed', 'in_transit', 'deposit'));

alter table card_instances
  add column if not exists deposit_expires_at timestamptz;

create table if not exists card_return_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id),
  template_id text not null references card_templates(id),
  rank text not null,
  reason text not null check (reason in ('deposit_expired', 'deposit_overflow', 'manual_return')),
  returned_at timestamptz not null default now()
);

create or replace function _level_for_xp(p_xp integer)
returns integer
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_level integer := 1;
begin
  loop
    exit when p_xp < (100 * v_level * (v_level + 1)) / 2;
    v_level := v_level + 1;
  end loop;
  return v_level;
end;
$$;

create or replace function _deck_limit(p_level integer)
returns integer
language sql
immutable
security definer
set search_path = public
as $$
  select 80 + 10 * (greatest(p_level, 1) - 1);
$$;

create or replace function _deposit_limit(p_level integer)
returns integer
language sql
immutable
security definer
set search_path = public
as $$
  select floor(_deck_limit(greatest(p_level, 1)) / 2.0)::integer;
$$;

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

  delete from card_instances
  where instance_id = p_instance_id;

  if v_rank in ('rare', 'epic', 'legend') then
    if v_player_id is null then
      raise exception 'cannot log returned rare+ card % without owner', p_instance_id;
    end if;

    insert into card_return_log (player_id, template_id, rank, reason)
    values (v_player_id, v_template_id, v_rank, p_reason);
  end if;
end;
$$;

create or replace function _expire_deposit(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance_id uuid;
begin
  for v_instance_id in
    select ci.instance_id
    from card_instances ci
    where ci.owner_id = p_player_id
      and ci.status = 'deposit'
      and ci.deposit_expires_at <= now()
    order by ci.deposit_expires_at, ci.instance_id
  loop
    perform _return_card(v_instance_id, 'deposit_expired');
  end loop;
end;
$$;

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
    update card_instances
    set owner_id = p_player_id,
        status = p_status,
        deposit_expires_at = null
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
        deposit_expires_at = now() + interval '3 days'
    where instance_id = p_instance_id;
    return;
  end if;

  update card_instances
  set owner_id = p_player_id,
      stationed_territory_id = null,
      deposit_expires_at = null
  where instance_id = p_instance_id;

  perform _return_card(p_instance_id, 'deposit_overflow');
end;
$$;

create or replace function get_my_player_profile()
returns setof players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();
  perform _expire_deposit(v_player_id);

  return query
    select *
    from players
    where id = v_player_id
    limit 1;
end;
$$;

create or replace function get_my_card_instances()
returns table (
  instance_id uuid,
  template_id text,
  owner_id uuid,
  stationed_territory_id integer,
  status text,
  deposit_expires_at timestamptz,
  card_templates jsonb,
  territories jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();
  perform _expire_deposit(v_player_id);

  return query
    select
      ci.instance_id,
      ci.template_id,
      ci.owner_id,
      ci.stationed_territory_id,
      ci.status,
      ci.deposit_expires_at,
      jsonb_build_object(
        'id', ct.id,
        'name', ct.name,
        'flavor_text', ct.flavor_text,
        'rank', ct.rank,
        'category', ct.category,
        'unit_type', ct.unit_type,
        'base_stats', ct.base_stats,
        'total_supply', ct.total_supply,
        'defense_bonus_pct', ct.defense_bonus_pct,
        'attack_bonus_pct', ct.attack_bonus_pct,
        'boost_type', ct.boost_type,
        'effect_kind', ct.effect_kind,
        'instant_effect_kind', ct.instant_effect_kind,
        'pct_str', ct.pct_str,
        'pct_lng', ct.pct_lng,
        'pct_def', ct.pct_def,
        'pct_hp', ct.pct_hp
      ) as card_templates,
      case
        when t.id is null then null
        else jsonb_build_object('id', t.id, 'x', t.x, 'y', t.y, 'is_home', t.is_home)
      end as territories
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    left join territories t on t.id = ci.stationed_territory_id
    where ci.owner_id = v_player_id
    order by ci.minted_at, ci.instance_id;
end;
$$;

create or replace function return_card_to_pool(p_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
  v_status text;
  v_stationed_territory_id integer;
  v_attacker_boost_battle_id uuid;
  v_defender_boost_battle_id uuid;
begin
  if v_player_id is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();
  perform resolve_due_battles();

  select ci.status, ci.stationed_territory_id
  into v_status, v_stationed_territory_id
  from card_instances ci
  where ci.instance_id = p_instance_id
    and ci.owner_id = v_player_id
  for update;

  if not found then
    raise exception 'card instance % not found or not owned by caller', p_instance_id;
  end if;

  if v_status <> 'stationed' then
    raise exception 'card instance % is not currently stationed', p_instance_id;
  end if;

  if v_stationed_territory_id is not null and (
    exists (
      select 1
      from battles b
      where b.territory_id = v_stationed_territory_id
        and b.status not in ('resolved', 'expired')
    ) or exists (
      select 1
      from territories t
      where t.id = v_stationed_territory_id
        and t.battle_locked_by is not null
    )
  ) then
    raise exception 'card instance % is currently involved in an active battle', p_instance_id;
  end if;

  select b.id into v_attacker_boost_battle_id
  from battles b
  where b.attacker_boost_instance_id = p_instance_id
    and b.status not in ('resolved', 'expired')
  limit 1;

  if v_attacker_boost_battle_id is not null then
    raise exception 'card instance % is currently involved in an active battle', p_instance_id;
  end if;

  select b.id into v_defender_boost_battle_id
  from battles b
  where b.defender_boost_instance_id = p_instance_id
    and b.status not in ('resolved', 'expired')
  limit 1;

  if v_defender_boost_battle_id is not null then
    raise exception 'card instance % is currently involved in an active battle', p_instance_id;
  end if;

  perform _return_card(p_instance_id, 'manual_return');
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

  perform 1
  from card_instances ci
  where ci.instance_id = p_instance_id
    and ci.owner_id = v_player_id
    and ci.status = 'deposit'
  for update;

  if not found then
    raise exception 'card instance % is not in your deposit', p_instance_id;
  end if;

  select xp into v_xp
  from players
  where id = v_player_id;

  if not found then
    raise exception 'player % not found', v_player_id;
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

revoke execute on function _level_for_xp(integer) from public, anon, authenticated;
revoke execute on function _deck_limit(integer) from public, anon, authenticated;
revoke execute on function _deposit_limit(integer) from public, anon, authenticated;
revoke execute on function _return_card(uuid, text) from public, anon, authenticated;
revoke execute on function _expire_deposit(uuid) from public, anon, authenticated;
revoke execute on function _deposit_or_grant_card(uuid, uuid, text) from public, anon, authenticated;

grant execute on function get_my_player_profile() to authenticated;
grant execute on function get_my_card_instances() to authenticated;
grant execute on function return_card_to_pool(uuid) to authenticated;
grant execute on function withdraw_from_deposit(uuid) to authenticated;
