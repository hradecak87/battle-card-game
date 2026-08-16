// One-time backfill script: re-seeds NPC garrisons on all still-unclaimed
// castle/village tiles using the new difficulty-scaled size + rank logic
// from generate-world.ts (size now reaches 20 at difficulty 5; rank is
// difficulty-weighted common/uncommon/rare instead of a flat
// common/uncommon pool). Only touches owner_id IS NULL territories and
// owner_id IS NULL card_instances, so it never disturbs anything a player
// has already claimed or been given.
//
// Before deleting anything, dumps the exact rows about to be removed to a
// timestamped JSON file in this directory so the prior state can be
// inspected/restored if needed.
//
// Run with: npx ts-node scripts/backfill-npc-garrisons.ts

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { npcGarrisonSize, pickGarrisonRank, GarrisonRank } from './generate-world'

if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = require('ws')
}

async function fetchAllPages<T>(
  query: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
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

  // 1. Find still-unclaimed structure tiles.
  const structureTiles = await fetchAllPages<{ id: number; x: number; y: number; difficulty: number }>(
    (from, to) =>
      supabase
        .from('territories')
        .select('id, x, y, difficulty')
        .is('owner_id', null)
        .or('castle_rank.not.is.null,village_rank.not.is.null')
        .range(from, to) as any
  )
  console.log(`Found ${structureTiles.length} unclaimed castle/village tiles`)
  if (structureTiles.length === 0) {
    console.log('Nothing to do.')
    return
  }
  const tileIds = new Set(structureTiles.map((t) => t.id))

  // 2. Fetch every NPC-owned (owner_id IS NULL) card instance stationed
  //    anywhere, then keep only the ones sitting on our unclaimed structure
  //    tiles (avoids a giant .in() filter with 1000+ ids).
  const allNpcInstances = await fetchAllPages<{
    instance_id: string
    template_id: string
    stationed_territory_id: number | null
    status: string
  }>((from, to) =>
    supabase
      .from('card_instances')
      .select('instance_id, template_id, stationed_territory_id, status')
      .is('owner_id', null)
      .not('stationed_territory_id', 'is', null)
      .range(from, to) as any
  )
  const toDelete = allNpcInstances.filter(
    (inst) => inst.stationed_territory_id !== null && tileIds.has(inst.stationed_territory_id)
  )
  console.log(`Found ${toDelete.length} existing NPC garrison card instances to replace`)

  // 3. Back up exactly what's about to be deleted.
  const backupPath = path.join(
    __dirname,
    `_backup-npc-garrisons-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  )
  fs.writeFileSync(backupPath, JSON.stringify({ structureTiles, deletedInstances: toDelete }, null, 2))
  console.log(`Backed up pre-change state to ${backupPath}`)

  // 4. Delete the old garrison instances, in batches.
  const deleteBatchSize = 500
  for (let i = 0; i < toDelete.length; i += deleteBatchSize) {
    const batchIds = toDelete.slice(i, i + deleteBatchSize).map((r) => r.instance_id)
    const { error } = await supabase.from('card_instances').delete().in('instance_id', batchIds)
    if (error) throw error
  }
  console.log(`Deleted ${toDelete.length} old NPC garrison card instances`)

  // 5. Fetch unit templates by rank (common/uncommon/rare only — see
  //    generate-world.ts for why epic/legend are excluded).
  const { data: garrisonTemplates, error: templateError } = await supabase
    .from('card_templates')
    .select('id, rank')
    .eq('category', 'unit')
    .in('rank', ['common', 'uncommon', 'rare'])
  if (templateError) throw templateError
  if (!garrisonTemplates || garrisonTemplates.length === 0) {
    throw new Error('no common/uncommon/rare unit card_templates found')
  }
  const templatesByRank: Record<GarrisonRank, { id: string }[]> = {
    common: garrisonTemplates.filter((t) => t.rank === 'common'),
    uncommon: garrisonTemplates.filter((t) => t.rank === 'uncommon'),
    rare: garrisonTemplates.filter((t) => t.rank === 'rare'),
  }

  // 6. Re-seed each tile with the new difficulty-scaled size/rank logic.
  let totalMinted = 0
  for (const tile of structureTiles) {
    const difficulty = tile.difficulty as 1 | 2 | 3 | 4 | 5
    const size = npcGarrisonSize(difficulty)
    const instances = Array.from({ length: size }, () => {
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
    totalMinted += instances.length
  }
  console.log(`Re-seeded ${structureTiles.length} tiles with ${totalMinted} new NPC garrison card instances`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
