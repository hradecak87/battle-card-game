import { applyRank } from '../cards/combat'
import { EffectiveCard, Rank, RawStats } from '../cards/types'
import { NationId } from '../players/nations'
import {
  castleAttackBonusPct,
  combinedDefenseBonusPct,
  wallRangedBonusPct,
} from '../territories/structureBonus'
import { applyNationCombatPerk } from './nationCombatPerk'

export interface EffectiveStatsInput {
  baseStats: RawStats
  rank: Rank
  isDefendingThisRound: boolean
  castleRank: Rank | null
  villageRank: Rank | null
  wallRank: Rank | null
  /** `null` for an NPC-owned card (no combat perk applied). */
  ownerNation: NationId | null
}

export function computeEffectiveStats(input: EffectiveStatsInput): EffectiveCard {
  let effective: EffectiveCard = applyRank(input.baseStats, input.rank)

  if (input.isDefendingThisRound) {
    const defenseMultiplier =
      1 + combinedDefenseBonusPct(input.castleRank, input.villageRank, input.wallRank) / 100
    effective = {
      ...effective,
      def: effective.def * defenseMultiplier,
    }

    const rangedAttackBonusPct =
      castleAttackBonusPct(input.castleRank) + wallRangedBonusPct(input.wallRank)
    if (rangedAttackBonusPct > 0) {
      const attackMultiplier = 1 + rangedAttackBonusPct / 100
      effective = {
        ...effective,
        str: effective.str * attackMultiplier,
        lng: effective.lng * attackMultiplier,
      }
    }
  }

  return roundEffectiveStats(applyNationCombatPerk(effective, input.ownerNation))
}

function roundEffectiveStats(stats: EffectiveCard): EffectiveCard {
  const round = (value: number) => Math.max(0, Math.round(value))
  return {
    str: round(stats.str),
    lng: round(stats.lng),
    def: round(stats.def),
    hp: round(stats.hp),
  }
}
