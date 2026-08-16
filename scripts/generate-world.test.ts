import {
  DIFFICULTY_WEIGHTS,
  npcGarrisonSize,
  pickDifficulty,
  pickGarrisonRank,
  preSeededStructureRank,
  shouldPlaceCastle,
  shouldPlaceVillage,
} from './generate-world'

// Deterministic PRNG (mulberry32) so distribution tests are reproducible.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('pickDifficulty', () => {
  it('only ever returns 1-5', () => {
    const rand = mulberry32(1)
    for (let i = 0; i < 10000; i++) {
      const d = pickDifficulty(rand)
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(5)
    }
  })

  it('makes difficulty 1-2 roughly 55-65% of samples over 10,000 draws', () => {
    const rand = mulberry32(42)
    let easyCount = 0
    const samples = 10000
    for (let i = 0; i < samples; i++) {
      const d = pickDifficulty(rand)
      if (d === 1 || d === 2) easyCount++
    }
    const pct = (easyCount / samples) * 100
    expect(pct).toBeGreaterThanOrEqual(55)
    expect(pct).toBeLessThanOrEqual(65)
  })

  it('makes difficulty 5 roughly 3-8% of samples over 10,000 draws', () => {
    const rand = mulberry32(7)
    let hardCount = 0
    const samples = 10000
    for (let i = 0; i < samples; i++) {
      if (pickDifficulty(rand) === 5) hardCount++
    }
    const pct = (hardCount / samples) * 100
    expect(pct).toBeGreaterThanOrEqual(3)
    expect(pct).toBeLessThanOrEqual(8)
  })

  it('weights sum to 100', () => {
    const total = Object.values(DIFFICULTY_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBe(100)
  })
})

describe('shouldPlaceVillage / shouldPlaceCastle', () => {
  it('places villages on roughly 1-3% of tiles over 10,000 draws', () => {
    const rand = mulberry32(2)
    let count = 0
    for (let i = 0; i < 10000; i++) {
      if (shouldPlaceVillage(rand)) count++
    }
    const pct = (count / 10000) * 100
    expect(pct).toBeGreaterThanOrEqual(1)
    expect(pct).toBeLessThanOrEqual(3)
  })

  it('places castles on roughly 0.2-1% of tiles over 10,000 draws', () => {
    const rand = mulberry32(3)
    let count = 0
    for (let i = 0; i < 10000; i++) {
      if (shouldPlaceCastle(rand)) count++
    }
    const pct = (count / 10000) * 100
    expect(pct).toBeGreaterThanOrEqual(0.2)
    expect(pct).toBeLessThanOrEqual(1)
  })
})

describe('npcGarrisonSize', () => {
  it('scales with difficulty', () => {
    expect(npcGarrisonSize(1)).toBeLessThan(npcGarrisonSize(5))
  })

  it('is always positive', () => {
    for (const d of [1, 2, 3, 4, 5] as const) {
      expect(npcGarrisonSize(d)).toBeGreaterThan(0)
    }
  })

  it('reaches 20 at the hardest difficulty', () => {
    expect(npcGarrisonSize(5)).toBe(20)
  })
})

describe('pickGarrisonRank', () => {
  it('only ever returns common, uncommon, or rare (never epic/legend)', () => {
    const rand = mulberry32(17)
    const valid = ['common', 'uncommon', 'rare']
    for (const d of [1, 2, 3, 4, 5] as const) {
      for (let i = 0; i < 1000; i++) {
        expect(valid).toContain(pickGarrisonRank(d, rand))
      }
    }
  })

  it('shifts weight toward rare as difficulty increases', () => {
    const samples = 10000
    function rarePct(difficulty: 1 | 2 | 3 | 4 | 5, seed: number) {
      const rand = mulberry32(seed)
      let rareCount = 0
      for (let i = 0; i < samples; i++) {
        if (pickGarrisonRank(difficulty, rand) === 'rare') rareCount++
      }
      return rareCount / samples
    }
    const easyRare = rarePct(1, 21)
    const hardRare = rarePct(5, 22)
    expect(hardRare).toBeGreaterThan(easyRare)
  })
})

describe('preSeededStructureRank', () => {
  it('only ever returns a valid rank', () => {
    const rand = mulberry32(11)
    const valid = ['common', 'uncommon', 'rare', 'epic', 'legend']
    for (let i = 0; i < 1000; i++) {
      expect(valid).toContain(preSeededStructureRank(rand))
    }
  })

  it('is biased toward common/uncommon over 10,000 draws', () => {
    const rand = mulberry32(13)
    let commonOrUncommon = 0
    for (let i = 0; i < 10000; i++) {
      const r = preSeededStructureRank(rand)
      if (r === 'common' || r === 'uncommon') commonOrUncommon++
    }
    expect(commonOrUncommon / 10000).toBeGreaterThan(0.6)
  })
})
