# Autonomní NPC říše — design (backlog: npc-autonomous-behavior)

## Přehled
6 NPC "říší" (po jedné z každého ze 6 středověkých národů) se chovají jako
skuteční hráči: mají domov, armádu, level/XP, a autonomně expandují do
prázdných území a útočí na slabší sousedy. Žádný cron/scheduled job —
stejný "líný" (lazy) vzor jako zbytek hry (`resolve_due_movements()`,
`resolve_due_battles()`).

## Datový model
- `players.is_npc boolean not null default false`.
- `players.npc_next_action_at timestamptz null` — kdy říše provede další
  tah; null pro reálné hráče.
- Protože `players.id` má FK na `auth.users`, seeding NPC vyžaduje i
  odpovídající `auth.users` řádek (service-role admin API, fiktivní e-mail
  `npc-<nation>@system.internal`, náhodné heslo, bez reálného přihlášení).

## Seeding (jednorázový skript, analogie `seed-card-templates.ts`)
`scripts/seed-npc-kingdoms.ts` — vstup: pole národů (default všech 6).
Pro každý:
1. `auth.admin.createUser()` → nový `auth.users` řádek.
2. Insert do `players` (`is_npc=true`, `nation`, `kingdom_name` dle národa,
   `coat_of_arms_id`, `npc_next_action_at = now()`).
3. Reuse logiky z `complete_kingdom_onboarding` pro výběr domova (prázdné
   území, obtížnost ≤ 2, nejdál od existujících domovů) a startovní
   armádu (6 common jednotek).
Parametrizované, takže přidání další říše později = další spuštění se
zbývajícím národem/nároky.

## Líné vyhodnocení tahů
Nová funkce `resolve_due_npc_actions()`, volaná z těla stávající
`resolve_due_movements()` (tedy efektivně na začátku většiny RPC volání,
beze změny volajících míst). Pro každou `players` řádku s `is_npc=true`
a `npc_next_action_at <= now()`:
1. Vybere přesně jeden tah (viz níže).
2. Provede ho přes interní `_core` variantu příslušné RPC (viz dále).
3. Nastaví `npc_next_action_at = now() + (4 + random()*8) * interval '1 hour'`
   (rovnoměrně 4–12 h), bez ohledu na to, zda tah uspěl/byl idle.

## Výběr tahu (mixed agresivita)
1. Pokud říše vlastní < 32 území: najdi kandidáty na expanzi — neobsazená
   území (`owner_id is null`, `claim_locked_by is null`) v dosahu od
   libovolného vlastněného území říše (reuse existující reachability
   logiky z `declare_attack`/`start_claim`).
2. Najdi kandidáty na útok — území jiného hráče (člověk i NPC) v dosahu,
   kde odhad síly obránce (součet efektivních statů posádky) je nižší než
   práh vůči dostupné útočné síle NPC.
3. Váhy: pokud existuje expanzní kandidát, 70 % šance ho zvolit; jinak
   (nebo zbylých 30 %) zkusí útok, pokud existuje kvalifikovaný cíl.
   Pokud nic nekvalifikuje → idle (jen se přeplánuje další tik).
4. Pro útok: NPC pošle všechny neodpočívající jednotky z nejbližšího
   vlastněného území k cíli (zjednodušení pro MVP — žádný výběr částí
   posádky).

## Provedení tahu — `_core` refaktor
`start_claim`/`declare_attack` dnes berou volajícího z `auth.uid()`.
Vytáhnout jejich tělo do `_start_claim_core(p_caller uuid, ...)` /
`_declare_attack_core(p_caller uuid, ...)`, veřejné RPC pak jen
`auth.uid()` → delegace na `_core`. NPC tah volá `_core` přímo s NPC's
`id` jako `p_caller` (bez `auth.uid()` gating) — beze změny business
logiky.

## NPC jako obránce
Rozšířit stávající `defender_id is null` auto-resolve větev (bitva se
vyřeší okamžitě bez čekání na "ready", výběr obránce přes existující
`pickNpcDefenderCard`) i na `defender is_npc = true`. Battle-resolution
kód jinak beze změny.

## Odměny
Beze změny — existující logika odměn (XP, karty, 20% boost drop) už dnes
negeneruje na typu obránce, takže NPC při vítězné obraně automaticky
levelují a dostávají odměny stejně jako hráč.

## Vizuál
`is_npc` se přidá do odpovědi map/territory RPC. Mapa zobrazí NPC území
vlastní barvou/ikonou (odlišnou od "moje"/"cizí hráč"). Profil NPC hráče
zobrazí štítek "NPC" místo online/offline stavu.

## Mimo scope (vědomě, budoucí iterace)
NPC nestaví stavby, nepoužívá boost karty, neobchoduje, nepřesouvá domov
(King), neruší vlastní probíhající útoky. Nemá vlastní diplomacii/chat.

## Testování
Čistě SQL/logická vrstva (cíl-výběr jako pure/testovatelná funkce
analogicky `pickNpcDefenderCard`, tick scheduling, `_core` refaktor beze
změny chování pro reálné hráče — regresní testy na existujících
`declare_attack`/`start_claim` testech musí projít beze změny). UI:
testy na barvu/ikonu NPC území a "NPC" štítek v profilu.
