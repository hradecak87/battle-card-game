-- Fix follow-up: cap wild/NPC garrison growth so an unclaimed village/castle
-- can never become effectively unbeatable.
--
-- 0053 fixed the "player <NULL> not found" crash by letting a captured
-- (losing) attacker card join the wild garrison when the round winner has no
-- owner. But that alone lets the garrison grow without limit: every failed
-- attack adds one more card to the village, so a popular attack target could
-- snowball into an unbeatable army over time.
--
-- Fix: cap the wild garrison at its designed size for the tile's difficulty
-- (same 3/7/11/15/20 table used at world-gen time by
-- scripts/generate-world.ts's NPC_GARRISON_SIZES). Below the cap, captured
-- cards simply join as before. At/above the cap, a captured card only joins
-- if it's stronger (by _army_power) than the weakest existing garrison card,
-- which is discarded to make room; otherwise the captured card itself is
-- discarded. This keeps the garrison's headcount bounded while still letting
-- it "harden" toward tougher cards over time, without unbounded growth.

-- Wild/NPC garrison size cap per tile difficulty (must stay in sync with
-- NPC_GARRISON_SIZES in scripts/generate-world.ts). Used by _resolve_round to
-- stop a wild village/castle from growing stronger than intended when it
-- repeatedly wins rounds and captures attacker cards.
create or replace function _npc_garrison_target_size(p_difficulty smallint)
returns integer
language sql
immutable
as $$
  select case p_difficulty
    when 1 then 3
    when 2 then 7
    when 3 then 11
    when 4 then 15
    when 5 then 20
    else 3
  end;
$$;

create or replace function _resolve_round(
  p_battle_id uuid,
  p_attacker_card uuid,
  p_defender_card uuid,
  p_auto_picked boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_round record;
  v_next_round integer;
  v_atk_rank text; v_atk_base jsonb; v_atk_owner uuid; v_atk_nation nation_id;
  v_def_rank text; v_def_base jsonb; v_def_owner uuid; v_def_nation nation_id;
  v_castle_rank text; v_village_rank text; v_wall_rank text;
  v_atk_eff record;
  v_def_eff record;
  v_atk_dmg numeric; v_def_dmg numeric;
  v_ttk_attacker_wins numeric; v_ttk_defender_wins numeric;
  v_attacker_rate numeric; v_defender_rate numeric; v_attacker_win_probability numeric;
  v_deterministic_winner text; v_actual_winner text; v_roll double precision;
  v_winner_card uuid; v_loser_card uuid; v_winner_owner uuid;
  v_flavor_text text;
  v_resting_until integer;
  v_territory_difficulty smallint;
  v_garrison_target_size integer;
  v_garrison_count integer;
  v_weakest_garrison_card uuid;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  v_next_round := v_battle.current_round + 1;

  select * into v_round
  from battle_rounds
  where battle_id = p_battle_id and round_number = v_next_round
  for update;
  if v_round.defender_card_instance_id is not null or v_round.skipped then
    return;
  end if;

  perform _trigger_instant_boost_if_needed(p_battle_id, v_next_round, p_attacker_card, p_defender_card);

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select ct.rank, ct.base_stats, ci.owner_id into v_def_rank, v_def_base, v_def_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_defender_card;
  select nation into v_def_nation from players where id = v_def_owner;

  select castle_rank, village_rank, wall_rank into v_castle_rank, v_village_rank, v_wall_rank
  from territories where id = v_battle.territory_id;

  select * into v_atk_eff from _compute_battle_effective_stats(
    p_battle_id, 'attacker', v_next_round, v_atk_base, v_atk_rank, v_atk_nation, false, null, null
  );
  select * into v_def_eff from _compute_battle_effective_stats(
    p_battle_id, 'defender', v_next_round, v_def_base, v_def_rank, v_def_nation, true, v_castle_rank, v_village_rank, v_wall_rank
  );

  v_atk_dmg := greatest(0, greatest(v_atk_eff.str, v_atk_eff.lng) - v_def_eff.def);
  v_def_dmg := greatest(0, greatest(v_def_eff.str, v_def_eff.lng) - v_atk_eff.def);
  v_ttk_attacker_wins := case when v_atk_dmg > 0 then v_def_eff.hp::numeric / v_atk_dmg else 'infinity'::numeric end;
  v_ttk_defender_wins := case when v_def_dmg > 0 then v_atk_eff.hp::numeric / v_def_dmg else 'infinity'::numeric end;

  if v_ttk_attacker_wins < v_ttk_defender_wins then
    v_deterministic_winner := 'attacker';
  else
    v_deterministic_winner := 'defender';
  end if;

  v_attacker_rate := case when v_atk_dmg > 0 then v_atk_dmg / v_def_eff.hp::numeric else 0 end;
  v_defender_rate := case when v_def_dmg > 0 then v_def_dmg / v_atk_eff.hp::numeric else 0 end;
  v_attacker_win_probability := case
    when v_attacker_rate = 0 and v_defender_rate = 0 then 0.03
    else 0.03 + (v_attacker_rate / (v_attacker_rate + v_defender_rate)) * 0.94
  end;

  v_roll := random();
  if v_roll < v_attacker_win_probability::double precision then
    v_actual_winner := 'attacker';
    v_winner_card := p_attacker_card;
    v_loser_card := p_defender_card;
  else
    v_actual_winner := 'defender';
    v_winner_card := p_defender_card;
    v_loser_card := p_attacker_card;
  end if;

  if v_actual_winner <> v_deterministic_winner then
    select text into v_flavor_text from combat_flavor_texts order by random() limit 1;
  end if;

  select owner_id into v_winner_owner from card_instances where instance_id = v_winner_card;
  if v_winner_owner is not null then
    perform _deposit_or_grant_card(v_winner_owner, v_loser_card);
  else
    -- Winner is an unowned wild/NPC garrison card (owner_id is null): the captured
    -- card has no player to deposit to. Cap the wild garrison at its designed
    -- size for this tile's difficulty so it can never grow stronger than
    -- intended by repeatedly defeating attackers (a village must not become
    -- effectively unbeatable over time). Below the cap, the captured card
    -- simply joins the garrison. At/above the cap, it only joins if it beats
    -- the weakest existing garrison card (which is then discarded);
    -- otherwise the captured card itself is discarded.
    select difficulty into v_territory_difficulty
    from territories where id = v_battle.territory_id;

    v_garrison_target_size := _npc_garrison_target_size(v_territory_difficulty);

    select count(*) into v_garrison_count
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id is null
      and ct.category = 'unit';

    if v_garrison_count < v_garrison_target_size then
      update card_instances
      set owner_id = null,
          stationed_territory_id = v_battle.territory_id,
          status = 'stationed',
          deposit_expires_at = null
      where instance_id = v_loser_card;
    else
      select ci.instance_id into v_weakest_garrison_card
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = v_battle.territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
        and ci.instance_id <> v_winner_card
      order by _army_power(array[ci.instance_id]) asc
      limit 1;

      if v_weakest_garrison_card is not null
         and _army_power(array[v_loser_card]) > _army_power(array[v_weakest_garrison_card]) then
        begin
          delete from card_instances where instance_id = v_weakest_garrison_card;
        exception
          when foreign_key_violation then
            -- referenced by historical battle_rounds/battle_unit_rest rows; can't
            -- hard-delete, so just orphan it (no owner, no station) instead.
            update card_instances
            set owner_id = null,
                stationed_territory_id = null,
                status = 'stationed',
                deposit_expires_at = null
            where instance_id = v_weakest_garrison_card;
        end;

        update card_instances
        set owner_id = null,
            stationed_territory_id = v_battle.territory_id,
            status = 'stationed',
            deposit_expires_at = null
        where instance_id = v_loser_card;
      else
        perform _return_card(v_loser_card, 'wild_garrison_full');
      end if;
    end if;
  end if;

  update battle_rounds
  set defender_card_instance_id = p_defender_card,
      winner_card_instance_id = v_winner_card,
      auto_picked = p_auto_picked,
      resolved_at = now(),
      attacker_atk = greatest(v_atk_eff.str, v_atk_eff.lng),
      attacker_dmg_dealt = v_atk_dmg,
      attacker_ttk = case when v_ttk_attacker_wins = 'infinity'::numeric then null else v_ttk_attacker_wins end,
      defender_atk = greatest(v_def_eff.str, v_def_eff.lng),
      defender_dmg_dealt = v_def_dmg,
      defender_ttk = case when v_ttk_defender_wins = 'infinity'::numeric then null else v_ttk_defender_wins end,
      attacker_win_probability = v_attacker_win_probability,
      flavor_text = v_flavor_text
  where battle_id = p_battle_id and round_number = v_next_round;

  update battles set current_round = v_next_round where id = p_battle_id;
  v_resting_until := v_next_round + 2;

  insert into battle_unit_rest (battle_id, card_instance_id, resting_until_round, times_used)
  values (p_battle_id, p_attacker_card, v_resting_until, 1),
         (p_battle_id, p_defender_card, v_resting_until, 1)
  on conflict (battle_id, card_instance_id)
  do update set resting_until_round = excluded.resting_until_round,
                times_used = battle_unit_rest.times_used + 1;
end;
$$;
