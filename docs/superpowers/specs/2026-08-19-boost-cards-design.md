# Boost karty — design (backlog: boost-cards-module, #26)

## Přehled
Nová kategorie karty `card_templates.category = 'boost'`, sdílí `rank` a
`card_instances`/`stationed_territory_id` infrastrukturu s jednotkami. Dva
podtypy (`boost_type`): `territorial` (obranné, stanovaná na bráněném území)
a `offensive` (cestuje s útočícím vojskem). Dva druhy efektu
(`effect_kind`): `stat_multiplier` (% bonus na vybrané staty) a
`instant_effect` (jednorázový efekt, první implementace: `steal_unit`).

## Datový model (nová migrace)
- `card_templates`: povolit `category = 'boost'`; nové sloupce `boost_type
  text` (`territorial`|`offensive`), `effect_kind text`
  (`stat_multiplier`|`instant_effect`), `instant_effect_kind text null`
  (např. `steal_unit`), `pct_str/pct_lng/pct_def/pct_hp integer null` (%
  bonus na daný stat, jen pro `stat_multiplier`; null = neovlivňuje).
  Rank multiplikátor magnitudy = existující `RANK_MULTIPLIER`
  (1.0/1.15/1.35/1.6/2.0) aplikovaný na autorská % v katalogu.
- `battles`: nové nullable sloupce `attacker_boost_instance_id`,
  `defender_boost_instance_id` (fk card_instances), `attacker_boost_active_from_round`,
  `defender_boost_active_from_round` (int, null = neaktivováno).
- Nová RPC `activate_boost_card(p_battle_id, p_card_instance_id)`:
  ověří caller je účastník (attacker/defender), karta patří jemu a je
  k bitvě způsobilá (territorial → stanovaná na bráněném území;
  offensive → byla vybrána při `declare_attack`), ještě nebyla v této
  bitvě aktivována ani použita jinde, caller je online (existující
  heartbeat/"oba online" pravidlo), nastaví
  `..._boost_instance_id`/`..._boost_active_from_round = current_round + 1`.
- `declare_attack`: rozšířit o volitelný `p_boost_card_instance_id` —
  karta musí být stanovaná na (jednom z) origin území, uloží se do nového
  battles řádku při jeho vzniku (`resolve_due_movements()`).
- Round-resolution (existující funkce co počítá efektivní staty
  duelů/kol): pro kolo > `..._boost_active_from_round`
  přičíst `stat_multiplier` % k příslušným statům všech zbývajících karet
  dané strany; pro `instant_effect=steal_unit` v prvním kole
  `>= ..._boost_active_from_round` vybrat náhodnou dosud nevyřazenou
  kartu soupeře v bitvě a změnit jí `owner_id` na aktivátora (zmizí ze
  zbývajícího poolu soupeře pro další kola).
- Po skončení bitvy: aktivovaná boost karta se natrvalo odstraní
  (spálí) — analogicky k tomu, jak zanikají spotřebované zdroje jinde v
  projektu (ne jako trvalé jednotky, které nikdy nemizí). Neaktivovaná
  karta se nedotčená vrací (transfer zpět / zůstává stanovaná).

## Získávání a obchodování
- Boj: vítěz má 20 % šanci na náhodnou boost kartu (stejné rozdělení
  rarit jako u jednotek), nezávisle na kartách poraženého.
- XP: reuse level-milestone patternu z `0009_structure_card_rewards.sql`
  — každých 5 levelů garantovaný náhodný common/uncommon boost.
- Obchodování: rozšířit existující trade-offers UI o `category='boost'`
  karty (bez nové mechaniky).

## Utajení (#26)
Soupeř vidí u cizích boost karet jen **počet + raritu**, nikdy název/efekt
— v garrison/detail panelu cizího území, v přípravě útoku, i za běhu
bitvy dokud danou kartu vlastník neaktivuje (pak se odkryje).

## Limity
- Max **1 aktivovaná boost karta na stranu za bitvu** (žádné stackování).
- Boost karty se nepočítají do žádného zvláštního limitu nad rámec
  obvyklého vlastnictví karet (card-limit škálování dle levelu je
  samostatná budoucí položka #27, mimo scope).

## UI dotčená místa
`GarrisonModal` (zobrazení stanovaných boost karet — vlastní vs. cizí
utajené), `DeclareAttackModal` (výběr 1 offensive boost karty k útoku),
battle screen (`BattleScreen`/`RosterStrip` — aktivační tlačítko + výběr
karty), `Collection` page (nová kategorie karet).

## Katalog obsahu
Nová sada boost card templates (různé kombinace ovlivněných statů a
%, napříč 5 ranky, oba `boost_type`, alespoň jedna `instant_effect`
karta "Krysa" = `steal_unit`) — autorská data v `catalog-data.json`,
podobně jako u jednotek.
