import { Rank, RawStats } from '../cards/types'
import { NationId } from '../players/nations'
import { computeEffectiveStats } from './effectiveStats'

export interface ArmyStrengthCard {
  baseStats: RawStats
  rank: Rank
}

export interface CompareArmyStrengthParams {
  attackerCards: ArmyStrengthCard[]
  defenderCards: ArmyStrengthCard[]
  attackerNation: NationId | null
  defenderNation: NationId | null
  castleRank: Rank | null
  villageRank: Rank | null
  wallRank: Rank | null
}

export type ArmyStrengthLabel = 'strong-advantage' | 'even' | 'risky' | 'disadvantage'

export interface ArmyStrengthResult {
  label: ArmyStrengthLabel
  /** Attacker's share of the combined army strength, in [0, 1]. Exposed for tests/debugging, not shown to the player. */
  ratio: number
}

export type RankBucketCounts = Partial<Record<Rank, number>>

const RANK_WEIGHT: Record<Rank, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 5,
  legend: 8,
}

const BUCKET_MIDPOINTS = [0, 3, 8, 13] as const

/**
 * A single card's overall combat rating: (best attack stat + defense) times
 * durability. Deliberately simple and deterministic — no multi-round
 * Monte Carlo simulation, no randomness, so toggling one card in/out of a
 * selection shifts the result smoothly instead of jumping around.
 */
function cardPower(stats: { str: number; lng: number; def: number; hp: number }): number {
  return (Math.max(stats.str, stats.lng) + stats.def) * stats.hp
}

function totalPower(
  cards: ArmyStrengthCard[],
  opts: {
    isDefendingThisRound: boolean
    castleRank: Rank | null
    villageRank: Rank | null
    wallRank: Rank | null
    nation: NationId | null
  }
): number {
  return cards.reduce((sum, card) => {
    const effective = computeEffectiveStats({
      baseStats: card.baseStats,
      rank: card.rank,
      isDefendingThisRound: opts.isDefendingThisRound,
      castleRank: opts.castleRank,
      villageRank: opts.villageRank,
      wallRank: opts.wallRank,
      ownerNation: opts.nation,
    })
    return sum + cardPower(effective)
  }, 0)
}

/**
 * Compares the attacker's selected cards against the defender's garrison
 * as a simple relative-strength indicator (not a battle-outcome
 * predictor): "do these cards roughly match the defender's army in
 * strength and number?" Replaces the earlier Monte Carlo win-probability
 * preview, which — while faithful to the real multi-round capture-based
 * battle mechanic — amplified even small per-duel disadvantages into
 * near-certain routs (a gambler's-ruin effect), making the preview swing
 * wildly for small changes in the selection.
 */
export function compareArmyStrength(params: CompareArmyStrengthParams): ArmyStrengthResult {
  const attackerPower = totalPower(params.attackerCards, {
    isDefendingThisRound: false,
    castleRank: null,
    villageRank: null,
    wallRank: null,
    nation: params.attackerNation,
  })
  const defenderPower = totalPower(params.defenderCards, {
    isDefendingThisRound: true,
    castleRank: params.castleRank,
    villageRank: params.villageRank,
    wallRank: params.wallRank,
    nation: params.defenderNation,
  })

  if (attackerPower === 0 && defenderPower === 0) return { label: 'even', ratio: 0.5 }
  if (defenderPower === 0) return { label: 'strong-advantage', ratio: 1 }

  const ratio = attackerPower / (attackerPower + defenderPower)
  const label: ArmyStrengthLabel =
    ratio >= 0.6 ? 'strong-advantage' : ratio >= 0.45 ? 'even' : ratio >= 0.3 ? 'risky' : 'disadvantage'

  return { label, ratio }
}

export function compareArmyStrengthLightweight(params: {
  attackerCards: ArmyStrengthCard[]
  defenderBuckets: RankBucketCounts
}): ArmyStrengthResult {
  const attackerPower = totalPower(params.attackerCards, {
    isDefendingThisRound: false,
    castleRank: null,
    villageRank: null,
    wallRank: null,
    nation: null,
  })

  const defenderPower = Object.entries(params.defenderBuckets).reduce((sum, [rank, bucket]) => {
    if (!bucket) return sum
    return sum + RANK_WEIGHT[rank as Rank] * BUCKET_MIDPOINTS[bucket]
  }, 0)

  if (attackerPower === 0 && defenderPower === 0) return { label: 'even', ratio: 0.5 }
  if (defenderPower === 0) return { label: 'strong-advantage', ratio: 1 }

  const ratio = attackerPower / (attackerPower + defenderPower)
  const label: ArmyStrengthLabel =
    ratio >= 0.6 ? 'strong-advantage' : ratio >= 0.45 ? 'even' : ratio >= 0.3 ? 'risky' : 'disadvantage'

  return { label, ratio }
}
