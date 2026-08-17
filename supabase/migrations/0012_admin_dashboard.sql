-- Admin dashboard support: admin flag, admin-only overview RPCs, and
-- manual test-helper mutation RPCs for cards / XP.
--
-- NOT YET APPLIED: this migration is intentionally committed only. Apply it
-- manually after review. See the companion verification script for smoke tests.

alter table players
  add column is_admin boolean not null default false;

create or replace function admin_require_admin()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'admin access requires an authenticated player';
  end if;

  if not exists (
    select 1 from players where id = caller and is_admin = true
  ) then
    raise exception 'admin access required';
  end if;

  return caller;
end;
$$;

create or replace function admin_list_online_players()
returns table (
  id uuid,
  display_name text,
  nation nation_id,
  xp integer,
  kingdom_name text,
  last_seen_at timestamptz,
  is_online boolean,
  active_battle_id uuid,
  active_battle_role text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform admin_require_admin();

  return query
  select
    p.id,
    p.display_name,
    p.nation,
    p.xp,
    p.kingdom_name,
    p.last_seen_at,
    p.last_seen_at >= now() - interval '2 minutes' as is_online,
    active_battle.id as active_battle_id,
    active_battle.role as active_battle_role
  from players p
  left join lateral (
    select
      b.id,
      case when b.attacker_id = p.id then 'attacker' else 'defender' end as role
    from battles b
    where (b.attacker_id = p.id or b.defender_id = p.id)
      and b.status not in ('resolved', 'expired')
    order by b.created_at desc
    limit 1
  ) active_battle on true
  order by p.display_name;
end;
$$;

create or replace function admin_list_active_battles()
returns table (
  id uuid,
  territory_id integer,
  territory_x integer,
  territory_y integer,
  attacker_id uuid,
  attacker_display_name text,
  defender_id uuid,
  defender_display_name text,
  current_round integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform admin_require_admin();

  return query
  select
    b.id,
    b.territory_id,
    t.x,
    t.y,
    b.attacker_id,
    attacker.display_name,
    b.defender_id,
    defender.display_name,
    b.current_round,
    b.status
  from battles b
  join territories t on t.id = b.territory_id
  join players attacker on attacker.id = b.attacker_id
  left join players defender on defender.id = b.defender_id
  where b.status not in ('resolved', 'expired')
  order by b.created_at desc;
end;
$$;

create or replace function admin_list_player_cards(p_player_id uuid)
returns table (
  instance_id uuid,
  template_id text,
  template_name text,
  template_rank text,
  template_category text,
  owner_id uuid,
  stationed_territory_id integer,
  territory_x integer,
  territory_y integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform admin_require_admin();

  if not exists (select 1 from players where id = p_player_id) then
    raise exception 'player % not found', p_player_id;
  end if;

  return query
  select
    ci.instance_id,
    ci.template_id,
    ct.name,
    ct.rank,
    ct.category,
    ci.owner_id,
    ci.stationed_territory_id,
    t.x,
    t.y,
    ci.status
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  left join territories t on t.id = ci.stationed_territory_id
  where ci.owner_id = p_player_id
  order by ct.category, ct.rank, ct.name, ci.minted_at desc;
end;
$$;

create or replace function admin_grant_card(
  p_player_id uuid,
  p_template_id text,
  p_territory_id integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance_id uuid;
begin
  perform admin_require_admin();

  if not exists (select 1 from players where id = p_player_id) then
    raise exception 'player % not found', p_player_id;
  end if;

  if not exists (select 1 from card_templates where id = p_template_id) then
    raise exception 'card template % not found', p_template_id;
  end if;

  if p_territory_id is not null
     and not exists (select 1 from territories where id = p_territory_id) then
    raise exception 'territory % not found', p_territory_id;
  end if;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (p_template_id, p_player_id, p_territory_id, 'stationed')
  returning instance_id into v_instance_id;

  return v_instance_id;
end;
$$;

create or replace function admin_remove_card(p_card_instance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform admin_require_admin();

  if not exists (select 1 from card_instances where instance_id = p_card_instance_id) then
    raise exception 'card instance % not found', p_card_instance_id;
  end if;

  if exists (
    select 1
    from battle_attacker_roster
    where card_instance_id = p_card_instance_id
  ) or exists (
    select 1
    from battle_rounds
    where attacker_card_instance_id = p_card_instance_id
       or defender_card_instance_id = p_card_instance_id
       or winner_card_instance_id = p_card_instance_id
  ) or exists (
    select 1
    from battle_unit_rest
    where card_instance_id = p_card_instance_id
  ) then
    raise exception 'card instance % is referenced by battle history or an active battle and cannot be removed', p_card_instance_id;
  end if;

  if exists (
    select 1
    from troop_movement_units
    where card_instance_id = p_card_instance_id
  ) then
    raise exception 'card instance % is referenced by troop movement history and cannot be removed', p_card_instance_id;
  end if;

  delete from card_instances where instance_id = p_card_instance_id;
end;
$$;

create or replace function admin_grant_xp(
  p_player_id uuid,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_xp integer;
begin
  perform admin_require_admin();

  update players
  set xp = greatest(0, xp + p_amount)
  where id = p_player_id
  returning xp into v_new_xp;

  if not found then
    raise exception 'player % not found', p_player_id;
  end if;

  return v_new_xp;
end;
$$;
