-- Trading / Exchange — manual SQL verification checklist
--
-- Paste into a scratch Supabase SQL editor only after 0014_trading_exchange.sql
-- is applied. This file is not executed automatically.

do $$
declare
  v_player_a uuid := gen_random_uuid();
  v_player_b uuid := gen_random_uuid();
  v_player_c uuid := gen_random_uuid();
  v_card_a1 uuid;
  v_card_a2 uuid;
  v_card_a3 uuid;
  v_card_b1 uuid;
  v_card_b2 uuid;
  v_card_b3 uuid;
  v_card_c1 uuid;
  v_template_1 text;
  v_template_2 text;
  v_offer_direct uuid;
  v_offer_public uuid;
  v_offer_response uuid;
  v_offer_counter uuid;
  v_failed_offer uuid;
  v_cap_offer uuid;
  v_expiring_offer uuid;
  v_before_a uuid;
  v_before_b uuid;
  i integer;
begin
  select id into v_template_1
  from card_templates
  where category = 'unit'
  order by id
  limit 1;

  select id into v_template_2
  from card_templates
  where category = 'unit'
    and id <> v_template_1
  order by id
  limit 1;

  assert v_template_1 is not null and v_template_2 is not null,
    'Expected at least two unit templates in card_templates';

  insert into players (id, display_name, nation)
  values
    (v_player_a, 'Trade A', 'england'),
    (v_player_b, 'Trade B', 'francia'),
    (v_player_c, 'Trade C', 'hre');

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_1, v_player_a, null, 'stationed')
  returning instance_id into v_card_a1;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_2, v_player_a, null, 'stationed')
  returning instance_id into v_card_a2;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_1, v_player_a, null, 'stationed')
  returning instance_id into v_card_a3;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_1, v_player_b, null, 'stationed')
  returning instance_id into v_card_b1;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_2, v_player_b, null, 'stationed')
  returning instance_id into v_card_b2;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_1, v_player_b, null, 'stationed')
  returning instance_id into v_card_b3;

  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values (v_template_2, v_player_c, null, 'stationed')
  returning instance_id into v_card_c1;

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  v_offer_direct := create_trade_offer(
    'direct',
    v_player_b,
    array[v_card_a1],
    array[v_card_b1],
    null,
    'Přímá směna'
  );

  assert exists (
    select 1
    from trade_offers
    where id = v_offer_direct
      and type = 'direct'
      and status = 'pending'
      and initiator_id = v_player_a
      and target_player_id = v_player_b
  ), 'Expected a pending direct offer';

  v_offer_public := create_trade_offer(
    'public',
    null,
    array[v_card_a2],
    null,
    jsonb_build_object('rank', 'common', 'unit_type', 'archers'),
    'Veřejná nabídka'
  );

  assert exists (
    select 1
    from trade_offers
    where id = v_offer_public
      and type = 'public'
      and target_player_id is null
      and root_offer_id = id
  ), 'Expected a pending public listing';

  perform set_config('request.jwt.claim.sub', v_player_b::text, true);
  v_offer_response := respond_to_public_offer(v_offer_public, array[v_card_b2], 'Moje odpověď');

  assert exists (
    select 1
    from trade_offers
    where id = v_offer_response
      and type = 'direct'
      and parent_offer_id = v_offer_public
      and root_offer_id = v_offer_public
      and status = 'pending'
  ), 'Expected a direct response linked to the public listing';

  assert exists (
    select 1
    from trade_offers
    where id = v_offer_public
      and status = 'pending'
  ), 'Public listing should remain open after a response';

  v_offer_counter := counter_trade_offer(v_offer_direct, array[v_card_b3], array[v_card_a3], 'Protinabídka');

  assert exists (
    select 1
    from trade_offers
    where id = v_offer_direct
      and status = 'countered'
  ), 'Parent direct offer should flip to countered';

  assert exists (
    select 1
    from trade_offers
    where id = v_offer_counter
      and parent_offer_id = v_offer_direct
      and root_offer_id = v_offer_direct
      and initiator_id = v_player_b
      and target_player_id = v_player_a
      and status = 'pending'
  ), 'Counter-offer should preserve root_offer_id and flip roles';

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  perform accept_trade_offer(v_offer_counter);

  assert (select owner_id from card_instances where instance_id = v_card_b3) = v_player_a,
    'Accepted counter-offer should transfer responder card to acceptor';
  assert (select owner_id from card_instances where instance_id = v_card_a3) = v_player_b,
    'Accepted counter-offer should transfer requested card to initiator';
  assert exists (
    select 1
    from trade_offers
    where id = v_offer_public
      and status = 'accepted'
  ), 'Accepting a counter-chain response to a public listing should close the listing itself';
  assert exists (
    select 1
    from trade_offers
    where id = v_offer_response
      and status = 'cancelled'
  ), 'Accepting one public-listing response chain should cancel the sibling pending response row';

  v_failed_offer := create_trade_offer(
    'direct',
    v_player_b,
    array[v_card_a1],
    array[v_card_b1],
    null,
    'Selhávající přijetí'
  );

  update card_instances
  set status = 'in_transit'
  where instance_id = v_card_b1;

  select owner_id into v_before_a from card_instances where instance_id = v_card_a1;
  select owner_id into v_before_b from card_instances where instance_id = v_card_b1;

  perform set_config('request.jwt.claim.sub', v_player_b::text, true);
  begin
    perform accept_trade_offer(v_failed_offer);
    raise exception 'Expected accept_trade_offer to fail after card became ineligible';
  exception
    when others then
      assert position('requested_card_ids' in sqlerrm) > 0
        or position('trade-eligible' in sqlerrm) > 0,
        format('Expected clear accept re-validation error, got %s', sqlerrm);
  end;

  assert (select owner_id from card_instances where instance_id = v_card_a1) = v_before_a,
    'Failed accept must not partially swap initiator card';
  assert (select owner_id from card_instances where instance_id = v_card_b1) = v_before_b,
    'Failed accept must not partially swap target card';

  update card_instances
  set status = 'stationed'
  where instance_id = v_card_b1;

  begin
    perform cancel_trade_offer(v_failed_offer);
    raise exception 'Expected non-initiator cancel to fail';
  exception
    when others then
      assert position('only the current initiator may cancel' in sqlerrm) > 0,
        format('Expected initiator-only cancel error, got %s', sqlerrm);
  end;

  perform reject_trade_offer(v_failed_offer);
  assert exists (
    select 1 from trade_offers where id = v_failed_offer and status = 'rejected'
  ), 'Target should be able to reject a direct offer';

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  begin
    perform reject_trade_offer(v_offer_response);
    raise exception 'Expected non-target reject to fail';
  exception
    when others then
      assert position('only the current target may reject' in sqlerrm) > 0,
        format('Expected target-only reject error, got %s', sqlerrm);
  end;

  perform set_config('request.jwt.claim.sub', v_player_c::text, true);
  for i in 1..10 loop
    v_cap_offer := create_trade_offer(
      'public',
      null,
      array[v_card_c1],
      null,
      null,
      format('Cap %s', i)
    );
  end loop;

  begin
    perform create_trade_offer('public', null, array[v_card_c1], null, null, 'Cap overflow');
    raise exception 'Expected active-offer cap enforcement to fail';
  exception
    when others then
      assert position('cap (10)' in sqlerrm) > 0,
        format('Expected active-offer cap error, got %s', sqlerrm);
  end;

  perform set_config('request.jwt.claim.sub', v_player_a::text, true);
  v_expiring_offer := create_trade_offer(
    'public',
    null,
    array[v_card_a2],
    null,
    jsonb_build_object('rank', 'common'),
    'Expirující nabídka'
  );

  update trade_offers
  set expires_at = now() - interval '1 minute'
  where id = v_expiring_offer;

  perform list_public_trade_marketplace();

  assert exists (
    select 1 from trade_offers where id = v_expiring_offer and status = 'expired'
  ), 'Expected lazy marketplace read to mark the expired public listing';
end;
$$;
