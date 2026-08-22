# Karta Zvěd — design

Datum: 2026-08-22

## Motivace

Dnes hráč vidí **přesné karty** cizí stacionární posádky (na cizím/NPC/
divokém území i jako útočník v `DeclareAttackModal`) bez jakékoli akce —
stačí kliknout na políčko (`GarrisonModal`) nebo otevřít útočný modal.
Zdrojem je server-side RPC `get_visible_territory_cards()`
(`0068_troop_lending.sql`), volaná přes `getCardInstancesAtTerritory()` —
ta dnes maskuje jen boost karty cizího vlastníka (`is_masked`), jednotkové
karty (`unit_type`, `base_stats`, `rank`, ...) vrací **vždy plně**, bez
ohledu na `owner_id`. (Příchozí útok v `MovementDetailModal` už dnes
záměrně skrývá složení do začátku bitvy — to zůstává beze změny a tato
mechanika se ho netýká, jen mu přidává alternativu: aktivní instant-peek
skrz zvěda.)

Cílem je zavést novou kartu **Zvěd**, kterou je nutné aktivně vyslat, aby
hráč zjistil skutečné složení cizí **stacionární** posádky (nebo — přes
instant-peek — přicházejícího útoku). Bez vyslání zvěda (nebo bez platného
snapshotu) hráč vidí jen **hrubé rozsahy počtu karet podle rank** (stejné
bucket rozdělení, jaké dnes pohání pip kuličky na mapě: 1–5 / 6–10 / 11+).

## Rozsah (MVP)

- Nová kategorie karty `scout` — jediný template, žádné rankové varianty.
- Získávání: startovací balíček, denní odměna (každý sudý den), malá šance
  z bojové kořisti.
- Vyslání zvěda na: nepřátelské území hráče, NPC území, divokou (wild)
  posádku, přicházející útok na mé území (instant-peek varianta).
- Riziko cesty: 20 % šance na zabití zvěda (ztráta karty, notifikace
  vysílajícímu), nezávisle 50 % šance na odhalení identity vysílajícího
  (notifikace napadené straně).
- Snapshot vzniká až po návratu domů (nebo okamžitě u instant-peek), platí
  10 dní, poté zaniká.
- Bez platného snapshotu: bucket rozsahy + odlehčený "poměr sil" (vážený
  počet karet dle rank) s jasným disclaimerem, že jde o odhad.
- NPC nepoužívá scouting mechaniku — je již "vševidoucí" díky přímému
  čtení DB ve své rozhodovací logice; na odhalení nijak nereaguje (mimo
  rozsah MVP).

## 1. Karta Zvěd — datový model

- `card_templates.category = 'scout'` — nová kategorie vedle
  `unit`/`boost`/`castle`/`village`/`wall`.
- Jediný řádek: `rank = 'uncommon'` (čistě vizuální, nehraje roli
  multiplikátoru), `base_stats = {str: 0, lng: 0, def: 0, hp: 0, speed: 30}`
  (nejrychlejší jednotka ve hře).
- `card_instances` fungují beze změny (stejná tabulka, jiný `template_id`).
- Nový typový guard `isScoutTemplate()` v `lib/cards/types.ts`. Karta zvěda
  se **nesmí objevit** v žádném troop-checklistu pro claim/transfer/attack —
  filtrování na úrovni UI (jako dnes `isUnitTemplate`) **i** na úrovni RPC
  (`declare_attack`, `start_transfer`, `start_claim` musí odmítnout, pokud
  je mezi vybranými instancemi karta kategorie `scout`).
- Vizuál: `NonUnitTradingCard` dostane novou variantu (placeholder ikona,
  uncommon gradientní rámeček, žádné staty kromě speed zobrazeného jako
  "—" u ostatních atributů).

## 2. Získávání karet zvěda

- **Startovací balíček:** 1 karta zvěda při vytvoření hráčského profilu
  (stejné místo, kde se dnes generuje startovní sada karet).
- **Denní odměna:** `claim_daily_reward()` (`0013_level_up_cards.sql`) se
  rozšíří o novou větev `if mod(v_new_streak, 2) = 0` (analogicky k
  existující `mod(v_new_streak, 7) = 0` větvi) — každý sudý den navíc 1
  karta zvěda k běžné odměně.
- **Bojová kořist:** 5% šance na bonusový drop 1 karty zvěda navíc při
  vítězství v boji (integrační bod: stejná funkce rodina
  `_finalize_battle_base_0025` řešící rozdání kořisti po vyhrané bitvě) i
  při úspěšném zabrání vesnice/hradu (integrační bod: stávající
  strukturní odměna v `0009_structure_card_rewards.sql` — scout drop se
  přidá jako další roll ve stejném již existujícím "roll a přidej bonus
  kartu" bloku, ne jako nový samostatný cron/trigger).
- Karta zvěda se **nikdy nepřenáší mezi hráči jako bojová kořist** (nikdy
  se nenasazuje do boje, takže ji soupeř nemůže "ukrást" výhrou) — jediný
  způsob její ztráty je zabití při průzkumu (viz §3).

## 3. Vysílání zvěda — cestování a instant-peek

### Cestování (nepřátelské/NPC/divoké území)

- Nový `troop_movements.kind = 'scout'`. Zvěd **vždy vyráží z domovského
  území hráče** (ne z libovolného vlastněného území) — nejjednodušší volba,
  odpovídá tomu, že zvěd není bojová jednotka k předsunutí. Konkrétně:
  vybraná karta zvěda musí být v okamžiku vyslání `status = 'stationed'`
  a `stationed_territory_id = <hráčovo domovské území>` (stejná podmínka,
  jakou dnes kontroluje `start_transfer`/`declare_attack` pro vybrané
  karty). Karta je s pohybem svázaná stejnou obecnou tabulkou
  `troop_movement_units (movement_id, card_instance_id)` jako u
  transfer/attack/loan — žádný nový sloupec pro tracking není potřeba.
- `transfer_arrives_at` počítáno stejným vzorcem jako běžné přesuny
  (`_min_group_speed` + existující `transfer_hrs` formule) — se
  speed = 30 vychází na podlahový (nejrychlejší) multiplikátor.
- Po příjezdu (zpracováno uvnitř `resolve_due_movements()`):
  - **Nezávisle** se hodí 20 % šance na zabití. Pokud padne: karta zvěda se
    smaže, vysílajícímu hráči přijde notifikace o zabití/chycení.
  - Pokud má cílové území vlastníka (`owner_id is not null`), **nezávisle**
    se hodí 50 % šance na odhalení. Pokud padne: obránci přijde notifikace
    s identitou vysílajícího hráče. Pokud je cíl divoká (wild,
    `owner_id is null`) posádka, tento roll se přeskočí (není komu
    notifikaci poslat) — pouze roll na zabití zvěda platí beze změny.
  - Pokud zvěd přežil, vytvoří se návratová cesta —
    `kind = 'scout_return'` (stejný vzor jako `loan`/`loan_return`) zpět na
    domovské území, stejná doba jako cesta tam. Na zpáteční cestě už
    žádné riziko nehrozí.
  - Po dojezdu domů (`scout_return` resolved) vznikne/aktualizuje se
    snapshot (§4) a vysílajícímu přijde notifikace o návratu.

### Instant-peek (přicházející útok na mé území)

- Nový `kind = 'scout_peek'` — bez skutečného pohybu (origin = destination
  = domovské území), místo vzdálenosti náhodné zpoždění 1–3 hodiny.
  Odkazuje na sledovaný útok přes nový sloupec
  `troop_movements.scout_target_movement_id` (nullable, FK na
  `troop_movements(id)`). Vybraná karta zvěda se váže stejně jako výše
  přes `troop_movement_units` (i když fyzicky "necestuje", řádek v
  `troop_movements` reprezentuje probíhající misi a udržuje kartu ve
  stavu `in_transit`, takže ji nelze mezitím poslat jinam ani použít).
- Po uplynutí zpoždění se vyhodnotí **stejné dvě nezávislé šance** jako u
  cestování: 20 % zabití (ztráta karty, notifikace mně) a 50 % odhalení
  (notifikace útočníkovi, že jsem odhalil jeho vojska, včetně mé
  identity).
- Pokud zvěd přežije, snapshot vzniká okamžitě (žádná zpáteční cesta).
- **Edge-case — sledovaný útok mezitím zanikl** (dorazil, byl zrušen,
  nebo bitva už proběhla dřív, než uplynulo zpoždění 1–3 h): zabití/
  odhalení rolly se stále vyhodnotí normálně (zvěd byl fyzicky vyslán,
  riziko je nezávislé na osudu sledovaného útoku), ale pokud zvěd přežije,
  **žádný snapshot nevznikne** (mise je zneplatněná, protože cíl už
  neexistuje) — karta zvěda se vrátí do stavu `stationed` na domovském
  území bez vytvoření reportu.

## 4. Snapshot (`scout_reports`) a jeho platnost

Nová tabulka:

```sql
create table scout_reports (
  id bigserial primary key,
  scout_player_id uuid not null references players(id),
  target_territory_id integer references territories(id),
  target_movement_id uuid references troop_movements(id),
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null,
  snapshot jsonb not null
);
```

- `snapshot` obsahuje pole karet přítomných v cíli v okamžiku pořízení:
  `template_id, category, unit_type, rank, name` za každou instanci.
  Zvěd odhaluje **jen jednotkové karty** — cizí **boost karty v cíli
  zůstávají maskované** stejným pravidlem, jaké dnes používá
  `get_visible_territory_cards()` (`is_masked` — jen rank, žádný název).
  Scouting tedy nemění dnešní boost-masking mechaniku, jen doplňuje
  odhalení jednotek o snapshot s expirací.
- Přesně jedna z dvojice `target_territory_id` / `target_movement_id` je
  vyplněná (druhá `null`) — teritoriální průzkum vs. instant-peek na
  pohybující se vojsko.
- **Jen jeden aktuální snapshot** na kombinaci (hráč, cíl) — nový průzkum
  přepíše starý (`ON CONFLICT DO UPDATE`; dva partial unique indexy, jeden
  na `(scout_player_id, target_territory_id) WHERE target_territory_id IS
  NOT NULL`, druhý na `(scout_player_id, target_movement_id) WHERE
  target_movement_id IS NOT NULL`).
- `expires_at = captured_at + interval '10 days'`. Expirované řádky se
  mažou piggyback stylem uvnitř `resolve_due_movements()` (stejný vzor
  jako 30denní retence notifikací v `0056_notifications.sql`).
- V UI: časové razítko ("Zjištěno před 3 dny") + badge platnosti ("vyprší
  za X dní"). Po expiraci se modal automaticky vrátí na bucket-only
  zobrazení.

## 5. UI změny

**Server-side uzavření info-leaku (kritický předpoklad, musí být hotovo
před jakoukoli UI úpravou):**
`get_visible_territory_cards()` se přepracuje tak, aby jednotkové karty
(`category = 'unit'`) cizího vlastníka (`ci.owner_id is distinct from
caller`, s výjimkou koalicí/spojenců, pokud na to existuje zvláštní
pravidlo) vracela **maskované** stejným způsobem, jako dnes maskuje boosty
— tedy jen `rank` (pro bucket UI), žádné `unit_type`/`base_stats`/`name`
— **ledaže** pro volajícího existuje platný (`expires_at > now()`) řádek
v `scout_reports` pro dané `target_territory_id`; v tom případě vrátí
skutečná data z posledního snapshotu (ne živý stav cíle — snapshot je
záměrně statický, viz §4). Toto je jediné místo, které je potřeba změnit
pro `GarrisonModal`/`TerritoryDetailPanel`/`DeclareAttackModal` (všechny
volají stejnou RPC). Bez této změny by UI-only úprava byla kosmeticky
skrytá, ale obejitelná přímým voláním RPC/klientem.

**Bezpečnostní kontrakt `scout_reports`:**
Tabulka má `enable row level security` bez žádných klientských INSERT/
UPDATE/DELETE policies (stejná konvence jako `card_templates`/
`territories` — veřejné `select` pro vlastníka řádku, žádný přímý zápis).
Jediný způsob vzniku/přepisu řádku je uvnitr `security definer` RPC
volaných z `resolve_due_movements()` (cestovní zvěd) nebo z dedikované
`resolve_scout_peek()` (instant-peek) — klient nemůže snapshot podvrhnout
ani přečíst cizí (`scout_player_id = auth.uid()` v `select` policy).

**`TerritoryDetailPanel` / `GarrisonModal` (klik na cizí hráč/NPC/divoké
políčko):**
- Bez platného snapshotu (řešeno už na úrovni RPC výše, ne jen v UI):
  zobrazí se jen bucket rozsahy podle rank (stejná logika jako pipy na
  mapě), např. "6–10 common, 1–5 uncommon".
- Tlačítko **"Vyslat zvěda"** vedle toho, deaktivované pokud hráč nemá
  žádnou kartu zvěda, s počítadlem "(3 ks)" vlastněných karet zvěda.
- Pokud existuje platný snapshot, RPC vrátí skutečné karty a UI je
  zobrazí (jako dnes) + časové razítko + badge platnosti.
- Divoká (wild, `owner_id is null`) posádka: scouting funguje stejně,
  ale detekční notifikace (§3) se logicky nemá komu odeslat — pravidlo:
  pokud cíl nemá vlastníka, roll na odhalení se přeskočí (zbytečný, nemá
  příjemce), roll na zabití zvěda platí beze změny.

**`DeclareAttackModal`:**
- Sekce obránce (`defenderInstances`, přes stejnou
  `get_visible_territory_cards()` RPC) bez platného snapshotu automaticky
  dostane maskovaná data → ukáže jen bucket rozsahy, žádné konkrétní
  karty. Boost karty zůstávají maskované stejně jako dnes bez ohledu na
  scouting (viz §4 — scout odhaluje jen jednotky, ne boosty).
- Tlačítko "Vyslat zvěda" se stejným počítadlem.
- "Poměr sil" (`armyStrength`) přepočítán na odlehčenou verzi: vážený
  součet dle rank (common=1, uncommon=2, rare=3, epic=5, legend=8) s
  hodnotami středů bucketů, pokud není snapshot; s reálnými staty, pokud
  snapshot existuje. **V odlehčeném režimu musí být u hodnoty jasně
  viditelný disclaimer** (např. štítek "⚠ Odhad — neznáš přesná vojska
  nepřítele"), aby nebyl zaměnitelný s přesným výpočtem se snapshotem.

**`MovementDetailModal` (šipka přicházejícího útoku na mě):**
- Beze změny skrývá složení do začátku bitvy (dnešní chování).
- Nově přidává tlačítko "Vyslat zvěda", které spustí instant-peek
  variantu (§3) — po jejím úspěšném vyřešení a přežití zvěda se v tomto
  modalu zobrazí skutečné karty útočícího vojska + časové razítko
  pořízení (ne živý stav — může se lišit, pokud útočník mezitím vojska
  změnil, což u in-transit útoku beztak nejde).

## 6. NPC handling

- NPC nepoužívá scouting mechaniku vůbec — všechny NPC rozhodovací SQL
  funkce (`0027_npc_kingdoms.sql` a další) čtou přímo skutečné staty karet
  z DB, takže NPC "vidí vše" přirozeně už dnes, beze změny.
- Hráč může poslat zvěda na NPC území stejným mechanismem jako proti
  jinému hráči (NPC je jen `players` řádek s `is_npc = true`).
- Při odhalení (50 %) vůči NPC se notifikace zapíše, ale NPC na ni v MVP
  nijak nereaguje (žádná nová AI logika) — vědomé zjednodušení mimo
  rozsah tohoto zadání.

## Mimo rozsah (možné budoucí rozšíření)

- NPC vlastní použití zvěda / reakce na odhalení.
- Craftění/nákup dalších karet zvěda mimo popsané zdroje.
- Historie více snapshotů na stejný cíl (dnes jen "latest wins").
- Zvěd cestující na cizí odchozí (origin) území útočníka namísto
  instant-peek (zamítnuto jako zbytečně nepřímé, viz brainstorming).
- **Viditelnost `scout`/`scout_return`/`scout_peek` pohybů v mapových
  šipkách (`MapMovementArrows`) a v `MyMovementsPanel` sdíleném s
  ostatními hráči:** tyto nové druhy pohybu se **nezobrazují** jako
  veřejné mapové šipky ani cizím hráčům v žádném sdíleném pohledu (to by
  přímo prozradilo probíhající špionáž a obešlo by roll na odhalení).
  Vysílající hráč je vidí jen ve svém vlastním "Moje pohyby" panelu.
  Admin monitor (`admin_list_movements`, kind-agnostic už dnes) je
  zobrazuje beze změny, protože administrátorský přehled musí vidět vše.
