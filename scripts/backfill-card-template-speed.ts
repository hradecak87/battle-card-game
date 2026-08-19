// One-time backfill script (backlog #12: Speed attribute). Merges the new
// `speed` value from lib/cards/catalog-data.json into every existing
// live-DB `card_templates.base_stats` JSONB row, matched by id. This is a
// merge (JSONB `||`), not a replace — no other base_stats fields (or any
// other column) are touched, and no rows are inserted or deleted.
//
// NOT run automatically. Requires 0020_speed_attribute.sql to already be
// applied, and requires the user's explicit go-ahead before running
// against any live project. Safe to re-run (idempotent: re-merging the
// same speed value is a no-op).
//
// Run with: npx ts-node scripts/backfill-card-template-speed.ts

import { createClient } from '@supabase/supabase-js'
import catalogData from '../lib/cards/catalog-data.json'

if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = require('ws')
}

async function main() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  const supabase = createClient(url, serviceRoleKey)

  let updated = 0
  for (const t of catalogData as any[]) {
    const { data: row, error: fetchError } = await supabase
      .from('card_templates')
      .select('base_stats')
      .eq('id', t.id)
      .single()
    if (fetchError) throw new Error(`Failed reading ${t.id}: ${fetchError.message}`)
    if (!row?.base_stats) throw new Error(`Template ${t.id} has no base_stats to merge into`)

    const { error: updateError } = await supabase
      .from('card_templates')
      .update({ base_stats: { ...row.base_stats, speed: t.baseStats.speed } })
      .eq('id', t.id)
    if (updateError) throw new Error(`Failed updating ${t.id}: ${updateError.message}`)
    updated++
  }
  console.log(`Backfilled speed on ${updated} card_templates rows`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
