# Karta Zvěd — design

Datum: 2026-08-22

## Motivace

Dnes hráč (i útočník v `DeclareAttackModal`, i obránce sledující příchozí
útok v `MovementDetailModal`) vidí **přesné karty** soupeřovy posádky/vojska
bez jakékoli akce — pouze na základě toho, že klikl na políčko nebo šipku.
To je nerealistické a odstraňuje motivaci pro průzkum. Cílem je zavést novou
kartu **Zvěd**, kterou je nutné aktivně vyslat, aby hráč zjistil skutečné
složení cizí posádky nebo přicházejícího útoku. Bez vyslání zvěda hráč vidí
jen **hrubé rozsahy počtu karet podle rank** (stejné bucket rozdělení, jaké
dnes pohání pip kuličky na mapě: 1–5 / 6–10 / 11+).

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
  vítězství v boji (hráč vs. hráč/NPC) i při úspěšném zabrání
  vesnice/hradu.
- Karta zvěda se **nikdy nepřenáší mezi hráči jako bojová kořist** (nikdy
  se nenasazuje do boje, takže ji soupeř nemůže "ukrást" výhrou) — jediný
  způsob její ztráty je zabití při průzkumu (viz §3).

## 3. Vysílání zvěda — cestování a instant-peek

### Cestování (nepřátelské/NPC/divoké území)

- Nový `troop_movements.kind = 'scout'`. Zvěd **vždy vyráží z domovského
  území hráče** (ne z libovolného vlastněného území) — nejjednodušší volba,
  odpovídá tomu, že zvěd není bojová jednotka k předsunutí.
- `transfer_arrives_at` počítáno stejným vzorcem jako běžné přesuny
  (`_min_group_speed` + existující `transfer_hrs` formule) — se
  speed = 30 vychází na podlahový (nejrychlejší) multiplikátor.
- Po příjezdu (zpracováno uvnitř `resolve_due_movements()`):
  - **Nezávisle** se hodí 20 % šance na zabití. Pokud padne: karta zvěda se
    smaže, vysílajícímu hráči přijde notifikace o zabití/chycení.
  - **Nezávisle** se hodí 50 % šance na odhalení. Pokud padne: obránci
    přijde notifikace s identitou vysílajícího hráče.
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
  `troop_movements(id)`).
- Po uplynutí zpoždění se vyhodnotí **stejné dvě nezávislé šance** jako u
  cestování: 20 % zabití (ztráta karty, notifikace mně) a 50 % odhalení
  (notifikace útočníkovi, že jsem odhalil jeho vojska, včetně mé
  identity).
- Pokud zvěd přežije, snapshot vzniká okamžitě (žádná zpáteční cesta).

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

- `snapshot` obsahuje pole karet přítomných v cíli v okamžiku pořízení
  (stejná data, jaká dnes `DeclareAttackModal` čte přímo ze
  `card_instances`/`card_templates`): `template_id, category, unit_type,
  rank, name` za každou instanci.
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

**`TerritoryDetailPanel` (klik na cizí/NPC/divoké políčko):**
- Bez platného snapshotu: bucket rozsahy dle rank (stejná logika jako
  mapové pipy), např. "6–10 common, 1–5 uncommon".
- Tlačítko **"Vyslat zvěda"** vedle toho, deaktivované bez vlastněné karty
  zvěda, s počítadlem vlastněných karet zvěda vedle tlačítka.
- S platným snapshotem: skutečné karty (jako dnes) + časové razítko +
  badge platnosti, **místo** bucket rozsahu.

**`DeclareAttackModal`:**
- Sekce obránce bez snapshotu: jen bucket rozsahy, žádné konkrétní karty,
  tlačítko "Vyslat zvěda" + počítadlo.
- "Poměr sil" (`armyStrength`) bez snapshotu přepočítán na odlehčenou
  verzi: vážený součet dle rank (common=1, uncommon=2, rare=3, epic=5,
  legend=8), s hodnotami středů bucketů namísto reálných statů. **Musí
  být jasně označen jako odhad** (např. štítek "⚠ Odhad — neznáš přesná
  vojska nepřítele"), aby nebyl zaměnitelný s přesným výpočtem, který se
  zobrazuje se snapshotem.
- Se snapshotem: zůstává dnešní přesné zobrazení a přesný výpočet poměru
  sil.

**`MovementDetailModal` (šipka přicházejícího útoku na mě):**
- Analogicky obránci — bez snapshotu jen bucket rozsah karet útočníka;
  tlačítko "Vyslat zvěda" spustí instant-peek variantu.

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
