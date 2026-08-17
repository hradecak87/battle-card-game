import { EffectiveCard, Rank, RawStats } from './types'

/** Rank multiplier applied identically to all 4 attributes (spec §3). */
export const RANK_MULTIPLIER: Record<Rank, number> = {
  common: 1.0,
  uncommon: 1.15,
  rare: 1.35,
  epic: 1.6,
  legend: 2.0,
}

/**
 * Applies a card's rank multiplier to its base stats, rounding each
 * attribute to the nearest integer and clamping to a minimum of 0
 * (spec §3, §6).
 */
export function applyRank(baseStats: RawStats, rank: Rank): EffectiveCard {
  const multiplier = RANK_MULTIPLIER[rank]
  const scale = (value: number) => Math.max(0, Math.round(value * multiplier))
  return {
    str: scale(baseStats.str),
    lng: scale(baseStats.lng),
    def: scale(baseStats.def),
    hp: scale(baseStats.hp),
  }
}

export type DuelWinner = 'attacker' | 'defender'

export interface DuelBreakdown {
  winner: DuelWinner
  attacker: { atk: number; dmgDealt: number; ttk: number }
  defender: { atk: number; dmgDealt: number; ttk: number }
}

export interface DuelWinProbability {
  attackerWinProbability: number
  deterministicWinner: DuelWinner
}

/**
 * Resolves a 1v1 duel between two already rank-scaled cards using the
 * time-to-kill formula from spec §7. Pure function — no game/army state.
 */
export function resolveDuel(attacker: EffectiveCard, defender: EffectiveCard): DuelWinner {
  return resolveDuelWithBreakdown(attacker, defender).winner
}

/**
 * Same resolution as `resolveDuel`, but also returns the intermediate
 * atk/dmg/ttk values for both sides so UI (e.g. the duel arena) can display
 * the reasoning behind the outcome (spec §8).
 */
export function resolveDuelWithBreakdown(
  attacker: EffectiveCard,
  defender: EffectiveCard
): DuelBreakdown {
  const atkA = Math.max(attacker.str, attacker.lng)
  const atkD = Math.max(defender.str, defender.lng)

  const dmgToDefender = Math.max(0, atkA - defender.def)
  const dmgToAttacker = Math.max(0, atkD - attacker.def)

  const ttkAttackerWins = dmgToDefender > 0 ? defender.hp / dmgToDefender : Infinity
  const ttkDefenderWins = dmgToAttacker > 0 ? attacker.hp / dmgToAttacker : Infinity

  // Lower TTK wins; exact ties and mutual-infinite stalemates favor the
  // defender (spec §7 step 5).
  const winner: DuelWinner = ttkAttackerWins < ttkDefenderWins ? 'attacker' : 'defender'

  return {
    winner,
    attacker: { atk: atkA, dmgDealt: dmgToDefender, ttk: ttkAttackerWins },
    defender: { atk: atkD, dmgDealt: dmgToAttacker, ttk: ttkDefenderWins },
  }
}

/**
 * Converts the deterministic duel breakdown into a bounded attacker win
 * chance for probabilistic round resolution. Uses the reciprocal-TTK rate
 * form (`damage / enemyHp`) to avoid Infinity arithmetic, then rescales the
 * raw ratio into the closed [3%, 97%] band so even huge mismatches still
 * leave a tiny upset chance while stalemates remain defender-favored.
 */
export function calculateWinProbability(
  attacker: EffectiveCard,
  defender: EffectiveCard
): DuelWinProbability {
  const breakdown = resolveDuelWithBreakdown(attacker, defender)
  const rateAttacker = breakdown.attacker.dmgDealt > 0 ? breakdown.attacker.dmgDealt / defender.hp : 0
  const rateDefender = breakdown.defender.dmgDealt > 0 ? breakdown.defender.dmgDealt / attacker.hp : 0

  if (rateAttacker === 0 && rateDefender === 0) {
    return {
      attackerWinProbability: 0.03,
      deterministicWinner: breakdown.winner,
    }
  }

  const raw = rateAttacker / (rateAttacker + rateDefender)
  return {
    attackerWinProbability: 0.03 + raw * 0.94,
    deterministicWinner: breakdown.winner,
  }
}
