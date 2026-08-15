/**
 * Castle/Village territory bonus stacking — Territory Map spec §7.
 */

import { Rank } from '@/lib/cards/types'

const VILLAGE_DEFENSE_BONUS_PCT: Record<Rank, number> = {
  common: 10,
  uncommon: 20,
  rare: 35,
  epic: 55,
  legend: 80,
}

const CASTLE_DEFENSE_BONUS_PCT: Record<Rank, number> = {
  common: 20,
  uncommon: 35,
  rare: 55,
  epic: 80,
  legend: 120,
}

const CASTLE_ATTACK_BONUS_PCT: Record<Rank, number> = {
  common: 10,
  uncommon: 20,
  rare: 35,
  epic: 55,
  legend: 80,
}

/**
 * Total defense bonus % for a territory, additively stacking a Village's
 * and/or a Castle's rank-based bonus. Either rank may be null (no
 * structure of that category built there yet).
 */
export function combinedDefenseBonusPct(
  castleRank: Rank | null,
  villageRank: Rank | null
): number {
  const castle = castleRank !== null ? CASTLE_DEFENSE_BONUS_PCT[castleRank] : 0
  const village = villageRank !== null ? VILLAGE_DEFENSE_BONUS_PCT[villageRank] : 0
  return castle + village
}

/** Castle-only attack bonus % for defenders (0 if no Castle is built). */
export function castleAttackBonusPct(castleRank: Rank | null): number {
  return castleRank !== null ? CASTLE_ATTACK_BONUS_PCT[castleRank] : 0
}
