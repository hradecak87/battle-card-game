-- Card use limit per battle (backlog #17)
--
-- Caps each card instance at 5 fights per battle, keeps the counter across
-- captures, excludes exhausted cards from every battle eligibility query, and
-- ends battles immediately once a side still owns cards but all of them are
-- permanently exhausted.

create or replace function _max_card_uses() returns integer
language sql
immutable
as $$
  select 5;
$$;

alter table battle_unit_rest
  add column times_used integer not null default 0;

create or replace function _pick_npc_defender_card(
  p_battle_id uuid,
  p_attacker_card uuid,
  p_current_round integer
) returns uuid
language plpgsql
security definer
as $$
declare
  v_territory_id integer;
  v_castle_rank text;
  v_village_rank text;
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
  select territory_id into v_territory_id from battles where id = p_battle_id;
  select castle_rank, village_rank into v_castle_rank, v_village_rank
  from territories where id = v_territory_id;

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select * into v_atk_eff from _compute_effective_stats(
    v_atk_base, v_atk_rank, v_atk_nation, false, null, null);

  for v_candidate in
    select ci.instance_id, ct.rank, ct.base_stats
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_territory_id
      and ci.owner_id is null and ct.category = 'unit'
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
      v_candidate.base_stats, v_candidate.rank, null, true, v_castle_rank, v_village_rank);

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
    and ci.owner_id is null and ct.category = 'unit'
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
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  v_next_round := v_battle.current_round + 1;

  select * into v_round
  from battle_rounds
  where battle_id = p_battle_id and round_number = v_next_round
  for update;
  if not found then
    raise exception 'no pending round % for battle %', v_next_round, p_battle_id;
  end if;
  if v_round.defender_card_instance_id is not null or v_round.skipped then
    return;
  end if;

  select ct.rank, ct.base_stats, ci.owner_id into v_atk_rank, v_atk_base, v_atk_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_attacker_card;
  select nation into v_atk_nation from players where id = v_atk_owner;

  select ct.rank, ct.base_stats, ci.owner_id into v_def_rank, v_def_base, v_def_owner
  from card_instances ci join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_defender_card;
  select nation into v_def_nation from players where id = v_def_owner;

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

create or replace function _start_next_round(p_battle_id uuid) returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_next_round integer;
  v_is_npc boolean;
  v_attacker_total integer;
  v_defender_total integer;
  v_attacker_avail integer;
  v_defender_avail integer;
  v_attacker_non_exhausted integer;
  v_defender_non_exhausted integer;
  v_attacker_card uuid;
  v_defender_card uuid;
begin
  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;

  v_next_round := v_battle.current_round + 1;
  v_is_npc := v_battle.defender_id is null;

  select count(*) into v_attacker_total
  from battle_attacker_roster bar
  join card_instances ci on ci.instance_id = bar.card_instance_id
  where bar.battle_id = p_battle_id and ci.owner_id = v_battle.attacker_id;

  if v_is_npc then
    select count(*) into v_defender_total
    from card_instances ci join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id is null and ct.category = 'unit';
  else
    select count(*) into v_defender_total
    from card_instances ci join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id = v_battle.defender_id and ct.category = 'unit';
  end if;

  if v_attacker_total = 0 then
    perform _finalize_battle(p_battle_id, 'defender');
    return;
  end if;
  if v_defender_total = 0 then
    perform _finalize_battle(p_battle_id, 'attacker');
    return;
  end if;

  select count(*) into v_attacker_avail
  from battle_attacker_roster bar
  join card_instances ci on ci.instance_id = bar.card_instance_id
  where bar.battle_id = p_battle_id and ci.owner_id = v_battle.attacker_id
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and (
          bur.resting_until_round >= v_next_round
          or bur.times_used >= _max_card_uses()
        )
    );

  if v_is_npc then
    select count(*) into v_defender_avail
    from card_instances ci join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id is null and ct.category = 'unit'
      and not exists (
        select 1 from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
          and (
            bur.resting_until_round >= v_next_round
            or bur.times_used >= _max_card_uses()
          )
      );
  else
    select count(*) into v_defender_avail
    from card_instances ci join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_battle.territory_id
      and ci.owner_id = v_battle.defender_id and ct.category = 'unit'
      and not exists (
        select 1 from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
          and (
            bur.resting_until_round >= v_next_round
            or bur.times_used >= _max_card_uses()
          )
      );
  end if;

  if v_attacker_avail = 0 or v_defender_avail = 0 then
    select count(*) into v_attacker_non_exhausted
    from battle_attacker_roster bar
    join card_instances ci on ci.instance_id = bar.card_instance_id
    where bar.battle_id = p_battle_id
      and ci.owner_id = v_battle.attacker_id
      and coalesce((
        select bur.times_used
        from battle_unit_rest bur
        where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
      ), 0) < _max_card_uses();

    if v_is_npc then
      select count(*) into v_defender_non_exhausted
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = v_battle.territory_id
        and ci.owner_id is null
        and ct.category = 'unit'
        and coalesce((
          select bur.times_used
          from battle_unit_rest bur
          where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        ), 0) < _max_card_uses();
    else
      select count(*) into v_defender_non_exhausted
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = v_battle.territory_id
        and ci.owner_id = v_battle.defender_id
        and ct.category = 'unit'
        and coalesce((
          select bur.times_used
          from battle_unit_rest bur
          where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        ), 0) < _max_card_uses();
    end if;

    if v_attacker_non_exhausted = 0 then
      perform _finalize_battle(p_battle_id, 'defender');
      return;
    end if;
    if v_defender_non_exhausted = 0 then
      perform _finalize_battle(p_battle_id, 'attacker');
      return;
    end if;

    insert into battle_rounds (battle_id, round_number, skipped, resolved_at)
    values (p_battle_id, v_next_round, true, now());
    update battles set current_round = v_next_round where id = p_battle_id;
    perform _start_next_round(p_battle_id);
    return;
  end if;

  select ci.instance_id into v_attacker_card
  from battle_attacker_roster bar
  join card_instances ci on ci.instance_id = bar.card_instance_id
  where bar.battle_id = p_battle_id and ci.owner_id = v_battle.attacker_id
    and not exists (
      select 1 from battle_unit_rest bur
      where bur.battle_id = p_battle_id and bur.card_instance_id = ci.instance_id
        and (
          bur.resting_until_round >= v_next_round
          or bur.times_used >= _max_card_uses()
        )
    )
  order by random() limit 1;

  insert into battle_rounds (battle_id, round_number, attacker_card_instance_id)
  values (p_battle_id, v_next_round, v_attacker_card);

  if v_is_npc then
    v_defender_card := _pick_npc_defender_card(p_battle_id, v_attacker_card, v_next_round);
    perform _resolve_round(p_battle_id, v_attacker_card, v_defender_card, false);
    perform _start_next_round(p_battle_id);
  else
    update battles set round_deadline = now() + interval '120 seconds'
    where id = p_battle_id;
  end if;
end;
$$;

create or replace function resolve_due_battles() returns void
language plpgsql
security definer
as $$
declare
  v_battle record;
  v_round record;
  v_defender_card uuid;
begin
  for v_battle in
    select * from battles
    where status = 'awaiting_ready' and ready_deadline <= now()
    for update
  loop
    if v_battle.attacker_ready_at is null and v_battle.defender_ready_at is null then
      perform _finalize_battle(v_battle.id, null);
    elsif v_battle.attacker_ready_at is null and v_battle.defender_ready_at is not null then
      perform _finalize_battle(v_battle.id, 'defender');
    else
      perform _finalize_battle(v_battle.id, 'attacker');
    end if;
  end loop;

  for v_battle in
    select * from battles
    where status = 'active' and round_deadline is not null and round_deadline <= now()
    for update
  loop
    select * into v_round
    from battle_rounds
    where battle_id = v_battle.id and round_number = v_battle.current_round + 1
    for update;

    if found and v_round.defender_card_instance_id is null and not v_round.skipped
      and v_battle.defender_id is not null then
      select ci.instance_id into v_defender_card
      from card_instances ci
      join card_templates ct on ct.id = ci.template_id
      where ci.stationed_territory_id = v_battle.territory_id
        and ci.owner_id = v_battle.defender_id and ct.category = 'unit'
        and not exists (
          select 1 from battle_unit_rest bur
          where bur.battle_id = v_battle.id and bur.card_instance_id = ci.instance_id
            and (
              bur.resting_until_round >= v_battle.current_round + 1
              or bur.times_used >= _max_card_uses()
            )
        )
      order by random() limit 1;

      if v_defender_card is not null then
        update battles set round_deadline = null where id = v_battle.id;
        perform _resolve_round(v_battle.id, v_round.attacker_card_instance_id, v_defender_card, true);
        perform _start_next_round(v_battle.id);
      end if;
    end if;
  end loop;
end;
$$;

create or replace function pick_defender_card(
  p_battle_id uuid,
  p_card_instance_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_battle record;
  v_round record;
  v_card record;
begin
  perform resolve_due_battles();

  select * into v_battle from battles where id = p_battle_id for update;
  if not found then
    raise exception 'battle % not found', p_battle_id;
  end if;
  if v_battle.defender_id is null or caller <> v_battle.defender_id then
    raise exception 'caller is not the defender of this battle';
  end if;
  if v_battle.status <> 'active' then
    raise exception 'battle is not active';
  end if;

  select * into v_round
  from battle_rounds
  where battle_id = p_battle_id and round_number = v_battle.current_round + 1
  for update;
  if not found then
    raise exception 'no pending round for this battle';
  end if;
  if v_round.defender_card_instance_id is not null or v_round.skipped then
    raise exception 'this round already has a defender pick';
  end if;

  select ci.instance_id, ci.status, ci.stationed_territory_id, ct.category
  into v_card
  from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_card_instance_id and ci.owner_id = caller
  for update;
  if not found
     or v_card.status <> 'stationed'
     or v_card.stationed_territory_id <> v_battle.territory_id
     or v_card.category <> 'unit' then
    raise exception 'card is not an eligible defender for this battle';
  end if;
  if exists (
    select 1 from battle_unit_rest bur
    where bur.battle_id = p_battle_id and bur.card_instance_id = p_card_instance_id
      and bur.times_used >= _max_card_uses()
  ) then
    raise exception 'card has reached its use limit for this battle';
  end if;
  if exists (
    select 1 from battle_unit_rest bur
    where bur.battle_id = p_battle_id and bur.card_instance_id = p_card_instance_id
      and bur.resting_until_round >= v_battle.current_round + 1
  ) then
    raise exception 'card is currently resting';
  end if;

  update battles set round_deadline = null where id = p_battle_id;
  perform _resolve_round(p_battle_id, v_round.attacker_card_instance_id, p_card_instance_id, false);
  perform _start_next_round(p_battle_id);
end;
$$;

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
        ),
        'times_used', coalesce((
          select bur.times_used
          from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
        ), 0)
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
        ),
        'times_used', coalesce((
          select bur.times_used
          from battle_unit_rest bur
          where bur.battle_id = b.id and bur.card_instance_id = ci.instance_id
        ), 0)
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
