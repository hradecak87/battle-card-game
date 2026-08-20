import {
  DIFFICULTY_WEIGHTS,
  generateClusteredDifficultyGrid,
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

describe('generateClusteredDifficultyGrid', () => {
  // 8-connectivity flood-fill over the flat grid, used to measure blob sizes.
  function componentSizes(grid: number[], width: number, height: number, value: number) {
    const idx = (x: number, y: number) => x * height + y
    const visited = new Array(grid.length).fill(false)
    const sizes: number[] = []
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const i = idx(x, y)
        if (grid[i] !== value || visited[i]) continue
        let size = 0
        const stack = [i]
        visited[i] = true
        while (stack.length > 0) {
          const cur = stack.pop() as number
          size++
          const cx = Math.floor(cur / height)
          const cy = cur % height
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue
              const nx = cx + dx
              const ny = cy + dy
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
              const ni = idx(nx, ny)
              if (grid[ni] === value && !visited[ni]) {
                visited[ni] = true
                stack.push(ni)
              }
            }
          }
        }
        sizes.push(size)
      }
    }
    return sizes
  }

  it('only ever returns values 1-5', () => {
    const rand = mulberry32(101)
    const grid = generateClusteredDifficultyGrid(64, 64, rand)
    expect(grid.length).toBe(64 * 64)
    for (const v of grid) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(5)
    }
  })

  it('produces a percentage split within tolerance of the design weights', () => {
    const rand = mulberry32(202)
    const width = 96
    const height = 96
    const grid = generateClusteredDifficultyGrid(width, height, rand)
    const total = width * height
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const v of grid) counts[v]++
    for (const level of [1, 2, 3, 4, 5] as const) {
      const pct = (counts[level] / total) * 100
      const target = DIFFICULTY_WEIGHTS[level]
      expect(pct).toBeGreaterThanOrEqual(target - 12)
      expect(pct).toBeLessThanOrEqual(target + 12)
    }
  })

  it('forms large contiguous forest/desert/mountain regions, not scattered noise', () => {
    const rand = mulberry32(303)
    const width = 96
    const height = 96
    const grid = generateClusteredDifficultyGrid(width, height, rand)
    for (const value of [2, 4, 5]) {
      const sizes = componentSizes(grid, width, height, value)
      const largest = Math.max(...sizes)
      expect(largest).toBeGreaterThanOrEqual(10)
    }
  })

  it('keeps water mostly in small ponds, clearly smaller than the forest/desert/mountain regions', () => {
    const rand = mulberry32(404)
    const width = 96
    const height = 96
    const grid = generateClusteredDifficultyGrid(width, height, rand)
    const waterSizes = componentSizes(grid, width, height, 3)
    const forestSizes = componentSizes(grid, width, height, 2)
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    }
    // The occasional two ponds touching and merging is acceptable (not a
    // hard requirement) — what matters is water stays overall pond-sized
    // rather than growing into forest/desert-scale contiguous regions.
    expect(median(waterSizes)).toBeLessThanOrEqual(15)
    expect(Math.max(...waterSizes)).toBeLessThan(Math.max(...forestSizes))
  })

  it('is deterministic given the same rand sequence', () => {
    const gridA = generateClusteredDifficultyGrid(32, 32, mulberry32(5))
    const gridB = generateClusteredDifficultyGrid(32, 32, mulberry32(5))
    expect(gridA).toEqual(gridB)
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
