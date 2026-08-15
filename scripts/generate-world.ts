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
 * NPC garrison size for a pre-seeded structure tile, roughly scaled to the
 * tile's difficulty (spec §4: "a handful... roughly scaled to the tile's
 * difficulty").
 */
export function npcGarrisonSize(difficulty: 1 | 2 | 3 | 4 | 5): number {
  return 3 + difficulty * 2
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
    .select('id')
    .eq('category', 'unit')
    .in('rank', ['common', 'uncommon'])
  if (templateError) throw templateError
  if (!garrisonTemplates || garrisonTemplates.length === 0) {
    throw new Error(
      'no common/uncommon unit card_templates found — run scripts/seed-card-templates.ts first'
    )
  }

  for (const tile of structureTiles ?? []) {
    const size = npcGarrisonSize(tile.difficulty as 1 | 2 | 3 | 4 | 5)
    const instances = Array.from({ length: size }, () => ({
      template_id: garrisonTemplates[Math.floor(Math.random() * garrisonTemplates.length)].id,
      owner_id: null,
      stationed_territory_id: tile.id,
      status: 'stationed',
    }))
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
