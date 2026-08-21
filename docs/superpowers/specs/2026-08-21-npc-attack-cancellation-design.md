# Zrušení NPC útoku při posílení obránce — design (backlog: npc-attack-cancellation)

## Přehled
NPC útočníci dnes jednou vyšlou vojsko a bez ohledu na to, jak moc se
mezitím posílí obrana cíle (posádka + příchozí posily), útok vždy
dorazí a svede bitvu. Cílem je, aby NPC pravidelně přehodnocovalo
rozestavěné útoky a v případě, že se jeho šance na úspěch výrazně
propadnou, vojsko stáhlo zpět — stejně jako by to udělal racionální
hráč.

Žádný cron/scheduled job — stejný "líný" (lazy) vzor jako zbytek NPC
logiky (`resolve_due_npc_actions()`, `resolve_due_npc_diplomacy()`),
ale navržený tak, aby šel v budoucnu 1:1 přepnout na `pg_cron`/edge
function bez změny volajících míst ani chování.

## Model pravděpodobnosti výhry
Boj v systému je reálná simulace souboj-po-souboji, ne pravděpodobnostní
model — pro účely rozhodování NPC ale zavádíme jednoduchý odhad:

```
P(výhra útočníka) = útočná_síla / (útočná_síla + obranná_síla)
```

Stávající práh pro **zahájení** útoku (`NPC_ATTACK_POWER_RATIO = 1.2`,
tj. `útočná_síla >= 1.2 × obranná_síla`) odpovídá `P ≈ 54.5 %`.

Nový práh pro **zrušení** rozestavěného útoku: `P < 45 %`. Přepočet na
poměr sil (odvozeno z výše uvedeného vzorce):

```
obranná_síla > (11 / 9) × útočná_síla   (≈ 1.222×)
```

`NPC_ATTACK_CANCEL_RATIO = 11/9` — nová pojmenovaná konstanta vedle
stávající `NPC_ATTACK_POWER_RATIO` v `lib/npc/kingdoms.ts`.

## Datový model
- `troop_movements.npc_reeval_at timestamptz null` — kdy se má tento
  konkrétní (NPC) útok příště přehodnotit. `null` pro všechny pohyby,
  které nejsou NPC útokem. Nastaví se na `now() + interval '30 minutes'`
  při vzniku NPC útoku (`_declare_attack_core` volaná z
  `resolve_due_npc_actions()`), a znovu posune o dalších 30 minut po
  každém přehodnocení, které útok nezruší.
- Index `troop_movements (npc_reeval_at) where status = 'in_transit'`
  pro efektivní výběr due řádků (analogie `troop_movements_due_idx`).

## Líné vyhodnocení — `resolve_due_npc_attack_reevaluations()`
Nová samostatná funkce (vlastní "smyčka", ne přilepená do
`resolve_due_npc_actions()`), volaná z těla `resolve_due_movements()`
vedle stávajících `perform resolve_due_npc_actions();` /
`perform resolve_due_npc_diplomacy();`. Izolace do vlastní funkce je
záměrná — do budoucna půjde kterákoli NPC smyčka samostatně nahradit
`pg_cron`/edge function tahem, beze změny těch ostatních.

Pro každý řádek `troop_movements` kde `kind = 'attack'`,
`status = 'in_transit'`, útočník (`player_id`) má `players.is_npc = true`
a `npc_reeval_at <= now()`:

1. **Útočná síla** — součet efektivních statů (`hp+str+lng+def` přes
   `_compute_effective_stats`, `p_is_defender = false`, žádný
   castle/village/wall bonus) karet z `troop_movement_units` daného
   pohybu. Nový sdílený SQL helper (např.
   `_movement_unit_power(p_movement_id uuid, p_is_defender boolean,
   p_territory_id integer default null)`), protože karty na cestě mají
   `status = 'in_transit'` a nejdou spočítat přes stávající
   `_territory_effective_unit_power` (ta čte jen `status = 'stationed'`
   karty na konkrétním území).
2. **Obranná síla cíle** = `_territory_effective_unit_power(cíl_owner,
   cíl_territory_id, true)` (aktuální posádka, beze změny) **+** součet
   `_movement_unit_power(...)` přes všechny `troop_movements` s
   `kind = 'transfer'`, `status = 'in_transit'`,
   `destination_territory_id = cíl`, `transfer_arrives_at <=`
   přehodnocovaný NPC útok `transfer_arrives_at` (posily, co stihnou
   dorazit dřív než NPC).
3. Pokud `obranná_síla > NPC_ATTACK_CANCEL_RATIO × útočná_síla` →
   **zrušit útok** (viz níže). Jinak posunout
   `npc_reeval_at := now() + interval '30 minutes'`.

Cíl mezitím mohl změnit vlastníka, zaniknout jako aktivní (bitva se
mezitím rozhodla dřív, útok byl mezitím recallnut hráčem-obráncem
apod.) — v takovém případě (`status <> 'in_transit'`) řádek prostě
přeskočit; žádná speciální ošetření navíc nejsou potřeba, `for update`
zámek na řádku řeší souběh se zbytkem `resolve_due_movements()`.

Vědomá zjednodušení (accepted tradeoffs, ne opomenutí):
- Diplomacie (koalice/NAP) mezi vysláním a přehodnocením se neřeší —
  přehodnocení posuzuje čistě poměr sil, nic víc.
- NPC útoky vždy jedou bez boost karty (`boost_card_instance_id = null`
  dle `_declare_attack_core` volání v `resolve_due_npc_actions`), takže
  nový helper na sílu pohybu tento sloupec ignoruje.
- Posila, která dorazí po posledním 30min tiku, ale ještě před NPC
  útočníkem, se do přehodnocení promítne až při příštím tiku (nebo
  vůbec, pokud NPC útočník dorazí dřív) — přijatelná nepřesnost.
- Chybu/výjimku u jednoho řádku je třeba odchytit (`exception when
  others`, stejný vzor jako `resolve_due_npc_actions`), aby nespadla
  celá transakce `resolve_due_movements()`.

## Zrušení útoku — `_recall_attack_core`
Extrahovat tělo stávající `recall_attack(p_movement_id uuid)` (RPC
gated `auth.uid()`) do `_recall_attack_core(p_movement_id uuid,
p_caller uuid)`. **Bootstrap volání `perform resolve_due_movements();
perform resolve_due_battles();` zůstávají jen ve veřejném `recall_attack`
wrapperu, do `_core` se nekopírují** — jinak by přehodnocení volané
zevnitř `resolve_due_movements()` způsobilo rekurzivní re-entry (stejný
vzor jako `_declare_attack_core`, který tato volání také nemá). Veřejné
`recall_attack` pak jen ověří `auth.uid()` a deleguje na `_core`. NPC
přehodnocení volá `_core` přímo s NPC's `id` jako `p_caller` — beze
změny chování pro reálné hráče. Recall beze změny: vojsko se vrátí jako
`transfer` do původního (původních) území, movement se označí
`cancelled`, `battle_locked_by` na cíli se uvolní.

## Notifikace obránci
- Nový typ `notifications.type = 'attack_cancelled'` (rozšíření
  existujícího `check` constraintu), payload: `territory_id`,
  `territory_x`, `territory_y`, `territory_name`, `attacker_display_name`
  (NPC jméno říše). Zobrazí se v existujícím zvonečku
  (`list_notifications`/`NotificationBell`) obránci.
- Pro mapu/world-feed se znovu použije stávající `attack_recalled`
  world-event (žádná nová hodnota `event_type` potřeba — payload i
  vykreslení ve `WorldEventsFeed` už dnes fungují nezávisle na tom, zda
  je útočník NPC nebo hráč).

## Mimo scope (vědomě)
- Žádné jiné NPC chování se nemění (stále nestaví, neobchoduje,
  nepoužívá diplomacii nad rámec stávající `resolve_due_npc_diplomacy`).
- Koaliční půjčování vojsk / sdílená viditelnost transferů (budoucí
  fáze coalitions) do výpočtu obranné síly nevstupuje — počítají se jen
  posily od vlastníka cíle samotného.
- Žádné UI k ručnímu "sledování" pravděpodobnosti pro hráče — jde čistě
  o NPC rozhodovací logiku na pozadí.

## Testování
- Čisté TS helpery v `lib/npc/kingdoms.ts`
  (`attackerWinProbability(attackerPower, defenderPower)`,
  `shouldNpcCancelAttack(attackerPower, defenderPower)` s konstantou
  `NPC_ATTACK_CANCEL_RATIO`), analogicky stávajícím
  `canNpcAttackTarget`/`NPC_ATTACK_POWER_RATIO` — jednotkové testy na
  hraniční hodnoty (přesně na prahu, těsně nad/pod).
- SQL verifikační skript (stejný vzor jako `0048`/`0050`
  verification.sql, rollback-wrapped) pokrývající: NPC útok se zruší,
  když posila dorazí včas a sníží šanci pod 45 %; NPC útok se **ne**zruší,
  když posila dorazí až po NPC útočníkovi; `npc_reeval_at` se posune o
  30 minut, když ke zrušení nedojde; notifikace `attack_cancelled` a
  world-event `attack_recalled` vzniknou při zrušení; regresní test, že
  `recall_attack` (hráčská RPC) funguje beze změny.
