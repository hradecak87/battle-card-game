-- Adds 14 new boost card templates (5 -> 5 per rank, 25 total) so a 5x5
-- artwork sheet can be generated and cropped for all boost cards.
-- Mirrors the insert pattern from 0047_wall_structure_card.sql; schema/
-- constraints for the `boost` category already exist (0026_boost_cards.sql).
-- lib/cards/boost-catalog-data.json is the source of truth these rows were
-- copied from (scripts/seed-card-templates.ts builds fresh installs from
-- that same file — this migration only backfills existing projects).

insert into card_templates (
  id,
  category,
  unit_type,
  rank,
  name,
  flavor_text,
  base_stats,
  defense_bonus_pct,
  attack_bonus_pct,
  total_supply,
  boost_type,
  effect_kind,
  instant_effect_kind,
  pct_str,
  pct_lng,
  pct_def,
  pct_hp
)
values
  ('boost-territorial-common-02', 'boost', null, 'common', 'Ostnatý příkop', 'Hluboký příkop s kůly zpomalí každý nájezd na hradbu.', null, null, null, null, 'territorial', 'stat_multiplier', null, null, null, 7, 3),
  ('boost-territorial-common-03', 'boost', null, 'common', 'Hlásná trouba', 'Včasné varování dá obráncům čas zaujmout pozice na hradbě.', null, null, null, null, 'territorial', 'stat_multiplier', null, null, 5, 5, null),
  ('boost-offensive-common-02', 'boost', null, 'common', 'Naostřené čepele', 'Čerstvě nabroušené zbraně sekají hlouběji do první linie.', null, null, null, null, 'offensive', 'stat_multiplier', null, 9, null, null, null),
  ('boost-territorial-uncommon-02', 'boost', null, 'uncommon', 'Palisáda z kůlů', 'Rychle postavená palisáda drží formaci pohromadě i pod tlakem.', null, null, null, null, 'territorial', 'stat_multiplier', null, null, null, 10, 6),
  ('boost-offensive-uncommon-02', 'boost', null, 'uncommon', 'Jízdní rozvědka', 'Zvědové na koních odhalí slabiny obrany dřív, než dorazí hlavní voj.', null, null, null, null, 'offensive', 'stat_multiplier', null, 6, 8, null, null),
  ('boost-offensive-uncommon-03', 'boost', null, 'uncommon', 'Válečná hudba', 'Píšťaly a bubny drží krok útoku a nedovolí řadám polevit.', null, null, null, null, 'offensive', 'stat_multiplier', null, 10, null, null, 5),
  ('boost-territorial-rare-02', 'boost', null, 'rare', 'Podzemní chodby', 'Skryté chodby dovolí obráncům rychle přesouvat posily tam, kde jich je nejvíc třeba.', null, null, null, 18, 'territorial', 'stat_multiplier', null, null, null, 14, 6),
  ('boost-territorial-rare-03', 'boost', null, 'rare', 'Ohnivé smoly', 'Vroucí smůla lijící se z hradeb spálí i tu nejodhodlanější vlnu útočníků.', null, null, null, 12, 'territorial', 'stat_multiplier', null, null, 14, 10, null),
  ('boost-territorial-epic-02', 'boost', null, 'epic', 'Posvěcené hradby', 'Kněžské požehnání na kamenech dodává obráncům nezlomnou víru.', null, null, null, 6, 'territorial', 'stat_multiplier', null, null, null, 16, 14),
  ('boost-offensive-epic-02', 'boost', null, 'epic', 'Beran z posvátného dubu', 'Beranidlo z posvátného dubu prolomí i tu nejpevnější bránu.', null, null, null, 5, 'offensive', 'stat_multiplier', null, 20, null, 8, null),
  ('boost-offensive-epic-03', 'boost', null, 'epic', 'Žoldnéřská legie', 'Ostřílení žoldáci útočí s chladnokrevnou přesností a nulovým slitováním.', null, null, null, 6, 'offensive', 'stat_multiplier', null, 15, 15, null, null),
  ('boost-territorial-legend-02', 'boost', null, 'legend', 'Poslední ohnivá bašta', 'Dokud hoří poslední maják, obránci nikdy neustoupí.', null, null, null, 2, 'territorial', 'stat_multiplier', null, null, null, 20, 18),
  ('boost-territorial-legend-03', 'boost', null, 'legend', 'Přísaha obránců', 'Přísaha padlých králů drží linii pevně i proti přesile.', null, null, null, 2, 'territorial', 'stat_multiplier', null, 12, 12, 16, 10),
  ('boost-offensive-legend-02', 'boost', null, 'legend', 'Poslední tažení dobyvatele', 'Dobyvatel, který nezná porážku, vede své vojsko do posledního, rozhodujícího úderu.', null, null, null, 2, 'offensive', 'stat_multiplier', null, 20, 16, null, 12)
on conflict (id) do nothing;
