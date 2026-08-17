-- ---------------------------------------------------------------------------
-- 0005_battle_round_breakdown.sql
--
-- Battle round result popup feature (spec:
-- docs/superpowers/specs/2026-08-17-battle-round-result-popup-design.md).
--
-- 1. Adds 6 nullable numeric columns to battle_rounds so the ATK/DMG/TTK
--    breakdown _resolve_round already computes (then previously discarded)
--    is persisted per round. `to_jsonb(br.*)` in get_battle already spreads
--    every battle_rounds column, so these 6 need no get_battle change.
-- 2. Updates _resolve_round to populate the 6 new columns.
-- 3. Updates get_battle to also resolve each round's attacker/defender
--    card straight from card_instances/card_templates by id (stable,
--    never deleted — only re-owned), independent of the live
--    attacker_roster/defender_pool arrays, which shrink as cards are
--    captured or die. This keeps historical round popups correct
--    regardless of what happened to a card after its round resolved.
-- ---------------------------------------------------------------------------

alter table battle_rounds
  add column attacker_atk numeric,
  add column attacker_dmg_dealt numeric,
  add column attacker_ttk numeric,     -- null represents "infinite" (0 damage dealt)
  add column defender_atk numeric,
  add column defender_dmg_dealt numeric,
  add column defender_ttk numeric;

-- ---------------------------------------------------------------------------
-- _resolve_round: identical to 0003_battles.sql's version, extended only to
-- also populate the 6 new breakdown columns from the already-computed
-- v_atk_eff/v_def_eff/v_atk_dmg/v_def_dmg/v_ttk_attacker_wins/
-- v_ttk_defender_wins locals (no new computation).
-- ---------------------------------------------------------------------------
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
  v_castle_rank text; v_village_rank text;
  v_atk_eff record;
  v_def_eff record;
  v_atk_dmg numeric; v_def_dmg numeric;
  v_ttk_attacker_wins numeric; v_ttk_defender_wins numeric;
  v_winner_card uuid; v_loser_card uuid; v_winner_owner uuid;
  v_resting_until integer;
begin
  -- Row-lock the battle first (mirrors start_claim's convention).
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  v_next_round := v_battle.current_round + 1;

  -- Row-lock and re-check the pending round immediately after acquiring
  -- the battle lock — closes the race where a concurrent auto-pick and an
  -- explicit pick could both try to resolve the same round.
  select * into v_round
  from battle_rounds
  where battle_id = p_battle_id and round_number = v_next_round
  for update;
  if not found then
    raise exception 'no pending round % for battle %', v_next_round, p_battle_id;
  end if;
  if v_round.defender_card_instance_id is not null or v_round.skipped then
    -- Already resolved by a concurrent caller; nothing more to do.
    return;
  end if;

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select ct.rank, ct.base_stats, ci.owner_id into v_def_rank, v_def_base, v_def_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_defender_card;
  select nation into v_def_nation from players where id = v_def_owner; -- null for NPC (v_def_owner null)

  select castle_rank, village_rank into v_castle_rank, v_village_rank
  from territories where id = v_battle.territory_id;

  select * into v_atk_eff from _compute_effective_stats(
    v_atk_base, v_atk_rank, v_atk_nation, false, null, null);
  select * into v_def_eff from _compute_effective_stats(
    v_def_base, v_def_rank, v_def_nation, true, v_castle_rank, v_village_rank);

  v_atk_dmg := greatest(0, greatest(v_atk_eff.str, v_atk_eff.lng) - v_def_eff.def);
  v_def_dmg := greatest(0, greatest(v_def_eff.str, v_def_eff.lng) - v_atk_eff.def);

  v_ttk_attacker_wins := case when v_atk_dmg > 0 then v_def_eff.hp::numeric / v_atk_dmg else 'infinity'::numeric end;
  v_ttk_defender_wins := case when v_def_dmg > 0 then v_atk_eff.hp::numeric / v_def_dmg else 'infinity'::numeric end;

  if v_ttk_attacker_wins < v_ttk_defender_wins then
    v_winner_card := p_attacker_card;
    v_loser_card := p_defender_card;
  else
    v_winner_card := p_defender_card;
    v_loser_card := p_attacker_card;
  end if;

  select owner_id into v_winner_owner from card_instances where instance_id = v_winner_card;

  -- Card capture: the loser's card flips ownership to the winner's
  -- current owner immediately (spec §2). If the winner is an NPC card,
  -- v_winner_owner is null, so the captured card becomes ownerless (an
  -- NPC-garrison card) too.
  update card_instances set owner_id = v_winner_owner where instance_id = v_loser_card;

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
      defender_ttk = case when v_ttk_defender_wins = 'infinity'::numeric then null else v_ttk_defender_wins end
  where battle_id = p_battle_id and round_number = v_next_round;

  -- CRITICAL: increment current_round BEFORE computing resting_until_round.
  update battles set current_round = v_next_round where id = p_battle_id;
  v_resting_until := v_next_round + 2;

  insert into battle_unit_rest (battle_id, card_instance_id, resting_until_round)
  values (p_battle_id, p_attacker_card, v_resting_until),
         (p_battle_id, p_defender_card, v_resting_until)
  on conflict (battle_id, card_instance_id)
  do update set resting_until_round = excluded.resting_until_round;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_battle: identical to 0003_battles.sql's version, extended only in the
-- `rounds` sub-select to merge in `attacker_card`/`defender_card` (each
-- {instance_id, template} or null), resolved directly from
-- card_instances/card_templates by id rather than from the live
-- attacker_roster/defender_pool arrays.
-- ---------------------------------------------------------------------------
create or replace function get_battle(p_battle_id uuid)
returns table (
  battle jsonb,
  attacker_roster jsonb,
  defender_pool jsonb,
  rounds jsonb
)
language plpgsql
security definer
as $$
declare
  v_battle record;
begin
  perform resolve_due_battles();

  select * into v_battle from battles where id = p_battle_id;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  return query
  select
    to_jsonb(b.*) as battle,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'instance_id', ci.instance_id,
        'owner_id', ci.owner_id,
        'status', ci.status,
        'template', to_jsonb(ct.*),
        'is_resting', exists (
          select 1 from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
            and bur.resting_until_round >= b.current_round + 1
        )
      ))
      from battle_attacker_roster bar
      join card_instances ci on ci.instance_id = bar.card_instance_id
      join card_templates ct on ct.id = ci.template_id
      where bar.battle_id = b.id
    ), '[]'::jsonb) as attacker_roster,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'instance_id', ci.instance_id,
        'owner_id', ci.owner_id,
        'status', ci.status,
        'template', to_jsonb(ct.*),
        'is_resting', exists (
          select 1 from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
            and bur.resting_until_round >= b.current_round + 1
        )
      ))
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = b.territory_id
        and ct.category = 'unit'
        and (
          (b.defender_id is not null and ci.owner_id = b.defender_id)
          or (b.defender_id is null and ci.owner_id is null)
        )
    ), '[]'::jsonb) as defender_pool,
    coalesce((
      select jsonb_agg(
        (to_jsonb(br.*) || jsonb_build_object(
          'attacker_card', (
            select jsonb_build_object('instance_id', ci.instance_id, 'template', to_jsonb(ct.*))
            from card_instances ci join card_templates ct on ct.id = ci.template_id
            where ci.instance_id = br.attacker_card_instance_id
          ),
          'defender_card', (
            select jsonb_build_object('instance_id', ci.instance_id, 'template', to_jsonb(ct.*))
            from card_instances ci join card_templates ct on ct.id = ci.template_id
            where ci.instance_id = br.defender_card_instance_id
          )
        ))
        order by br.round_number
      )
      from battle_rounds br
      where br.battle_id = b.id
    ), '[]'::jsonb) as rounds
  from battles b
  where b.id = p_battle_id;
end;
$$;
