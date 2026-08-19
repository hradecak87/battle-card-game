-- Backlog #22: ability to surrender mid-battle with whatever side
-- currently holds. See docs/superpowers/specs/2026-08-19-battle-surrender-design.md.
--
-- 1. `_finalize_battle` (redefined from 0011_claim_xp.sql, its latest
--    definition) gains a new `p_defender_surrendered` parameter
--    (default false, so every existing 2-arg call site is unaffected).
--    When true, the defender's fleeing cards go to their nearest other
--    owned territory instead of always home.
--    IMPORTANT: `create or replace function` does NOT replace a function
--    when the parameter list differs (adding one param creates a second,
--    overloaded function instead of replacing the original) — the old
--    2-arg overload must be dropped explicitly first, or every existing
--    2-arg call site keeps resolving to the stale copy instead of this
--    one's default parameter.
-- 2. New `surrender_battle(p_battle_id)` RPC: either participant can
--    concede a battle that is currently `active`.

drop function if exists _finalize_battle(uuid, text);

create or replace function _finalize_battle(
  p_battle_id uuid,
  p_winner_side text,
  p_defender_surrendered boolean default false
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_origin_territory_id integer;
  v_capture boolean := false;
  v_owned_count integer;
  v_defender_home_id integer;
  v_mover_nation nation_id;
  v_moving_ids uuid[];
  v_from_x smallint; v_from_y smallint;
  v_to_x smallint; v_to_y smallint;
  v_distance numeric;
  v_transfer_hrs numeric;
  v_arrives_at timestamptz;
  v_movement_id uuid;
  v_winner_id uuid;
  v_structure_category text;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  select origin_territory_id into v_origin_territory_id
  from troop_movements where id = v_battle.movement_id;

  if p_winner_side = 'attacker' then
    select count(*) into v_owned_count
    from territories where owner_id = v_battle.attacker_id or claim_locked_by = v_battle.attacker_id;
    v_capture := (not v_battle.is_home_target) and v_owned_count < 32;
  end if;

  if v_capture then
    update territories
    set owner_id = v_battle.attacker_id,
        claim_locked_by = null,
        claim_started_at = null,
        claim_transfer_arrives_at = null,
        claim_occupation_completes_at = null,
        battle_locked_by = null
    where id = v_battle.territory_id;

    -- Send home (or, on surrender, to the nearest other owned territory)
    -- any lingering defender-owned cards still stationed there. In a
    -- fully fought-out combat win the defender always has 0 cards left
    -- here (harmless no-op); the two reachable non-empty cases are the
    -- awaiting_ready walkover (destination = home, unchanged) and a
    -- mid-battle surrender (destination = nearest owned territory, new).
    if v_battle.defender_id is not null then
      select array_agg(instance_id) into v_moving_ids
      from card_instances
      where owner_id = v_battle.defender_id
        and stationed_territory_id = v_battle.territory_id;

      if v_moving_ids is not null and array_length(v_moving_ids, 1) > 0 then
        select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;

        if p_defender_surrendered then
          select id into v_defender_home_id
          from territories
          where owner_id = v_battle.defender_id
            and id <> v_battle.territory_id
          order by greatest(abs(x - v_from_x), abs(y - v_from_y)) asc
          limit 1;
        else
          select id into v_defender_home_id
          from territories where owner_id = v_battle.defender_id and is_home;
        end if;

        select nation into v_mover_nation from players where id = v_battle.defender_id;
        select x, y into v_to_x, v_to_y from territories where id = v_defender_home_id;
        v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
        v_transfer_hrs := greatest(0.25, v_distance * 0.3)
          * (case when v_mover_nation = 'mongol_horde' then 0.75 else 1.0 end);
        v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

        insert into troop_movements
          (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
        values (v_battle.defender_id, 'transfer', v_battle.territory_id, v_defender_home_id, v_arrives_at)
        returning id into v_movement_id;

        insert into troop_movement_units (movement_id, card_instance_id)
        select v_movement_id, unnest(v_moving_ids);

        update card_instances set status = 'in_transit'
        where instance_id = any(v_moving_ids);
      end if;
    end if;
  else
    -- Not captured (defender/expired win, or is_home_target/cap-blocked
    -- attacker win): territory ownership is unchanged, only the lock clears.
    update territories set battle_locked_by = null where id = v_battle.territory_id;

    -- Send home whatever the attacker currently owns at the territory —
    -- the whole untouched roster for a no-combat outcome, or roster
    -- survivors plus any mid-battle captures for a combat outcome. Also
    -- covers an attacker surrender: remaining roster takes the full
    -- original transfer duration back to its origin, same as any other
    -- attacker loss here.
    select array_agg(instance_id) into v_moving_ids
    from card_instances
    where owner_id = v_battle.attacker_id
      and stationed_territory_id = v_battle.territory_id;

    if v_moving_ids is not null and array_length(v_moving_ids, 1) > 0 then
      select nation into v_mover_nation from players where id = v_battle.attacker_id;
      select x, y into v_from_x, v_from_y from territories where id = v_battle.territory_id;
      select x, y into v_to_x, v_to_y from territories where id = v_origin_territory_id;
      v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
      v_transfer_hrs := greatest(0.25, v_distance * 0.3)
        * (case when v_mover_nation = 'mongol_horde' then 0.75 else 1.0 end);
      v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

      insert into troop_movements
        (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
      values (v_battle.attacker_id, 'transfer', v_battle.territory_id, v_origin_territory_id, v_arrives_at)
      returning id into v_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id)
      select v_movement_id, unnest(v_moving_ids);

      update card_instances set status = 'in_transit'
      where instance_id = any(v_moving_ids);
    end if;
  end if;

  update battles
  set status = case when p_winner_side is null then 'expired' else 'resolved' end,
      winner_side = p_winner_side,
      resolved_at = now()
  where id = p_battle_id;

  -- Award the existing 50-XP battle-win reward through the shared helper
  -- (also applies to a surrender-ended battle — still a decisive win).
  if p_winner_side is not null then
    v_winner_id := case p_winner_side
      when 'attacker' then v_battle.attacker_id
      when 'defender' then v_battle.defender_id
    end;

    if v_winner_id is not null then
      perform _award_xp(v_winner_id, 50);

      -- Battle-only bonus: independent 1% random structure-card reward.
      if random() < 0.01 then
        v_structure_category := case when random() < 0.5 then 'castle' else 'village' end;
        insert into card_instances (template_id, owner_id, stationed_territory_id, status)
        values (v_structure_category || '-common', v_winner_id, null, 'stationed');
      end if;
    end if;
  end if;
end;
$$;

create or replace function surrender_battle(p_battle_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_battle record;
begin
  perform resolve_due_battles();

  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle not found';
  end if;
  if v_battle.status <> 'active' then
    raise exception 'battle is not currently active and cannot be surrendered';
  end if;

  if caller = v_battle.attacker_id then
    perform _finalize_battle(p_battle_id, 'defender');
  elsif v_battle.defender_id is not null and caller = v_battle.defender_id then
    perform _finalize_battle(p_battle_id, 'attacker', true);
  else
    raise exception 'caller is not a participant in this battle';
  end if;
end;
$$;
