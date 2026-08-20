// One-time world-generation script (Territory Map design spec §4). Populates
// all 65,536 `territories` rows (256×256) with a weighted difficulty
// distribution, sparse castle/village pre-seeding, and NPC garrisons on any
// pre-seeded structure tile. Safe to run only once — aborts if the table
// already has rows.
//
// NOT run automatically. Requires the 0002_territories.sql migration to
// already be applied to the target Supabase project, and requires the
// user's explicit go-ahead before running against any live project.
//
// Run with: npx ts-node scripts/generate-world.ts

import { createClient } from '@supabase/supabase-js'
import { Rank } from '../lib/cards/types'

// Node <22 has no native WebSocket global, which @supabase/supabase-js's
// realtime client requires even though this script never uses realtime.
if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = require('ws')
}

export const MAP_SIZE = 256

/** Difficulty 1-2 make up ~60% of the map, tapering to ~5% for 5 (spec §4). */
export const DIFFICULTY_WEIGHTS: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 30,
  2: 30,
  3: 20,
  4: 15,
  5: 5,
}

const DIFFICULTY_CUMULATIVE = (() => {
  let running = 0
  const entries: Array<[number, number]> = []
  for (const key of [1, 2, 3, 4, 5] as const) {
    running += DIFFICULTY_WEIGHTS[key]
    entries.push([key, running])
  }
  return entries
})()

const VILLAGE_PLACEMENT_PROBABILITY = 0.02
const CASTLE_PLACEMENT_PROBABILITY = 0.005

/** Picks a difficulty 1-5 per the weighted distribution. `rand()` must return [0,1). */
export function pickDifficulty(rand: () => number): 1 | 2 | 3 | 4 | 5 {
  const roll = rand() * 100
  for (const [difficulty, cumulative] of DIFFICULTY_CUMULATIVE) {
    if (roll < cumulative) return difficulty as 1 | 2 | 3 | 4 | 5
  }
  return 5
}

/** ~2% of tiles get a pre-seeded village (spec §4). Independent of castle. */
export function shouldPlaceVillage(rand: () => number): boolean {
  return rand() < VILLAGE_PLACEMENT_PROBABILITY
}

/** ~0.5% of tiles get a pre-seeded castle (spec §4). Overlap with village allowed. */
export function shouldPlaceCastle(rand: () => number): boolean {
  return rand() < CASTLE_PLACEMENT_PROBABILITY
}

/**
 * NPC garrison size for a pre-seeded structure tile, scaled to the tile's
 * difficulty (spec §4), topping out at 20 for the hardest (5/5) tiles.
 */
export const NPC_GARRISON_SIZES: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 3,
  2: 7,
  3: 11,
  4: 15,
  5: 20,
}

export function npcGarrisonSize(difficulty: 1 | 2 | 3 | 4 | 5): number {
  return NPC_GARRISON_SIZES[difficulty]
}

/**
 * NPC garrison rank distribution (% chance per instance) for a given tile
 * difficulty. Deliberately capped at "rare" — epic/legend templates have a
 * global totalSupply as low as 1-5 copies with no mint-count enforcement
 * yet, so handing them out automatically at world-seed time would blow past
 * their intended scarcity. Higher difficulty instead shifts weight toward
 * common -> uncommon -> rare.
 */
const GARRISON_RANK_WEIGHTS: Record<
  1 | 2 | 3 | 4 | 5,
  { common: number; uncommon: number; rare: number }
> = {
  1: { common: 90, uncommon: 10, rare: 0 },
  2: { common: 70, uncommon: 25, rare: 5 },
  3: { common: 45, uncommon: 35, rare: 20 },
  4: { common: 25, uncommon: 35, rare: 40 },
  5: { common: 10, uncommon: 30, rare: 60 },
}

export type GarrisonRank = 'common' | 'uncommon' | 'rare'

/** Picks a garrison unit's rank per the difficulty-weighted distribution above. */
export function pickGarrisonRank(
  difficulty: 1 | 2 | 3 | 4 | 5,
  rand: () => number
): GarrisonRank {
  const weights = GARRISON_RANK_WEIGHTS[difficulty]
  const roll = rand() * 100
  if (roll < weights.common) return 'common'
  if (roll < weights.common + weights.uncommon) return 'uncommon'
  return 'rare'
}

/** A pre-seeded structure's rank, biased toward common/uncommon (spec §4). */
export function preSeededStructureRank(rand: () => number): Rank {
  const roll = rand()
  if (roll < 0.5) return 'common'
  if (roll < 0.8) return 'uncommon'
  if (roll < 0.93) return 'rare'
  if (roll < 0.99) return 'epic'
  return 'legend'
}

/**
 * Generates a spatially-clustered difficulty grid for the whole map (map
 * clustering design spec, 2026-08-20): forest(2)/desert(4)/mountain(5) grow
 * as large irregular blobs, water(3) grows as small gap-spaced blobs, and
 * any remaining tile defaults to grass(1). Returns a flat array indexed by
 * `x * height + y`. Pure/testable — `rand()` must return [0,1).
 */
export function generateClusteredDifficultyGrid(
  width: number,
  height: number,
  rand: () => number = Math.random
): number[] {
  const total = width * height
  const grid = new Array<number>(total).fill(0)
  const idx = (x: number, y: number) => x * height + y
  const coordOf = (i: number) => ({ x: Math.floor(i / height), y: i % height })

  function addNeighbors(i: number, frontier: number[]) {
    const { x, y } = coordOf(i)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const ni = idx(nx, ny)
        if (grid[ni] === 0) frontier.push(ni)
      }
    }
  }

  /**
   * Grows one blob from `seedIdx` via random 8-directional frontier
   * expansion. `maxRadius`, if given, keeps the blob compact (Chebyshev
   * distance from the seed) — used for water so ponds stay round instead of
   * snaking out toward other blobs.
   */
  function growBlob(
    seedIdx: number,
    targetSize: number,
    value: number,
    maxRadius?: number
  ): number {
    if (grid[seedIdx] !== 0) return 0
    const seed = coordOf(seedIdx)
    grid[seedIdx] = value
    let size = 1
    const frontier: number[] = []
    addNeighbors(seedIdx, frontier)
    while (size < targetSize && frontier.length > 0) {
      const pick = Math.floor(rand() * frontier.length)
      const cand = frontier[pick]
      frontier[pick] = frontier[frontier.length - 1]
      frontier.pop()
      if (grid[cand] !== 0) continue
      if (maxRadius !== undefined) {
        const { x, y } = coordOf(cand)
        if (Math.max(Math.abs(x - seed.x), Math.abs(y - seed.y)) > maxRadius) continue
      }
      grid[cand] = value
      size++
      addNeighbors(cand, frontier)
    }
    return size
  }

  /**
   * Builds a freshly-shuffled pool of currently-unclaimed cell indices. Built
   * per-phase (not once globally) so a cell rejected by one phase's extra
   * constraints (e.g. water's min-gap check) remains a valid candidate for
   * later attempts within that same phase instead of being permanently lost.
   */
  function buildUnclaimedPool(): number[] {
    const pool: number[] = []
    for (let i = 0; i < total; i++) {
      if (grid[i] === 0) pool.push(i)
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const tmp = pool[i]
      pool[i] = pool[j]
      pool[j] = tmp
    }
    return pool
  }

  function growRegion(value: number, targetCount: number, minBlob: number, maxBlob: number) {
    const pool = buildUnclaimedPool()
    let cursor = 0
    let claimed = 0
    while (claimed < targetCount && cursor < pool.length) {
      const seed = pool[cursor]
      cursor++
      if (grid[seed] !== 0) continue
      const blobTarget = Math.min(
        minBlob + Math.floor(rand() * (maxBlob - minBlob + 1)),
        targetCount - claimed
      )
      const grown = growBlob(seed, blobTarget, value)
      claimed += grown
    }
  }

  /** True if no water(3) tile exists within `gapRadius` tiles (Chebyshev) of `i`. */
  function isFarFromWater(i: number, gapRadius: number): boolean {
    const { x, y } = coordOf(i)
    for (let dx = -gapRadius; dx <= gapRadius; dx++) {
      for (let dy = -gapRadius; dy <= gapRadius; dy++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        if (grid[idx(nx, ny)] === 3) return false
      }
    }
    return true
  }

  function growWaterRegion(
    targetCount: number,
    minBlob: number,
    maxBlob: number,
    gapRadius: number
  ) {
    const pool = buildUnclaimedPool()
    let cursor = 0
    let claimed = 0
    while (claimed < targetCount && cursor < pool.length) {
      const seed = pool[cursor]
      cursor++
      if (grid[seed] !== 0) continue
      if (!isFarFromWater(seed, gapRadius)) continue
      const blobTarget = Math.min(
        minBlob + Math.floor(rand() * (maxBlob - minBlob + 1)),
        targetCount - claimed
      )
      const grown = growBlob(seed, blobTarget, 3, 2)
      claimed += grown
    }
  }

  growRegion(2, Math.round(total * (DIFFICULTY_WEIGHTS[2] / 100)), 15, 180) // forest
  growRegion(4, Math.round(total * (DIFFICULTY_WEIGHTS[4] / 100)), 15, 180) // desert
  growRegion(5, Math.round(total * (DIFFICULTY_WEIGHTS[5] / 100)), 15, 180) // mountain
  growWaterRegion(Math.round(total * (DIFFICULTY_WEIGHTS[3] / 100)), 5, 15, 2) // water

  for (let i = 0; i < total; i++) {
    if (grid[i] === 0) grid[i] = 1 // grass fills whatever's left
  }

  return grid
}

interface TerritoryRow {
  x: number
  y: number
  difficulty: number
  castle_rank: string | null
  village_rank: string | null
}

/** Builds the full 65,536-row territories dataset in memory. Pure/testable. */
export function buildWorld(rand: () => number = Math.random): TerritoryRow[] {
  const rows: TerritoryRow[] = []
  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      const difficulty = pickDifficulty(rand)
      const villageRank = shouldPlaceVillage(rand) ? preSeededStructureRank(rand) : null
      const castleRank = shouldPlaceCastle(rand) ? preSeededStructureRank(rand) : null
      rows.push({ x, y, difficulty, castle_rank: castleRank, village_rank: villageRank })
    }
  }
  return rows
}

async function main() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  const supabase = createClient(url, serviceRoleKey)

  const { count, error: countError } = await supabase
    .from('territories')
    .select('*', { count: 'exact', head: true })
  if (countError) throw countError
  if (count && count > 0) {
    throw new Error(
      `territories already has ${count} rows — world generation must run exactly once ` +
        `against an empty table. Aborting.`
    )
  }

  const rows = buildWorld()
  const batchSize = 1000
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from('territories').insert(batch)
    if (error) throw error
    console.log(`Inserted ${Math.min(i + batchSize, rows.length)}/${rows.length} territories`)
  }

  // NPC garrisons on every pre-seeded structure tile (spec §4).
  const { data: structureTiles, error: structureError } = await supabase
    .from('territories')
    .select('id, difficulty')
    .or('castle_rank.not.is.null,village_rank.not.is.null')
  if (structureError) throw structureError

  const { data: garrisonTemplates, error: templateError } = await supabase
    .from('card_templates')
    .select('id, rank')
    .eq('category', 'unit')
    .in('rank', ['common', 'uncommon', 'rare'])
  if (templateError) throw templateError
  if (!garrisonTemplates || garrisonTemplates.length === 0) {
    throw new Error(
      'no common/uncommon/rare unit card_templates found — run scripts/seed-card-templates.ts first'
    )
  }
  const templatesByRank: Record<GarrisonRank, { id: string }[]> = {
    common: garrisonTemplates.filter((t) => t.rank === 'common'),
    uncommon: garrisonTemplates.filter((t) => t.rank === 'uncommon'),
    rare: garrisonTemplates.filter((t) => t.rank === 'rare'),
  }

  for (const tile of structureTiles ?? []) {
    const difficulty = tile.difficulty as 1 | 2 | 3 | 4 | 5
    const size = npcGarrisonSize(difficulty)
    const instances = Array.from({ length: size }, () => {
      // Fall back to a lower rank if the picked rank has no seeded templates.
      let rank = pickGarrisonRank(difficulty, Math.random)
      if (templatesByRank[rank].length === 0) rank = 'uncommon'
      if (templatesByRank[rank].length === 0) rank = 'common'
      const pool = templatesByRank[rank]
      return {
        template_id: pool[Math.floor(Math.random() * pool.length)].id,
        owner_id: null,
        stationed_territory_id: tile.id,
        status: 'stationed',
      }
    })
    const { error } = await supabase.from('card_instances').insert(instances)
    if (error) throw error
  }
  console.log(`Garrisoned ${structureTiles?.length ?? 0} pre-seeded structure tiles`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
