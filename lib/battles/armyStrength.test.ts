import { compareArmyStrength } from './armyStrength'
import { RawStats } from '../cards/types'

const weak: RawStats = { str: 5, lng: 5, def: 5, hp: 20 }
const strong: RawStats = { str: 40, lng: 40, def: 40, hp: 200 }

describe('compareArmyStrength', () => {
  it('is "even" when both sides have no cards', () => {
    const result = compareArmyStrength({
      attackerCards: [],
      defenderCards: [],
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: null,
    })
    expect(result.label).toBe('even')
  })

  it('is a strong advantage when the defender has no cards', () => {
    const result = compareArmyStrength({
      attackerCards: [{ baseStats: weak, rank: 'common' }],
      defenderCards: [],
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: null,
    })
    expect(result.label).toBe('strong-advantage')
  })

  it('is a strong advantage for an overwhelming attacker army', () => {
    const result = compareArmyStrength({
      attackerCards: Array.from({ length: 10 }, () => ({ baseStats: strong, rank: 'legend' as const })),
      defenderCards: [{ baseStats: weak, rank: 'common' }],
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: null,
    })
    expect(result.label).toBe('strong-advantage')
  })

  it('is a disadvantage for an overwhelming defender, especially with castle/village bonuses', () => {
    const result = compareArmyStrength({
      attackerCards: [{ baseStats: weak, rank: 'common' }],
      defenderCards: Array.from({ length: 10 }, () => ({ baseStats: strong, rank: 'legend' as const })),
      attackerNation: null,
      defenderNation: null,
      castleRank: 'legend',
      villageRank: 'legend',
    })
    expect(result.label).toBe('disadvantage')
  })

  it('is even for identical, evenly matched single-card sides', () => {
    const even: RawStats = { str: 30, lng: 10, def: 15, hp: 50 }
    const result = compareArmyStrength({
      attackerCards: [{ baseStats: even, rank: 'common' }],
      defenderCards: [{ baseStats: even, rank: 'common' }],
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: null,
    })
    expect(result.label).toBe('even')
    expect(result.ratio).toBeCloseTo(0.5, 1)
  })

  it('shifts smoothly (not violently) when a single card is added to a modest attacker army', () => {
    const base = Array.from({ length: 7 }, () => ({ baseStats: weak, rank: 'common' as const }))
    const withoutExtra = compareArmyStrength({
      attackerCards: base,
      defenderCards: Array.from({ length: 7 }, () => ({ baseStats: weak, rank: 'common' as const })),
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: 'common',
    })
    const withExtra = compareArmyStrength({
      attackerCards: [...base, { baseStats: weak, rank: 'common' }],
      defenderCards: Array.from({ length: 7 }, () => ({ baseStats: weak, rank: 'common' as const })),
      attackerNation: null,
      defenderNation: null,
      castleRank: null,
      villageRank: 'common',
    })
    // Adding one more (of many) equal-strength cards should nudge the ratio
    // up only modestly, not swing the label wildly from run to run (this
    // is deterministic, so re-running with the same input is exact too).
    expect(withExtra.ratio).toBeGreaterThan(withoutExtra.ratio)
    expect(withExtra.ratio - withoutExtra.ratio).toBeLessThan(0.15)
  })

  it('is deterministic: repeated calls with the same input give the exact same result', () => {
    const params = {
      attackerCards: [{ baseStats: weak, rank: 'common' as const }],
      defenderCards: [{ baseStats: strong, rank: 'legend' as const }],
      attackerNation: 'england' as const,
      defenderNation: null,
      castleRank: 'common' as const,
      villageRank: 'common' as const,
    }
    const results = Array.from({ length: 5 }, () => compareArmyStrength(params))
    expect(new Set(results.map((r) => r.ratio)).size).toBe(1)
    expect(new Set(results.map((r) => r.label)).size).toBe(1)
  })
})
