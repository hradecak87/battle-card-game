-- Card use limit per battle — manual SQL verification checklist
--
-- Paste into a scratch Supabase SQL editor only after 0015_card_use_limit.sql
-- is applied. This file is not executed automatically.
--
-- Recommended setup before running the checks below:
--   1. Use the app (or your preferred scratch setup SQL) to create one active
--      PvP battle and one active NPC battle with known ids.
--   2. Substitute the placeholder ids below with real values from that
--      scratch battle state.
--   3. For the PvP checks, impersonate the real defender with
--      set_config('request.jwt.claim.sub', '<defender-id>', true).

-- ---------------------------------------------------------------------
-- 1. Fifth use increments `times_used` to 5 and `get_battle()` exposes the
--    counter for both attacker_roster and defender_pool.
-- ---------------------------------------------------------------------
-- Setup: play the same card instance through five resolved rounds in one
-- battle (capture is fine; the counter is per battle/card, not per side).
-- Substitute:
--   :battle_id
--   :card_instance_id

select battle_id, card_instance_id, resting_until_round, times_used
from battle_unit_rest
where battle_id = ':battle_id'
  and card_instance_id = ':card_instance_id'::uuid;
-- Expect: exactly one row with times_used = 5.

select
  jsonb_path_query_array(attacker_roster, '$[*] ? (@.instance_id == $card)', jsonb_build_object('card', ':card_instance_id')) as attacker_card_entry,
  jsonb_path_query_array(defender_pool, '$[*] ? (@.instance_id == $card)', jsonb_build_object('card', ':card_instance_id')) as defender_card_entry
from get_battle(':battle_id'::uuid);
-- Expect: whichever side currently owns the card shows `"times_used": 5`.

-- ---------------------------------------------------------------------
-- 2. pick_defender_card() rejects an exhausted card with the new friendly
--    error, even after it is no longer resting.
-- ---------------------------------------------------------------------
-- Setup: wait until the exhausted card is no longer resting for the pending
-- round, then substitute:
--   :battle_id
--   :defender_id
--   :exhausted_defender_card_id

do $$
begin
  perform set_config('request.jwt.claim.sub', ':defender_id', true);

  begin
    perform pick_defender_card(':battle_id'::uuid, ':exhausted_defender_card_id'::uuid);
    raise exception 'Expected pick_defender_card to reject an exhausted card';
  exception
    when others then
      assert position('card has reached its use limit for this battle' in sqlerrm) > 0,
        format('Expected exhausted-card error, got %s', sqlerrm);
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. NPC auto-pick never selects a card whose `times_used` is already 5.
-- ---------------------------------------------------------------------
-- Setup: in a scratch NPC battle, set one NPC defender card to exactly 5/5,
-- leave at least one other NPC defender card below the limit, then
-- substitute:
--   :npc_battle_id
--   :exhausted_npc_card_id

do $$
declare
  v_before_round integer;
  v_latest_round record;
begin
  select current_round into v_before_round
  from battles
  where id = ':npc_battle_id'::uuid;

  perform _start_next_round(':npc_battle_id'::uuid);

  select *
  into v_latest_round
  from battle_rounds
  where battle_id = ':npc_battle_id'::uuid
    and round_number > v_before_round
    and not skipped
  order by round_number desc
  limit 1;

  assert v_latest_round.defender_card_instance_id <> ':exhausted_npc_card_id'::uuid,
    'Expected NPC auto-pick to avoid the exhausted defender card';
end;
$$;

-- ---------------------------------------------------------------------
-- 4. A side that still owns cards but all of them are exhausted loses
--    immediately instead of entering an infinite skip-round loop.
-- ---------------------------------------------------------------------
-- Setup: prepare an active battle where one side still owns at least one
-- unit card, but every currently-owned card for that side already has
-- times_used = 5 and the opposing side owns at least one card below 5/5.
-- Substitute:
--   :battle_id
--   :expected_winner_side   -- 'attacker' or 'defender'

select _start_next_round(':battle_id'::uuid);

select status, winner_side, resolved_at
from battles
where id = ':battle_id'::uuid;
-- Expect: status = 'resolved', winner_side = :expected_winner_side, and
-- resolved_at is not null.

-- ---------------------------------------------------------------------
-- 5. Existing round breakdown/history payloads still come through after the
--    migration redefines _resolve_round() and get_battle().
-- ---------------------------------------------------------------------
-- Setup: use any resolved round from the scratch battle above, then
-- substitute:
--   :battle_id

select jsonb_pretty(rounds->0)
from get_battle(':battle_id'::uuid);
-- Expect: the first round object still includes:
--   attacker_atk
--   attacker_dmg_dealt
--   attacker_ttk
--   defender_atk
--   defender_dmg_dealt
--   defender_ttk
--   attacker_win_probability
--   flavor_text
--   attacker_card
--   defender_card
