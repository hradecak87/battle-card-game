import { castleAttackBonusPct, combinedDefenseBonusPct } from './structureBonus'

describe('combinedDefenseBonusPct', () => {
  it('is 0 when neither structure is built', () => {
    expect(combinedDefenseBonusPct(null, null)).toBe(0)
  })

  it('returns only the castle bonus when no village is built', () => {
    expect(combinedDefenseBonusPct('rare', null)).toBe(55)
  })

  it('returns only the village bonus when no castle is built', () => {
    expect(combinedDefenseBonusPct(null, 'rare')).toBe(35)
  })

  it('adds both bonuses when both structures are built', () => {
    expect(combinedDefenseBonusPct('rare', 'rare')).toBe(90)
  })

  it('adds both bonuses at the extremes (common + legend)', () => {
    expect(combinedDefenseBonusPct('common', 'legend')).toBe(20 + 80)
    expect(combinedDefenseBonusPct('legend', 'common')).toBe(120 + 10)
  })
})

describe('castleAttackBonusPct', () => {
  it('is 0 when no castle is built', () => {
    expect(castleAttackBonusPct(null)).toBe(0)
  })

  it.each([
    ['common', 10],
    ['uncommon', 20],
    ['rare', 35],
    ['epic', 55],
    ['legend', 80],
  ] as const)('returns %s rank bonus %i%%', (rank, expected) => {
    expect(castleAttackBonusPct(rank)).toBe(expected)
  })
})
