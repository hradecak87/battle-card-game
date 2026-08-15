# Card Collection & Combat Core — Design Spec

## 1. Overview

This is subsystem #1 of a larger medieval card-battle web game (Battle Card Game V2).
The full game will eventually include player accounts/classes, a 256×256 territory
map, real-time multi-army battles, a card exchange, and notifications — each of
those is an independent spec built on top of this one. This spec covers **only**:

- The card catalog (unit types, ranks, named variants, rarity/supply)
- The 1-vs-1 duel resolution algorithm
- A standalone browser demo (no accounts, no backend/DB, no map) to validate the
  content and combat balance before building anything else

Everything else described in the original game pitch (player classes, XP, map,
RTS battles, trading, notifications) is explicitly out of scope for this spec.

## 2. Card Model

### Card Template (static catalog entry)

```ts
type UnitType =
  | 'archers' | 'crossbowmen' | 'spearmen' | 'swordsmen'
  | 'halberdiers' | 'knights' | 'lightCavalry' | 'siegeEngines'

type Rank = 'common' | 'uncommon' | 'rare' | 'epic' | 'legend'

interface CardTemplate {
  id: string            // stable slug, e.g. "archers-common-03"
  unitType: UnitType
  rank: Rank
  name: string           // honorific name, e.g. "Nejostřejší šípy"
  flavorText: string     // short lore line
  baseStats: { str: number; lng: number; def: number; hp: number } // 1-10 scale,
                          // before rank multiplier; includes this variant's fixed
                          // ±10% flavor variance already baked in
  totalSupply: number | null // fixed cap for rare/epic/legend; null = uncapped
                              // (common/uncommon)
}
```

`effectiveStats = baseStats × rankMultiplier` (see §3). The ±10% flavor variance is
applied once, at content-generation time, and baked into `baseStats` — it is not
re-rolled per instance, so every physical copy of "Nejostřejší šípy" has identical
stats (the variance differentiates *named variants within the same rank*, not
individual copies of the same variant).

### Card Instance (an ownable, individual copy)

```ts
interface CardInstance {
  instanceId: string
  templateId: string
  ownerId: string | null   // null = sits in the unclaimed pool, not yet owned
  mintedAt: string          // ISO timestamp
  mintedBy: 'admin'         // only admins mint new instances (see §4)
}
```

Instances are the unit of ownership and transfer. Battles/trades move
`ownerId` between players; they never duplicate or destroy a `CardInstance`
(consistent with the original game's "cards change hands, they don't get
destroyed" rule).

## 3. Ranks and Scaling

Rank is a **mild multiplier** — it matters, but deliberate matchups/type
counters (per §5) matter more than raw rarity:

| Rank | Multiplier |
|---|---|
| Common | ×1.0 |
| Uncommon | ×1.15 |
| Rare | ×1.35 |
| Epic | ×1.6 |
| Legend | ×2.0 |

Each of the 4 base attributes (`str`, `lng`, `def`, `hp`) is scaled by this
multiplier identically — rank does not favor one attribute over another.

## 4. Rarity / Supply Model

- **Common / Uncommon**: unlimited supply. These are earned freely and form the
  bulk of any player's army; they are never a bottleneck.
- **Rare / Epic / Legend**: fixed total supply (`totalSupply` on the template),
  e.g. Rare ~20-50 copies, Epic ~5-15, Legend ~1-5 (exact numbers set per
  template at content-authoring time, not hardcoded globally).
- **New instances only enter the game via an admin minting action.** There is
  no automatic algorithmic minting. The game reward system (battles, XP
  milestones, daily challenges — designed in later specs) draws from
  already-minted, currently-unclaimed instances (`ownerId === null`); if none
  are available for a given template, that card simply cannot be won until an
  admin mints more (which may be never, for the scarcest legends).
- The collection UI shows `X / totalSupply` for capped ranks (e.g. "2 / 3
  exist") so scarcity is visible and meaningful to players.

This minting mechanism and reward-distribution logic (*how* a battle win
selects and grants an instance) is defined here only at the data-model level;
the actual trigger logic belongs to the Players/XP and Battle specs.

## 5. Unit Types (base stats, 1-10 scale, pre-rank-multiplier)

| Unit Type | STR (melee) | LNG (ranged) | DEF | HP | Role |
|---|---|---|---|---|---|
| Archers (Lučištníci) | 1 | 8 | 2 | 4 | Glass-cannon ranged |
| Crossbowmen (Kušištníci) | 1 | 7 | 5 | 4 | Slower-firing but better shielded ranged |
| Spearmen (Oštěpisté/Kopiníci) | 4 | 1 | 7 | 5 | Anti-cavalry, strong defense |
| Swordsmen (Mečíři) | 7 | 1 | 4 | 5 | Balanced melee striker |
| Halberdiers (Halapartníci) | 6 | 1 | 8 | 8 | Tank, holds the line |
| Knights/Cavalry (Rytíři) | 8 | 1 | 5 | 7 | Heavy melee spearhead |
| Light Cavalry (Lehká jízda) | 5 | 4 | 2 | 4 | Flexible hybrid, fragile |
| Siege Engines (Obléhací stroje) | 0 | 10 | 1 | 3 | Extreme ranged, dies to anything in melee |

## 6. Named Variants & Content Generation

Per unit type, named variants are distributed across ranks as:

| Rank | Variants per type |
|---|---|
| Common | 10 |
| Uncommon | 8 |
| Rare | 6 |
| Epic | 4 |
| Legend | 3 |

Total: 31 variants × 8 unit types = **248 unique card templates**.

Naming follows a "common folk → legendary named individuals" progression per
type (e.g. Archers: common "Práčata", uncommon "Královští střelci", rare
"Sokolí oko", epic "Vlčí luk", legend "Nejostřejší šípy"). Each variant within
a rank gets a fixed ±10% stat variance from the unit type's base stats (see
§2) so same-rank cards aren't stat-identical, plus a unique flavor text line.

The full 248-card list is generated programmatically from this ruleset as a
content data file (`lib/cards/catalog.ts` or a generated JSON) during
implementation — not hand-authored card-by-card in this spec.

## 7. Duel Resolution Algorithm

A single deterministic formula, no round-by-round simulation:

1. Each card attacks with its stronger stat: `atk = max(str, lng)` (using
   effective, rank-scaled stats).
2. Damage rate: `dmg(X→Y) = max(0, atk_X − def_Y)`
3. Time-to-kill: `ttk(X kills Y) = hp_Y / dmg(X→Y)` (infinite if `dmg === 0` —
   the attack can't penetrate defense at all).
4. **Lower TTK wins** — whichever side would kill the other first. This
   naturally produces the desired archer-vs-spearman dynamic: a high-LNG,
   low-DEF archer has a very low TTK against a low-HP melee unit, so it wins
   even though its own STR/DEF are weak — it kills before the melee unit ever
   "closes the distance."
5. **Tie-break**: equal TTK, or both sides' TTK infinite (neither can
   penetrate the other's defense) → the **defender wins** (consistent with
   the tie-break convention from the previous Napoleonic card game).

```ts
function resolveDuel(attacker: EffectiveCard, defender: EffectiveCard): 'attacker' | 'defender' {
  const atkA = Math.max(attacker.str, attacker.lng)
  const atkD = Math.max(defender.str, defender.lng)
  const dmgToDefender = Math.max(0, atkA - defender.def)
  const dmgToAttacker = Math.max(0, atkD - attacker.def)
  const ttkAttackerWins = dmgToDefender > 0 ? defender.hp / dmgToDefender : Infinity
  const ttkDefenderWins = dmgToAttacker > 0 ? attacker.hp / dmgToAttacker : Infinity
  if (ttkAttackerWins < ttkDefenderWins) return 'attacker'
  return 'defender' // covers tie and mutual-infinite cases
}
```

This function is pure and takes no game/army state — it only knows about two
cards' effective stats. It has no notion of "attacker" vs "defender" roles
beyond labeling which side is which; the multi-army battle orchestration
(who's attacking/defending a territory, rest-area cooldowns, round structure)
is out of scope here and belongs to the future Battle spec, which will call
this function once per individual duel.

## 8. Demo Scope (this spec's deliverable)

A Next.js page set with no backend, no accounts, no persistence beyond
`localStorage` (matching the previous project's MVP approach):

- **Collection browser**: list/filter all 248 templates by unit type, rank,
  and rarity; show `X / totalSupply` for capped ranks.
- **Duel arena**: pick any two cards, run `resolveDuel`, and show a
  step-by-step breakdown of the calculation (atk, dmg, ttk for both sides) so
  the reasoning behind the outcome is visible — this is the primary tool for
  validating balance before building the rest of the game.

No authentication, no card ownership/instances persisted per-player in this
demo — the collection browser shows the full catalog, not "my cards" (that
distinction requires accounts, out of scope here).

## 9. Tech Stack

Consistent with the previous Napoleonic card game project:

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS**
- **Jest** for unit tests
- No database, no auth — pure logic modules + `localStorage` for any demo UI
  state (e.g. last-selected cards in the arena)

### Module Boundaries

- `lib/cards/types.ts` — `CardTemplate`, `CardInstance`, `UnitType`, `Rank` types.
- `lib/cards/catalog.ts` — generates the 248 `CardTemplate` entries from the
  unit-type table (§5) and naming/variance rules (§6). Pure, deterministic
  (seeded), no I/O.
- `lib/cards/combat.ts` — `resolveDuel` (§7) and the effective-stats helper
  (`applyRank(baseStats, rank) => effectiveStats`). Pure functions.
- `app/collection/*` — collection browser page, reads `catalog.ts` directly.
- `app/arena/*` — duel arena page, reads `catalog.ts` and calls `combat.ts`.

## 10. Testing Strategy

Jest unit tests in `lib/cards/`:

- Rank multiplier application (all 5 ranks, all 4 attributes scaled correctly).
- `resolveDuel`: decisive wins in both directions, the archer-vs-spearman
  scenario explicitly, zero-damage/infinite-TTK cases, tie-break (equal TTK →
  defender wins, mutual-infinite → defender wins).
- Catalog generation: exactly 248 templates, correct counts per rank per unit
  type, unique IDs/names, `totalSupply` set correctly (null for common/uncommon,
  a positive number for rare/epic/legend).

Light component tests for the collection filter and arena breakdown display;
no e2e tests required for this demo-only deliverable.

## 11. Out of Scope (future specs)

- Player accounts, classes (medieval nation perks), XP/levels, matchmaking.
- Territory map, occupation, castles/villages, troop transfers.
- Multi-army RTS battle orchestration (rest-area cooldowns, attacker/defender
  round structure, timeouts) — will reuse `resolveDuel` from this spec as its
  per-duel building block.
- Card acquisition triggers (which battle/XP events grant a card, and how an
  instance is drawn from the unclaimed pool) and the admin minting tool UI.
- Trading/exchange, notifications, payment gateway for card packs.
