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
// Uses a direct Postgres connection (SUPABASE_DB_URL) for the bulk update
// step — Supabase's REST `upsert` can't be used here: Postgres validates
// NOT NULL constraints on the full candidate row before ON CONFLICT
// resolution even for a partial-column payload, so a plain upsert of just
// {id, difficulty} fails against territories' NOT NULL x/y columns. A
// genuine `UPDATE ... FROM UNNEST(...)` has no such problem.
//
// NOT run automatically. Requires the user's explicit go-ahead before
// running against any live project.
//
// Run with: npx ts-node scripts/recolor-terrain.ts

import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
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
  const dbUrl = process.env.SUPABASE_DB_URL
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL must be set (direct Postgres connection for the bulk update)')
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

  // 4. Bulk-update difficulty for every changed row via a direct Postgres
  //    connection — one UPDATE...FROM UNNEST per batch, touching only the
  //    difficulty column and leaving every other column untouched.
  const pg = new Client({ connectionString: dbUrl })
  await pg.connect()
  try {
    const batchSize = 2000
    for (let i = 0; i < changed.length; i += batchSize) {
      const batch = changed.slice(i, i + batchSize)
      const ids = batch.map((c) => c.id)
      const difficulties = batch.map((c) => c.newDifficulty)
      await pg.query(
        `update territories as t
         set difficulty = data.difficulty
         from (select unnest($1::int[]) as id, unnest($2::smallint[]) as difficulty) as data
         where t.id = data.id`,
        [ids, difficulties]
      )
      console.log(`Updated ${Math.min(i + batchSize, changed.length)}/${changed.length} territories`)
    }
  } finally {
    await pg.end()
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
