-- Bug fix: admin_grant_card() left the granted card unstationed
-- (stationed_territory_id = null) whenever the admin dashboard's optional
-- "territory ID" field was left blank. An unstationed card is invisible to
-- every gameplay flow that only looks at cards stationed on a territory
-- (garrison rosters, battle/attack card pickers, transfers, etc.) even
-- though it still shows up in the player's /collection list -- so the
-- player receives the card but can't actually use it anywhere.
--
-- Fix: when no p_territory_id is given, default to the player's home
-- territory (territories.is_home), so a granted card is immediately usable.

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
  v_territory_id integer;
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

  -- Default to the player's home territory when no target is given, so the
  -- granted card is immediately usable instead of floating unstationed.
  v_territory_id := p_territory_id;
  if v_territory_id is null then
    select id into v_territory_id
    from territories
    where owner_id = p_player_id and is_home;
  end if;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (p_template_id, p_player_id, v_territory_id, 'stationed')
  returning instance_id into v_instance_id;

  return v_instance_id;
end;
$$;
