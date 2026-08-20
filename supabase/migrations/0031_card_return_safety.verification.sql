-- 0031_card_return_safety.verification.sql
--
-- Live-safe verification for the return/delete fallback and serialized
-- withdraw path. Runs inside a transaction and rolls back.

begin;

do $$
declare
  v_player_id uuid;
  v_home_territory_id integer;
  v_common_template_id text;
  v_card_id uuid;
  v_movement_id uuid;
  v_owner uuid;
  v_status text;
  v_stationed_territory_id integer;
begin
  assert position('foreign_key_violation' in pg_get_functiondef(to_regprocedure('_return_card(uuid, text)'))) > 0,
    'expected _return_card(uuid, text) to handle FK-protected historical rows';
  assert position('for update' in lower(pg_get_functiondef(to_regprocedure('withdraw_from_deposit(uuid)')))) > 0,
    'expected withdraw_from_deposit(uuid) to lock the player row';

  select p.id, t.id
  into v_player_id, v_home_territory_id
  from players p
  join territories t on t.owner_id = p.id and t.is_home = true
  where coalesce(p.is_npc, false) = false
  order by p.created_at
  limit 1;

  assert v_player_id is not null, 'need a player with a home territory';

  select id into v_common_template_id
  from card_templates
  where category = 'unit' and rank = 'common'
  order by id
  limit 1;

  assert v_common_template_id is not null, 'missing common unit template';

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_common_template_id, v_player_id, v_home_territory_id, 'stationed')
  returning instance_id into v_card_id;

  insert into troop_movements (
    player_id,
    kind,
    origin_territory_id,
    destination_territory_id,
    transfer_arrives_at,
    status
  )
  values (
    v_player_id,
    'transfer',
    v_home_territory_id,
    v_home_territory_id,
    now(),
    'completed'
  )
  returning id into v_movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  values (v_movement_id, v_card_id);

  perform _return_card(v_card_id, 'manual_return');

  select owner_id, status, stationed_territory_id
  into v_owner, v_status, v_stationed_territory_id
  from card_instances
  where instance_id = v_card_id;

  assert v_owner is null, 'fk-protected returned card should end up ownerless';
  assert v_status = 'stationed', 'fk-protected returned card should stay in a safe non-deposit state';
  assert v_stationed_territory_id is null, 'fk-protected returned card should leave the map';
end;
$$;

rollback;
