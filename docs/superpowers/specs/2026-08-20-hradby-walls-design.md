# Hradby (Walls) — stavební karta, design

## Kontext

Území v mapě aktuálně mohou mít dvě nezávislé stavby: **Hrad** (`castle_rank`,
defense + ranged-attack bonus pro obránce) a **Vesnice** (`village_rank`,
pouze defense bonus). Obě mohou být na jednom území současně, jejich bonusy
se sčítají (`combinedDefenseBonusPct()` v `lib/territories/structureBonus.ts`).
Stavba je okamžitá (žádný časovač) — `build_structure()` RPC spálí kartu a
nastaví příslušný `_rank` sloupec.

Tento dokument popisuje třetí stavební kartu, **Hradby**, jako *alternativu*
k Hradu+Vesnici (ne doplněk).

## Cíl

Přidat kartu Hradby, která:
- nabízí kombinovaný defense + ranged-defense bonus (jako menší, levnější
  náhrada za hrad+vesnici dohromady),
- je vzájemně výlučná s Hradem i Vesnicí na stejném území,
- má vlastní grafiku na mapě i ve sbírce karet (`hradby.png`, dodá uživatel),
- se získává stejnými kanály jako hrad/vesnice (level milestone, 1% bitevní
  bonus), ale **ne** ve startovním balíčku,
- staví se prozatím okamžitě (doba výstavby je samostatná budoucí položka
  `structure-build-duration`, řešená společně pro všechny 3 stavby).

## 1. Datový model

### `territories.wall_rank`
Nový sloupec, stejný typ (`rank` enum / text) a nullable jako `castle_rank`
a `village_rank`.

### `card_templates`
5 nových řádků, `id` = `wall-<rank>`, `category = 'wall'`:

| rank | defense_bonus_pct | attack_bonus_pct |
|------|-------------------|------------------|
| common | 5 | 5 |
| uncommon | 10 | 10 |
| rare | 17 | 17 |
| epic | 27 | 27 |
| legend | 40 | 40 |

(Polovina hodnot Vesnice, zaokrouhleno; stejné číslo se použije jak pro
defense, tak pro ranged-defense bonus — analogicky k tomu, jak Hrad používá
`defense_bonus_pct` i `attack_bonus_pct`.)

### CHECK constrainty
- `card_templates_category_check`: rozšířit o `'wall'`.
- Existující constrainty vázané na `category in ('castle','village')` pro
  `defense_bonus_pct`/`attack_bonus_pct` rozšířit tak, aby `'wall'` také
  vyžadovala oba sloupce vyplněné (stejně jako Hrad).
- Nový constraint na `territories`: `wall_rank is null or (castle_rank is
  null and village_rank is null)` a obráceně `(castle_rank is null and
  village_rank is null) or wall_rank is null` — v praxi jde o jediný
  constraint vynucující vzájemnou výlučnost.

## 2. Backend — `build_structure()` RPC

Přidat validace (vedle existující "slot už je obsazen" kontroly):
- Stavba `castle`/`village` na území, kde `wall_rank is not null` → chyba.
- Stavba `wall` na území, kde `castle_rank is not null or village_rank is
  not null` → chyba.

Stavba zůstává okamžitá (bez časovače) — beze změny oproti současnému
chování Hradu/Vesnice.

## 3. Backend — odměny (`_finalize_battle()`)

- **Level-milestone odměna** (každých 5 levelů) a **1% bitevní bonus**:
  rozšířit náhodný výběr z `castle`/`village` (50/50) na `castle`/`village`/
  `wall` (1/3 každá), common rank.
- **Startovní balíček** (`complete_kingdom_onboarding()`): beze změny — jen
  1× castle-common + 1× village-common, žádná Hradby karta.

## 4. Bonus výpočet — `lib/territories/structureBonus.ts`

```ts
const WALL_BONUS_PCT: Record<Rank, number> = {
  common: 5, uncommon: 10, rare: 17, epic: 27, legend: 40,
}

export function combinedDefenseBonusPct(
  castleRank: Rank | null,
  villageRank: Rank | null,
  wallRank: Rank | null = null,
): number {
  const castle = castleRank !== null ? CASTLE_DEFENSE_BONUS_PCT[castleRank] : 0
  const village = villageRank !== null ? VILLAGE_DEFENSE_BONUS_PCT[villageRank] : 0
  const wall = wallRank !== null ? WALL_BONUS_PCT[wallRank] : 0
  return castle + village + wall
}

export function wallRangedBonusPct(wallRank: Rank | null): number {
  return wallRank !== null ? WALL_BONUS_PCT[wallRank] : 0
}
```

Díky vzájemné výlučnosti nikdy nenastane situace, kdy by se sčítal
`wallRank` s `castleRank`/`villageRank` současně — parametr je přidán čistě
kvůli jednotnému volání ze všech míst, která dnes volají
`combinedDefenseBonusPct(castleRank, villageRank)`.

## 5. Frontend — mapa

Nový `WallIcon` v `components/territories/icons/StructureIcons.tsx`, postavený
na stejném `StructureImg` vzoru jako nedávno přidaný `HomeIcon` — statická
grafika `/icons/structures/wall.png` (odvozeno z dodaného `hradby.png`), bez
rank-variant. Zobrazí se na políčku v `MapViewport.tsx`, pokud má území
`wall_rank` vyplněný (vzájemně se vylučuje s ikonou hradu/vesnice).

## 6. Frontend — sbírka karet (/collection)

Karta Hradby dostane ilustraci `hradby.png` (na rozdíl od Hradu/Vesnice, které
zůstávají u prosté textové dlaždice beze změny). Přidá se nová dlaždice
specificky pro `category === 'wall'` v `app/collection/page.tsx`, vizuálně
konzistentní s `TradingCard`/`BoostCardTile` vzorem (obrázek + rank rámeček).

## 7. Frontend — zobrazení na území

- **`GarrisonModal.tsx`**, **`TerritoryDetailPanel.tsx`**: přidat řádek
  `Hradby: <rank>` vedle `Hrad:`/`Vesnice:` (v praxi se vždy zobrazí jen
  jeden z těchto řádků/dvojice řádků díky výlučnosti).
- **`GarrisonModal.tsx`** stavební tlačítka: tlačítko "Postavit Hradby" se
  zobrazí jen když území nemá ani hrad, ani vesnici; tlačítka "Postavit
  Hrad"/"Postavit Vesnici" se skryjí, pokud území má Hradby.
- **`DeclareAttackModal.tsx`**: bonusový přehled rozšířit o
  `wallDefenseBonus`/`wallRangedBonus`, sečtené do `totalDefenseBonus`
  (analogicky k současným `castleDefenseBonus`/`castleAttackBonus`/
  `villageDefenseBonus`).

## 8. Testování

- Unit testy `structureBonus.ts`: nová `WALL_BONUS_PCT` tabulka, rozšířený
  `combinedDefenseBonusPct()` se 3 parametry, nová `wallRangedBonusPct()`.
- SQL verification testy pro rozšířený `build_structure()` (výlučnost hrad/
  vesnice vs. hradby) a rozšířenou `_finalize_battle()` odměnovou logiku
  (1/3 rozdělení místo 50/50).
- UI testy: nové řádky/ikony/tlačítka v `GarrisonModal`, `TerritoryDetailPanel`,
  `DeclareAttackModal`, `MapViewport` (nová `WallIcon`), `collection` stránka
  (nová ilustrovaná dlaždice).

## Mimo scope (řešeno později)

- Doba výstavby (`structure-build-duration` — společně pro Hrad, Vesnici i
  Hradby).
- Bourání staveb (aby šlo přejít z Hrad+Vesnice na Hradby a naopak).
- Nákup/výměna karet v tržišti (obecná budoucí mechanika, netýká se jen
  Hradeb).
