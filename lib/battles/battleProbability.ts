import { Rank, RawStats } from '../cards/types'
import { calculateWinProbability } from '../cards/combat'
import { NationId } from '../players/nations'
import { computeEffectiveStats } from './effectiveStats'

export interface SimCard {
  baseStats: RawStats
  rank: Rank
}

export interface SimulateBattleParams {
  attackerCards: SimCard[]
  defenderCards: SimCard[]
  /** Null for an NPC-owned side (no nation combat perk). */
  attackerNation: NationId | null
  defenderNation: NationId | null
  castleRank: Rank | null
  villageRank: Rank | null
  /** Number of independent battles to simulate. Default 400. */
  trials?: number
  /** Safety cap on rounds per trial to avoid runaway loops. Default 500. */
  maxRoundsPerTrial?: number
}

export interface SimulateBattleResult {
  attackerWinProbability: number
  trials: number
}

interface SimCombatant {
  baseStats: RawStats
  rank: Rank
  side: 'attacker' | 'defender'
  restUntilRound: number
}

/**
 * Estimates the attacker's chance of winning an entire multi-round battle
 * (not just a single duel) via Monte Carlo simulation, mirroring the exact
 * round-resolution rules from `0003_battles.sql`:
 *  - each round, one random non-resting card is drawn per side (matches the
 *    server's `order by random() limit 1`, and the documented auto-pick
 *    fallback for a non-responding defender);
 *  - the loser's card switches sides (capture) rather than being removed;
 *  - both participating cards rest for the next 2 rounds;
 *  - a round is skipped (no combat, rest counters still tick) if either
 *    side has cards left but none currently available;
 *  - a side loses when it owns zero cards.
 *
 * Health does not carry over between rounds — cards that lose a round are
 * captured, not destroyed, so every duel uses fresh effective stats.
 */
export function simulateAttackerWinProbability(params: SimulateBattleParams): SimulateBattleResult {
  const trials = params.trials ?? 400
  const maxRounds = params.maxRoundsPerTrial ?? 500

  if (params.attackerCards.length === 0) return { attackerWinProbability: 0, trials }
  if (params.defenderCards.length === 0) return { attackerWinProbability: 1, trials }

  let attackerWins = 0

  for (let t = 0; t < trials; t += 1) {
    if (runOneTrial(params, maxRounds)) attackerWins += 1
  }

  return { attackerWinProbability: attackerWins / trials, trials }
}

function runOneTrial(params: SimulateBattleParams, maxRounds: number): boolean {
  const combatants: SimCombatant[] = [
    ...params.attackerCards.map((c) => toCombatant(c, 'attacker')),
    ...params.defenderCards.map((c) => toCombatant(c, 'defender')),
  ]

  for (let round = 1; round <= maxRounds; round += 1) {
    const attackerCards = combatants.filter((c) => c.side === 'attacker')
    const defenderCards = combatants.filter((c) => c.side === 'defender')

    if (attackerCards.length === 0) return false
    if (defenderCards.length === 0) return true

    const availableAttacker = attackerCards.filter((c) => c.restUntilRound < round)
    const availableDefender = defenderCards.filter((c) => c.restUntilRound < round)

    if (availableAttacker.length === 0 || availableDefender.length === 0) {
      continue // round skipped, rest counters keep ticking via the round increment
    }

    const attackerCard = pickRandom(availableAttacker)
    const defenderCard = pickRandom(availableDefender)

    const atkEff = computeEffectiveStats({
      baseStats: attackerCard.baseStats,
      rank: attackerCard.rank,
      isDefendingThisRound: false,
      castleRank: null,
      villageRank: null,
      ownerNation: params.attackerNation,
    })
    const defEff = computeEffectiveStats({
      baseStats: defenderCard.baseStats,
      rank: defenderCard.rank,
      isDefendingThisRound: true,
      castleRank: params.castleRank,
      villageRank: params.villageRank,
      ownerNation: params.defenderNation,
    })

    const { attackerWinProbability } = calculateWinProbability(atkEff, defEff)
    const attackerWonRound = Math.random() < attackerWinProbability

    const loser = attackerWonRound ? defenderCard : attackerCard
    loser.side = attackerWonRound ? 'attacker' : 'defender'
    attackerCard.restUntilRound = round + 2
    defenderCard.restUntilRound = round + 2
  }

  // Safety cap reached: treat as inconclusive/attacker-loss to keep the
  // estimate conservative rather than looping forever on near-50/50 stalemates.
  return false
}

function toCombatant(card: SimCard, side: 'attacker' | 'defender'): SimCombatant {
  return { baseStats: card.baseStats, rank: card.rank, restUntilRound: -1, side }
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}
