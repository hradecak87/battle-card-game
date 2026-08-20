// One-time backfill script: re-seeds NPC garrisons on all still-unclaimed
// castle/village tiles using the new difficulty-scaled size + rank logic
// from generate-world.ts (size now reaches 20 at difficulty 5; rank is
// difficulty-weighted common/uncommon/rare instead of a flat
// common/uncommon pool). Only touches owner_id IS NULL territories and
// owner_id IS NULL card_instances, so it never disturbs anything a player
// has already claimed or been given.
//
// IMPORTANT: does NOT delete existing card_instances rows. Unit card
// instances are never hard-deleted anywhere in normal game logic (battles
// only ever change owner_id, never remove the row), and some historical
// battle_rounds rows reference old NPC garrison instance_ids via a plain
// (RESTRICT) foreign key -- attempting to delete those rows fails with a
// foreign-key violation. Instead this script re-rolls each existing
// instance's template_id in place (same instance_id, new rank/unit type)
// and only INSERTs new rows to top a tile up to its target size (never
// deletes to shrink an oversized tile).
//
// Before touching anything, dumps the exact pre-change rows to a
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
  const existingByTile = new Map<number, { instance_id: string; template_id: string }[]>()
  for (const inst of allNpcInstances) {
    if (inst.stationed_territory_id === null || !tileIds.has(inst.stationed_territory_id)) continue
    const list = existingByTile.get(inst.stationed_territory_id) ?? []
    list.push({ instance_id: inst.instance_id, template_id: inst.template_id })
    existingByTile.set(inst.stationed_territory_id, list)
  }
  const totalExisting = Array.from(existingByTile.values()).reduce((sum, l) => sum + l.length, 0)
  console.log(`Found ${totalExisting} existing NPC garrison card instances to re-roll`)

  // 3. Back up exactly what's about to be touched (nothing is deleted; this
  //    is purely for inspection/rollback of the template_id re-rolls).
  const backupPath = path.join(
    __dirname,
    `_backup-npc-garrisons-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  )
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ structureTiles, existingInstances: allNpcInstances.filter((i) => i.stationed_territory_id !== null && tileIds.has(i.stationed_territory_id)) }, null, 2)
  )
  console.log(`Backed up pre-change state to ${backupPath}`)

  // 4. Fetch unit templates by rank (common/uncommon/rare only — see
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
  function rollTemplateId(difficulty: 1 | 2 | 3 | 4 | 5): string {
    let rank = pickGarrisonRank(difficulty, Math.random)
    if (templatesByRank[rank].length === 0) rank = 'uncommon'
    if (templatesByRank[rank].length === 0) rank = 'common'
    const pool = templatesByRank[rank]
    return pool[Math.floor(Math.random() * pool.length)].id
  }

  // 5. Re-roll each existing instance's template_id in place (no delete —
  //    keeps the row's instance_id intact for any historical battle_rounds
  //    foreign-key references), then top any under-sized tile up to its
  //    target size with fresh INSERTs. Never shrinks an over-sized tile
  //    (that would require deleting rows, which can fail on old instances
  //    referenced by history) — a few tiles may end up with more troops
  //    than the ideal target, which is an acceptable minor deviation.
  let totalRerolled = 0
  let totalMinted = 0
  const updateBatchSize = 200
  for (const tile of structureTiles) {
    const difficulty = tile.difficulty as 1 | 2 | 3 | 4 | 5
    const target = npcGarrisonSize(difficulty)
    const existing = existingByTile.get(tile.id) ?? []

    for (let i = 0; i < existing.length; i += updateBatchSize) {
      const batch = existing.slice(i, i + updateBatchSize)
      for (const inst of batch) {
        const newTemplateId = rollTemplateId(difficulty)
        const { error } = await supabase
          .from('card_instances')
          .update({ template_id: newTemplateId })
          .eq('instance_id', inst.instance_id)
        if (error) throw error
        totalRerolled++
      }
    }

    const deficit = target - existing.length
    if (deficit > 0) {
      const instances = Array.from({ length: deficit }, () => ({
        template_id: rollTemplateId(difficulty),
        owner_id: null,
        stationed_territory_id: tile.id,
        status: 'stationed',
      }))
      const { error } = await supabase.from('card_instances').insert(instances)
      if (error) throw error
      totalMinted += instances.length
    }
  }
  console.log(
    `Re-rolled ${totalRerolled} existing NPC garrison card instances and minted ${totalMinted} new ones across ${structureTiles.length} tiles`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
