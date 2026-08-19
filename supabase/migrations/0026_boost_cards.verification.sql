-- 0026_boost_cards.verification.sql
--
-- Manual / local verification checklist for boost cards. Do NOT run against
-- the live project automatically.

-- 1. Schema shape
-- select category, boost_type, effect_kind, instant_effect_kind, pct_str, pct_lng, pct_def, pct_hp
-- from card_templates
-- where category = 'boost'
-- order by rank, id;

-- 2. Battle columns
-- select attacker_boost_instance_id, defender_boost_instance_id,
--        attacker_boost_active_from_round, defender_boost_active_from_round
-- from battles
-- order by created_at desc
-- limit 5;

-- 3. Hidden-info territory RPC
-- select * from get_visible_territory_cards(:foreign_territory_id);
-- -> foreign boost rows should expose only rank/category; name/effect fields null
-- -> own boost rows should expose full details

-- 4. Attack declaration with offensive boost
-- select declare_attack(
--   :target_territory_id,
--   jsonb_build_array(
--     jsonb_build_object(
--       'origin_territory_id', :origin_territory_id,
--       'card_instance_ids', to_jsonb(array[:unit_instance_id]::uuid[])
--     )
--   ),
--   :offensive_boost_instance_id
-- );
-- -> movement created with troop_movements.boost_card_instance_id set

-- 5. Activation
-- select activate_boost_card(:battle_id, :eligible_boost_instance_id);
-- -> sets *_boost_active_from_round = current_round + 1 for the correct side

-- 6. Battle read RPC
-- select * from get_battle(:battle_id);
-- -> battle JSON contains attacker_boost_cards / defender_boost_cards
-- -> opponent boost cards remain masked until activated

-- 7. Rewards
-- -- After a won battle, inspect the winner inventory for a 20% boost grant:
-- select ci.instance_id, ct.id, ct.rank, ct.category
-- from card_instances ci
-- join card_templates ct on ct.id = ci.template_id
-- where ci.owner_id = :winner_id
--   and ct.category = 'boost'
-- order by ci.minted_at desc nulls last, ci.instance_id desc
-- limit 10;

-- 8. Level milestone
-- -- Grant XP that crosses a multiple of 5 and confirm one new common/uncommon boost:
-- select _award_xp(:player_id, :xp_amount_crossing_5_level_boundary);
-- select ct.id, ct.rank
-- from card_instances ci
-- join card_templates ct on ct.id = ci.template_id
-- where ci.owner_id = :player_id
--   and ct.category = 'boost'
--   and ct.rank in ('common', 'uncommon')
-- order by ci.instance_id desc
-- limit 5;
