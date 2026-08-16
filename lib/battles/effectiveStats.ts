import { applyRank } from '../cards/combat'
import { EffectiveCard, Rank, RawStats } from '../cards/types'
import { NationId } from '../players/nations'
import { castleAttackBonusPct, combinedDefenseBonusPct } from '../territories/structureBonus'
import { applyNationCombatPerk } from './nationCombatPerk'

export interface EffectiveStatsInput {
  baseStats: RawStats
  rank: Rank
  isDefendingThisRound: boolean
  castleRank: Rank | null
  villageRank: Rank | null
  ownerNation: NationId
}

export function computeEffectiveStats(input: EffectiveStatsInput): EffectiveCard {
  let effective: EffectiveCard = applyRank(input.baseStats, input.rank)

  if (input.isDefendingThisRound) {
    const defenseMultiplier =
      1 + combinedDefenseBonusPct(input.castleRank, input.villageRank) / 100
    effective = {
      ...effective,
      def: effective.def * defenseMultiplier,
    }

    if (input.castleRank !== null) {
      const attackMultiplier = 1 + castleAttackBonusPct(input.castleRank) / 100
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
