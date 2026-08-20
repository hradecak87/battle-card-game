// One-time recolor script (map-level-clustering design spec, 2026-08-20).
// Recomputes `territories.difficulty` for every row on the live 256x256 map
// using generateClusteredDifficultyGrid() instead of the original per-tile
// independent-random pickDifficulty(). This is a NON-DESTRUCTIVE, in-place
// recolor: only the `difficulty` column is touched. Ownership, structures
// (castle/village/wall rank), stationed cards, battles, and troop movements
// are all left untouched — including on the handful of already-owned/home
// territories (explicit user decision, "Option B").
//
// Before writing anything, dumps the exact { id, old difficulty, new
// difficulty } rows to a timestamped JSON file in this directory so the
// prior state can be inspected/restored if needed.
//
// NOT run automatically. Requires the user's explicit go-ahead before
// running against any live project.
//
// Run with: npx ts-node scripts/recolor-terrain.ts

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { MAP_SIZE, generateClusteredDifficultyGrid } from './generate-world'

if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = require('ws')
}

async function fetchAllPages<T>(
  query: (
    from: number,
    to: number
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const pageSize = 1000
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await query(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

async function main() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  const supabase = createClient(url, serviceRoleKey)

  // 1. Fetch every territory's id/x/y/current difficulty.
  const territories = await fetchAllPages<{ id: number; x: number; y: number; difficulty: number }>(
    (from, to) =>
      supabase.from('territories').select('id, x, y, difficulty').range(from, to) as any
  )
  console.log(`Fetched ${territories.length} territories`)
  if (territories.length === 0) {
    console.log('territories table is empty — nothing to recolor. Run generate-world.ts first.')
    return
  }

  // 2. Compute the new clustered difficulty grid.
  const grid = generateClusteredDifficultyGrid(MAP_SIZE, MAP_SIZE)
  const newDifficultyAt = (x: number, y: number) => grid[x * MAP_SIZE + y]

  // 3. Back up exactly what's about to change (old + new difficulty per id).
  const changes = territories.map((t) => ({
    id: t.id,
    x: t.x,
    y: t.y,
    oldDifficulty: t.difficulty,
    newDifficulty: newDifficultyAt(t.x, t.y),
  }))
  const changed = changes.filter((c) => c.oldDifficulty !== c.newDifficulty)
  const backupPath = path.join(
    __dirname,
    `_backup-recolor-terrain-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  )
  fs.writeFileSync(backupPath, JSON.stringify(changes, null, 2))
  console.log(`Backed up pre-change state (${changes.length} rows) to ${backupPath}`)
  console.log(`${changed.length}/${changes.length} territories will change difficulty`)

  // 4. Batch-update difficulty for every changed row (a single upsert per
  //    batch — on conflict by primary key `id` it only touches the columns
  //    we send, leaving every other column on each row untouched).
  const batchSize = 1000
  for (let i = 0; i < changed.length; i += batchSize) {
    const batch = changed.slice(i, i + batchSize).map((c) => ({ id: c.id, difficulty: c.newDifficulty }))
    const { error } = await supabase.from('territories').upsert(batch, { onConflict: 'id' })
    if (error) throw error
    console.log(`Updated ${Math.min(i + batchSize, changed.length)}/${changed.length} territories`)
  }

  // 5. Log the before/after distribution for a quick sanity check.
  const before: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const after: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const c of changes) {
    before[c.oldDifficulty] = (before[c.oldDifficulty] ?? 0) + 1
    after[c.newDifficulty] = (after[c.newDifficulty] ?? 0) + 1
  }
  const total = changes.length
  console.log('Difficulty distribution before -> after:')
  for (const level of [1, 2, 3, 4, 5]) {
    const beforePct = ((before[level] / total) * 100).toFixed(1)
    const afterPct = ((after[level] / total) * 100).toFixed(1)
    console.log(`  ${level}: ${beforePct}% -> ${afterPct}%`)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
