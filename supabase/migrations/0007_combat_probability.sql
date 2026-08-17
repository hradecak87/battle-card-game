-- ---------------------------------------------------------------------------
-- 0007_combat_probability.sql
--
-- Probabilistic battle rounds + upset flavor text.
--
-- 1. Adds 2 nullable columns to battle_rounds:
--    - attacker_win_probability numeric
--    - flavor_text text
--    `get_battle` already merges `to_jsonb(br.*)`, so the new columns flow
--    through to the client automatically without changing that RPC.
-- 2. Creates a small combat_flavor_texts lookup table and seeds it with
--    Czech upset lines.
-- 3. Replaces _resolve_round so the old TTK formula still computes the
--    deterministic favorite, but the actual winner is drawn probabilistically
--    from a 3%-97% bounded win chance and upsets store a random flavor text.
-- ---------------------------------------------------------------------------

alter table battle_rounds
  add column attacker_win_probability numeric,
  add column flavor_text text;

create table combat_flavor_texts (
  id serial primary key,
  text text not null
);

alter table combat_flavor_texts enable row level security;

create policy combat_flavor_texts_select_all on combat_flavor_texts for select using (true);

insert into combat_flavor_texts (text) values
  ('Polovina vojska onemocněla úplavicí těsně před bitvou.'),
  ('Praporečník zakopl a formace se na chvíli rozpadla.'),
  ('Vítr se otočil právě ve chvíli, kdy letěly první šípy.'),
  ('Kůň velitele se splašil a poctivě pošlapal vlastní zálohy.'),
  ('Zásoby piva došly dřív než odvaha.'),
  ('Zvěd si spletl mapu a část oddílu dorazila jinam.'),
  ('Bubeník zrychlil pochod tak nešťastně, až se předvoj srazil se zadním vojem.'),
  ('Most přes potok povolil přesně pod těmi nejdůležitějšími.'),
  ('Kušiník si popletl povel a vypálil o jednu minutu příliš brzy.'),
  ('V poli se našla jáma, kterou nikdo při poradě nezmínil.'),
  ('Strážný usnul ve stínu vozu a probudil se až po zmatku.'),
  ('Kapitán chtěl pronést řeč, ale dav právě slyšel jen slovo útěk.'),
  ('Kovář ráno opravil meče, leč zapomněl na řemeny.'),
  ('Mlýn u cesty začal hořet a půlka oddílu to šla hasit.'),
  ('Žold přišel pozdě a věrnost s ním.'),
  ('Polní kuchař převrátil kotel a morálka se odporoučela.');

-- ---------------------------------------------------------------------------
-- _resolve_round: identical to 0005_battle_round_breakdown.sql's version,
-- except the winner is now chosen probabilistically from the already-computed
-- damage race, while the old lower-TTK winner is preserved only as the
-- "deterministic favorite" for upset detection/flavor text.
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
  v_attacker_rate numeric; v_defender_rate numeric; v_attacker_win_probability numeric;
  v_deterministic_winner text; v_actual_winner text; v_roll double precision;
  v_winner_card uuid; v_loser_card uuid; v_winner_owner uuid;
  v_flavor_text text;
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
    v_deterministic_winner := 'attacker';
  else
    v_deterministic_winner := 'defender';
  end if;

  v_attacker_rate := case when v_atk_dmg > 0 then v_atk_dmg / v_def_eff.hp::numeric else 0 end;
  v_defender_rate := case when v_def_dmg > 0 then v_def_dmg / v_atk_eff.hp::numeric else 0 end;

  if v_attacker_rate = 0 and v_defender_rate = 0 then
    v_attacker_win_probability := 0.03;
  else
    v_attacker_win_probability := 0.03 + (v_attacker_rate / (v_attacker_rate + v_defender_rate)) * 0.94;
  end if;

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
    select text into v_flavor_text
    from combat_flavor_texts
    order by random()
    limit 1;
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
      defender_ttk = case when v_ttk_defender_wins = 'infinity'::numeric then null else v_ttk_defender_wins end,
      attacker_win_probability = v_attacker_win_probability,
      flavor_text = v_flavor_text
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
