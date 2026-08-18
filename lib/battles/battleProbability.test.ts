import { simulateAttackerWinProbability } from './battleProbability'
import { RawStats } from '../cards/types'

const weak: RawStats = { str: 5, lng: 5, def: 5, hp: 20 }
const strong: RawStats = { str: 40, lng: 40, def: 40, hp: 200 }

describe('simulateAttackerWinProbability', () => {
  it('returns 0 when the attacker has no cards', () => {
    const result = simulateAttackerWinProbability({
      attackerCards: [],
      defenderCards: [{ baseStats: weak, rank: 'common' }],
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: null,
    })
    expect(result.attackerWinProbability).toBe(0)
  })

  it('returns 1 when the defender has no cards', () => {
    const result = simulateAttackerWinProbability({
      attackerCards: [{ baseStats: weak, rank: 'common' }],
      defenderCards: [],
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: null,
    })
    expect(result.attackerWinProbability).toBe(1)
  })

  it('gives an overwhelming attacker a high win probability', () => {
    const result = simulateAttackerWinProbability({
      attackerCards: Array.from({ length: 10 }, () => ({ baseStats: strong, rank: 'legend' as const })),
      defenderCards: [{ baseStats: weak, rank: 'common' }],
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: null,
      trials: 200,
    })
    expect(result.attackerWinProbability).toBeGreaterThan(0.9)
  })

  it('gives an overwhelming defender a low attacker win probability, even with castle/village bonuses', () => {
    const result = simulateAttackerWinProbability({
      attackerCards: [{ baseStats: weak, rank: 'common' }],
      defenderCards: Array.from({ length: 10 }, () => ({ baseStats: strong, rank: 'legend' as const })),
      attackerNation: null,
      defenderNation: null,
      castleRank: 'legend',
      villageRank: 'legend',
      trials: 200,
    })
    expect(result.attackerWinProbability).toBeLessThan(0.1)
  })

  it('produces a roughly balanced probability for evenly matched single-card sides', () => {
    // str > def so real (non-zero) damage flows both ways; identical stats
    // on both sides should land the win probability near 50%.
    const even: RawStats = { str: 30, lng: 10, def: 15, hp: 50 }
    const result = simulateAttackerWinProbability({
      attackerCards: [{ baseStats: even, rank: 'common' }],
      defenderCards: [{ baseStats: even, rank: 'common' }],
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: null,
      trials: 300,
    })
    expect(result.attackerWinProbability).toBeGreaterThan(0.35)
    expect(result.attackerWinProbability).toBeLessThan(0.65)
  })
})
