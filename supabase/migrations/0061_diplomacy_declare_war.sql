-- Allow a player to manually declare war on another player from the
-- diplomacy screen (territory garrison panel entry point), without first
-- having to launch an attack. Mirrors the automatic war-creation block in
-- _declare_attack_core() (0045_diplomacy_war_creation.sql) — same
-- diplomacy_relations insert shape, same 'war_declared' world_event +
-- notification pair — just triggered directly instead of as a side effect
-- of an attack.

create or replace function diplomacy_declare_war(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := diplomacy_require_player();
  v_target_is_npc boolean;
  v_relation_created boolean := false;
begin
  if p_target_id = v_caller then
    raise exception 'cannot declare war on yourself';
  end if;

  select coalesce(is_npc, false) into v_target_is_npc
  from players where id = p_target_id;
  if not found then
    raise exception 'target player not found';
  end if;
  if v_target_is_npc then
    raise exception 'cannot declare war on an NPC kingdom';
  end if;

  perform diplomacy_lock_pair(v_caller, p_target_id);

  insert into diplomacy_relations (
    player_a_id,
    player_b_id,
    state,
    war_started_at
  )
  values (
    least(v_caller, p_target_id),
    greatest(v_caller, p_target_id),
    'war',
    now()
  )
  on conflict (player_a_id, player_b_id) do nothing;

  v_relation_created := found;

  if not v_relation_created then
    raise exception 'already at war with this player';
  end if;

  insert into world_events (event_type, payload)
  select
    'war_declared',
    jsonb_build_object(
      'attacker_id', attacker.id,
      'attacker_display_name', attacker.display_name,
      'attacker_home_x', attacker_home.x::integer,
      'attacker_home_y', attacker_home.y::integer,
      'defender_id', defender.id,
      'defender_display_name', defender.display_name,
      'defender_home_x', defender_home.x::integer,
      'defender_home_y', defender_home.y::integer
    )
  from players attacker
  left join territories attacker_home
    on attacker_home.owner_id = attacker.id
   and attacker_home.is_home = true
  join players defender
    on defender.id = p_target_id
  left join territories defender_home
    on defender_home.owner_id = defender.id
   and defender_home.is_home = true
  where attacker.id = v_caller;

  perform _notify(
    v_caller,
    'war_declared',
    (
      select jsonb_build_object(
        'other_player_id', defender.id,
        'other_display_name', defender.display_name
      )
      from players defender
      where defender.id = p_target_id
    )
  );

  perform _notify(
    p_target_id,
    'war_declared',
    (
      select jsonb_build_object(
        'other_player_id', attacker.id,
        'other_display_name', attacker.display_name
      )
      from players attacker
      where attacker.id = v_caller
    )
  );
end;
$$;

revoke execute on function diplomacy_declare_war(uuid) from public, anon;
grant execute on function diplomacy_declare_war(uuid) to authenticated;
