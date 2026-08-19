/**
 * Core card domain types for the Card Collection & Combat Core subsystem.
 * See docs/superpowers/specs/2026-08-15-card-collection-combat-core-design.md
 */

export type UnitType =
  | 'archers'
  | 'crossbowmen'
  | 'spearmen'
  | 'swordsmen'
  | 'halberdiers'
  | 'knights'
  | 'lightCavalry'
  | 'siegeEngines'
  | 'settlers'

export const UNIT_TYPES: UnitType[] = [
  'archers',
  'crossbowmen',
  'spearmen',
  'swordsmen',
  'halberdiers',
  'knights',
  'lightCavalry',
  'siegeEngines',
  'settlers',
]

export type Rank = 'common' | 'uncommon' | 'rare' | 'epic' | 'legend'

export const RANKS: Rank[] = ['common', 'uncommon', 'rare', 'epic', 'legend']

export type BoostType = 'territorial' | 'offensive'
export type BoostEffectKind = 'stat_multiplier' | 'instant_effect'
export type InstantEffectKind = 'steal_unit'

/** How many named variants exist per unit type for each rank (spec §6). */
export const VARIANTS_PER_RANK: Record<Rank, number> = {
  common: 10,
  uncommon: 8,
  rare: 6,
  epic: 4,
  legend: 3,
}

/** Inclusive totalSupply range per rank for capped ranks (spec §4). */
export const SUPPLY_RANGE: Record<'rare' | 'epic' | 'legend', [number, number]> = {
  rare: [20, 50],
  epic: [5, 15],
  legend: [1, 5],
}

export interface RawStats {
  str: number
  lng: number
  def: number
  hp: number
  /**
   * Movement-only stat (0-10 scale), NOT scaled by rank and NOT read by
   * combat math (see combat.ts's `applyRank`/`EffectiveCard`, which only
   * pick str/lng/def/hp). Used exclusively by territory movement-time
   * formulas (backlog #12).
   */
  speed: number
}

/**
 * A static catalog entry: one named, ownable-in-principle unit card design.
 * `baseStats` already includes the ±10% flavor variance baked in at
 * authoring time (spec §2, §6) — it is NOT yet rank-scaled.
 */
export interface UnitCardTemplate {
  id: string
  category: 'unit'
  unitType: UnitType
  rank: Rank
  name: string
  flavorText: string
  baseStats: RawStats
  /** null = uncapped (common/uncommon). A positive number for rare/epic/legend. */
  totalSupply: number | null
}

/**
 * A Castle or Village structure card template (Territory Map spec §2.1,
 * §7). Built by burning the card instance onto an owned territory —
 * these never enter combat directly and have no baseStats of their own.
 */
export interface StructureCardTemplate {
  id: string
  category: 'castle' | 'village'
  rank: Rank
  name: string
  flavorText: string
  /** Defense bonus % granted to defenders on the territory (both categories). */
  defenseBonusPct: number
  /** Attack bonus % granted to defenders (castle only; null for village). */
  attackBonusPct: number | null
  /** null = uncapped. A positive number for capped ranks (Territory Map spec §2.1). */
  totalSupply: number | null
}

export interface BoostCardTemplate {
  id: string
  category: 'boost'
  rank: Rank
  name: string
  flavorText: string
  boostType: BoostType
  effectKind: BoostEffectKind
  instantEffectKind: InstantEffectKind | null
  pctStr: number | null
  pctLng: number | null
  pctDef: number | null
  pctHp: number | null
  totalSupply: number | null
}

/**
 * A card template is either a unit (used in combat) or a structure
 * (Castle/Village, built onto a territory). Discriminate on `category`.
 */
export type CardTemplate = UnitCardTemplate | StructureCardTemplate | BoostCardTemplate

/** Narrows a possibly-mixed CardTemplate list down to unit templates only. */
export function isUnitTemplate(template: CardTemplate): template is UnitCardTemplate {
  return template.category === 'unit'
}

export function isBoostTemplate(template: CardTemplate): template is BoostCardTemplate {
  return template.category === 'boost'
}

/**
 * An individual, ownable copy of a CardTemplate. Not used by the demo UI
 * (which has no persistence/accounts) — defined here for forward
 * compatibility with later specs (Players/Territory Map/Battle) per design
 * §2. `stationedTerritoryId`/`status` are populated once card instances are
 * actually persisted (Territory Map spec §2.2); `stationedTerritoryId`
 * matches `territories.id`, a Postgres integer, not a uuid.
 */
export interface CardInstance {
  instanceId: string
  templateId: string
  ownerId: string | null
  stationedTerritoryId: number | null
  status: 'stationed' | 'in_transit'
  mintedAt: string
  mintedBy: 'admin'
}

/** A card's stats after rank scaling — the numbers actually used in combat. */
export interface EffectiveCard {
  str: number
  lng: number
  def: number
  hp: number
}
