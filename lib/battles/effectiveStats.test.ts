import { computeEffectiveStats } from './effectiveStats'

describe('computeEffectiveStats', () => {
  it.each([
    ['england', { str: 12, lng: 26, def: 35, hp: 46 }],
    ['francia', { str: 14, lng: 23, def: 35, hp: 46 }],
    ['hre', { str: 12, lng: 23, def: 40, hp: 46 }],
    ['byzantium', { str: 12, lng: 23, def: 35, hp: 53 }],
  ] as const)(
    'applies rank scaling and the %s nation perk for attackers without structure bonuses',
    (ownerNation, expected) => {
      expect(
        computeEffectiveStats({
          baseStats: { str: 10, lng: 20, def: 30, hp: 40, speed: 5 },
          rank: 'uncommon',
          isDefendingThisRound: false,
          castleRank: 'legend',
          villageRank: 'legend',
          wallRank: null,
          ownerNation,
        })
      ).toEqual(expected)
    }
  )

  it('applies only village defense when defending with a village and no castle', () => {
    expect(
      computeEffectiveStats({
        baseStats: { str: 10, lng: 10, def: 20, hp: 10, speed: 5 },
        rank: 'common',
        isDefendingThisRound: true,
        castleRank: null,
        villageRank: 'rare',
        wallRank: null,
        ownerNation: 'mongol_horde',
      })
    ).toEqual({ str: 10, lng: 10, def: 27, hp: 10 })
  })

  it('applies both castle defense and castle attack bonuses when defending with only a castle', () => {
    expect(
      computeEffectiveStats({
        baseStats: { str: 10, lng: 10, def: 20, hp: 10, speed: 5 },
        rank: 'common',
        isDefendingThisRound: true,
        castleRank: 'uncommon',
        villageRank: null,
        wallRank: null,
        ownerNation: 'mongol_horde',
      })
    ).toEqual({ str: 12, lng: 12, def: 27, hp: 10 })
  })

  it('stacks castle and village defense additively while still applying the castle attack bonus', () => {
    expect(
      computeEffectiveStats({
        baseStats: { str: 10, lng: 10, def: 20, hp: 10, speed: 5 },
        rank: 'common',
        isDefendingThisRound: true,
        castleRank: 'rare',
        villageRank: 'uncommon',
        wallRank: null,
        ownerNation: 'mongol_horde',
      })
    ).toEqual({ str: 14, lng: 14, def: 35, hp: 10 })
  })

  it('multiplies stacked defense bonuses sequentially and rounds only once at the end', () => {
    expect(
      computeEffectiveStats({
        baseStats: { str: 4, lng: 5, def: 3, hp: 7, speed: 5 },
        rank: 'common',
        isDefendingThisRound: true,
        castleRank: 'common',
        villageRank: null,
        wallRank: null,
        ownerNation: 'hre',
      })
    ).toEqual({ str: 4, lng: 6, def: 4, hp: 7 })
  })

  it.each(['mongol_horde', 'scandinavia'] as const)(
    'leaves the nation-perk step unchanged for %s',
    (ownerNation) => {
      expect(
        computeEffectiveStats({
          baseStats: { str: 10, lng: 10, def: 20, hp: 10, speed: 5 },
          rank: 'common',
          isDefendingThisRound: true,
          castleRank: 'common',
          villageRank: 'common',
          wallRank: null,
          ownerNation,
        })
      ).toEqual({ str: 11, lng: 11, def: 26, hp: 10 })
    }
  )
})
