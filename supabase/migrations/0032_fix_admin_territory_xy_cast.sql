-- Fix admin dashboard RPCs: territories.x/y are `smallint`, but
-- admin_list_active_battles / admin_list_player_cards declare their
-- territory_x/territory_y output columns as `integer` without casting.
-- PL/pgSQL's `return query` requires exact (binary-coercible) type
-- matches, so smallint -> integer is NOT accepted implicitly and every
-- call raised "structure of query does not match function result type".
-- Fix: cast t.x/t.y to integer explicitly in both SELECTs.

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
    t.x::integer,
    t.y::integer,
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
    t.x::integer,
    t.y::integer,
    ci.status
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  left join territories t on t.id = ci.stationed_territory_id
  where ci.owner_id = p_player_id
  order by ct.category, ct.rank, ct.name, ci.minted_at desc;
end;
$$;
