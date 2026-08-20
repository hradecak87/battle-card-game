-- Critical bug fix: "function _compute_effective_stats(jsonb, text, nation_id,
-- boolean, unknown, unknown) is not unique".
--
-- 0047_wall_structure_card.sql changed _compute_effective_stats /
-- _compute_battle_effective_stats to add a p_wall_rank parameter (with a
-- default of null), but never dropped the pre-wall 6/9-param overloads.
-- Postgres treats a different parameter list as a distinct overload rather
-- than a replacement, so both versions of each function coexisted live.
-- Since the new p_wall_rank param defaults to null, the new overload can
-- also be called with only 6 (or 9) args -- making any 6-arg call to
-- _compute_effective_stats ambiguous between "the true 6-param overload"
-- and "the 7-param overload with wall_rank defaulted", and likewise for the
-- battle-stats wrapper. This broke every battle round where an NPC had to
-- auto-pick its defending card (_pick_npc_defender_card's attacker-side
-- call was still passing only 6 args), i.e. broke actual gameplay live.
--
-- Fix: drop the orphaned pre-wall overloads, and redefine
-- _pick_npc_defender_card to explicitly pass p_wall_rank (null) on its
-- attacker-side call for clarity/consistency with the defender-side call
-- just below it (which already passed 7 args).

drop function if exists _compute_effective_stats(jsonb, text, nation_id, boolean, text, text);
drop function if exists _compute_battle_effective_stats(uuid, text, integer, jsonb, text, nation_id, boolean, text, text);

create or replace function _pick_npc_defender_card(
  p_battle_id uuid,
  p_attacker_card uuid,
  p_current_round integer
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_territory_id integer;
  v_defender_owner uuid;
  v_defender_nation nation_id;
  v_castle_rank text;
  v_village_rank text;
  v_wall_rank text;
  v_atk_rank text; v_atk_base jsonb; v_atk_owner uuid; v_atk_nation nation_id;
  v_atk_eff record;
  v_candidate record;
  v_cand_eff record;
  v_atk_dmg numeric; v_def_dmg numeric;
  v_ttk_a numeric; v_ttk_d numeric;
  v_first uuid;
  v_winner uuid;
  v_candidates uuid[];
begin
  select territory_id, defender_id
  into v_territory_id, v_defender_owner
  from battles
  where id = p_battle_id;

  select castle_rank, village_rank, wall_rank into v_castle_rank, v_village_rank, v_wall_rank
  from territories where id = v_territory_id;

  select nation into v_defender_nation
  from players
  where id = v_defender_owner;

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select * into v_atk_eff from _compute_effective_stats(
    v_atk_base, v_atk_rank, v_atk_nation, false, null, null, null);

  for v_candidate in
    select ci.instance_id, ct.rank, ct.base_stats
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_territory_id
      and (
        (v_defender_owner is null and ci.owner_id is null)
        or ci.owner_id = v_defender_owner
      )
      and ct.category = 'unit'
      and not exists (
        select 1 from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
          and (
            bur.resting_until_round >= p_current_round
            or bur.times_used >= _max_card_uses()
          )
      )
    order by ci.instance_id
  loop
    if v_first is null then
      v_first := v_candidate.instance_id;
    end if;

    select * into v_cand_eff from _compute_effective_stats(
      v_candidate.base_stats, v_candidate.rank, v_defender_nation, true, v_castle_rank, v_village_rank, v_wall_rank);

    v_atk_dmg := greatest(0, greatest(v_atk_eff.str, v_atk_eff.lng) - v_cand_eff.def);
    v_def_dmg := greatest(0, greatest(v_cand_eff.str, v_cand_eff.lng) - v_atk_eff.def);
    v_ttk_a := case when v_atk_dmg > 0 then v_cand_eff.hp::numeric / v_atk_dmg else 'infinity'::numeric end;
    v_ttk_d := case when v_def_dmg > 0 then v_atk_eff.hp::numeric / v_def_dmg else 'infinity'::numeric end;

    if not (v_ttk_a < v_ttk_d) then
      v_winner := v_candidate.instance_id;
      exit;
    end if;
  end loop;

  if v_winner is not null then
    return v_winner;
  end if;

  if v_first is null then
    raise exception 'pick_npc_defender_card requires at least one candidate';
  end if;

  select array_agg(ci.instance_id) into v_candidates
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.stationed_territory_id = v_territory_id
    and (
      (v_defender_owner is null and ci.owner_id is null)
      or ci.owner_id = v_defender_owner
    )
    and ct.category = 'unit'
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and (
          bur.resting_until_round >= p_current_round
          or bur.times_used >= _max_card_uses()
        )
    );

  return v_candidates[1 + floor(random() * array_length(v_candidates, 1))::int];
end;
$$;
