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

export const UNIT_TYPES: UnitType[] = [
  'archers',
  'crossbowmen',
  'spearmen',
  'swordsmen',
  'halberdiers',
  'knights',
  'lightCavalry',
  'siegeEngines',
]

export type Rank = 'common' | 'uncommon' | 'rare' | 'epic' | 'legend'

export const RANKS: Rank[] = ['common', 'uncommon', 'rare', 'epic', 'legend']

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
}

/**
 * A static catalog entry: one named, ownable-in-principle card design.
 * `baseStats` already includes the ±10% flavor variance baked in at
 * authoring time (spec §2, §6) — it is NOT yet rank-scaled.
 */
export interface CardTemplate {
  id: string
  unitType: UnitType
  rank: Rank
  name: string
  flavorText: string
  baseStats: RawStats
  /** null = uncapped (common/uncommon). A positive number for rare/epic/legend. */
  totalSupply: number | null
}

/**
 * An individual, ownable copy of a CardTemplate. Not used by the demo UI
 * (which has no persistence/accounts) — defined here for forward
 * compatibility with later specs (Players/Battle) per design §2.
 */
export interface CardInstance {
  instanceId: string
  templateId: string
  ownerId: string | null
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
