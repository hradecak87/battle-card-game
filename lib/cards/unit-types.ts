import { RawStats } from './types'

/**
 * Baseline (unvaried) stats per unit type, 0-10 scale, before rank
 * multiplier and before per-variant flavor variance (spec §5). This is the
 * reference table content authors use as the starting point when authoring
 * catalog-data.json — it is not consumed directly by combat/UI code.
 */
export const UNIT_TYPE_BASELINES: Record<
  import('./types').UnitType,
  { stats: RawStats; role: string }
> = {
  archers: {
    stats: { str: 1, lng: 8, def: 2, hp: 4, speed: 6 },
    role: 'Glass-cannon ranged',
  },
  crossbowmen: {
    stats: { str: 1, lng: 7, def: 5, hp: 4, speed: 4.5 },
    role: 'Slower-firing but better shielded ranged',
  },
  spearmen: {
    stats: { str: 4, lng: 1, def: 7, hp: 5, speed: 5 },
    role: 'Anti-cavalry, strong defense',
  },
  swordsmen: {
    stats: { str: 7, lng: 1, def: 4, hp: 5, speed: 5.5 },
    role: 'Balanced melee striker',
  },
  halberdiers: {
    stats: { str: 6, lng: 1, def: 8, hp: 8, speed: 3.5 },
    role: 'Tank, holds the line',
  },
  knights: {
    stats: { str: 8, lng: 1, def: 5, hp: 7, speed: 7.5 },
    role: 'Heavy melee spearhead',
  },
  lightCavalry: {
    stats: { str: 5, lng: 4, def: 2, hp: 4, speed: 9 },
    role: 'Flexible hybrid, fragile',
  },
  siegeEngines: {
    stats: { str: 0, lng: 10, def: 1, hp: 3, speed: 2 },
    role: 'Extreme ranged, dies to anything in melee',
  },
  settlers: {
    stats: { str: 1, lng: 1, def: 1, hp: 2, speed: 9.5 },
    role: 'Extremely fast nomads for claiming empty land, near-useless in combat',
  },
}
