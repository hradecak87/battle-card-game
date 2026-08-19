// One-time seed script (Territory Map design spec §2.1, §7). Loads the 248
// hand-authored unit templates from lib/cards/catalog-data.json into the
// `card_templates` table, plus 10 hand-authored Castle/Village structure
// templates (5 ranks × 2 categories, spec §7's bonus table).
//
// NOT run automatically. Requires the 0002_territories.sql migration to
// already be applied to the target Supabase project, and requires the
// user's explicit go-ahead before running against any live project. Run
// once, before scripts/generate-world.ts (world-gen's NPC garrisons need
// unit templates to already exist).
//
// Run with: npx ts-node scripts/seed-card-templates.ts

import { createClient } from '@supabase/supabase-js'
import catalogData from '../lib/cards/catalog-data.json'
import boostCatalogData from '../lib/cards/boost-catalog-data.json'
import { Rank } from '../lib/cards/types'

// Node <22 has no native WebSocket global, which @supabase/supabase-js's
// realtime client requires even though this script never uses realtime.
if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = require('ws')
}

// Village DEF / Castle DEF / Castle ATK bonus %, per rank (spec §7).
const STRUCTURE_BONUS_TABLE: Record<Rank, { villageDef: number; castleDef: number; castleAtk: number }> = {
  common: { villageDef: 10, castleDef: 20, castleAtk: 10 },
  uncommon: { villageDef: 20, castleDef: 35, castleAtk: 20 },
  rare: { villageDef: 35, castleDef: 55, castleAtk: 35 },
  epic: { villageDef: 55, castleDef: 80, castleAtk: 55 },
  legend: { villageDef: 80, castleDef: 120, castleAtk: 80 },
}

// Tighter supply caps than unit cards, reflecting "velmi ojedinělé" (spec §2.1).
const STRUCTURE_SUPPLY: Record<Rank, [number, number]> = {
  common: [30, 60],
  uncommon: [15, 30],
  rare: [6, 15],
  epic: [2, 6],
  legend: [1, 2],
}

const RANKS: Rank[] = ['common', 'uncommon', 'rare', 'epic', 'legend']

interface CardTemplateRow {
  id: string
  category: 'unit' | 'castle' | 'village' | 'boost'
  unit_type: string | null
  rank: string
  name: string
  flavor_text: string
  base_stats: { str: number; lng: number; def: number; hp: number; speed: number } | null
  defense_bonus_pct: number | null
  attack_bonus_pct: number | null
  total_supply: number | null
  boost_type?: string | null
  effect_kind?: string | null
  instant_effect_kind?: string | null
  pct_str?: number | null
  pct_lng?: number | null
  pct_def?: number | null
  pct_hp?: number | null
}

function buildUnitRows(): CardTemplateRow[] {
  return (catalogData as any[]).map((t) => ({
    id: t.id,
    category: 'unit' as const,
    unit_type: t.unitType,
    rank: t.rank,
    name: t.name,
    flavor_text: t.flavorText,
    base_stats: t.baseStats,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    total_supply: t.totalSupply,
  }))
}

function midpoint([min, max]: [number, number]): number {
  return Math.round((min + max) / 2)
}

function buildStructureRows(): CardTemplateRow[] {
  const rows: CardTemplateRow[] = []
  for (const rank of RANKS) {
    const bonuses = STRUCTURE_BONUS_TABLE[rank]
    const supply = midpoint(STRUCTURE_SUPPLY[rank])
    rows.push({
      id: `castle-${rank}`,
      category: 'castle',
      unit_type: null,
      rank,
      name: `Hrad (${rank})`,
      flavor_text: `Kamenná pevnost, jejíž hradby a věže výrazně posilují obranu i útok z dálky bránících vojsk.`,
      base_stats: null,
      defense_bonus_pct: bonuses.castleDef,
      attack_bonus_pct: bonuses.castleAtk,
      total_supply: supply,
    })
    rows.push({
      id: `village-${rank}`,
      category: 'village',
      unit_type: null,
      rank,
      name: `Vesnice (${rank})`,
      flavor_text: `Osídlené území poskytující bránícím se vojskům zásoby a úkryt, což posiluje jejich obranu.`,
      base_stats: null,
      defense_bonus_pct: bonuses.villageDef,
      attack_bonus_pct: null,
      total_supply: supply,
    })
  }
  return rows
}

export function buildCardTemplateRows(): CardTemplateRow[] {
  return [
    ...buildUnitRows(),
    ...(boostCatalogData as Array<Record<string, unknown>>).map((t) => ({
      id: String(t.id),
      category: 'boost' as const,
      unit_type: null,
      rank: String(t.rank),
      name: String(t.name),
      flavor_text: String(t.flavorText),
      base_stats: null,
      defense_bonus_pct: null,
      attack_bonus_pct: null,
      total_supply: typeof t.totalSupply === 'number' ? Number(t.totalSupply) : null,
      boost_type: String(t.boostType),
      effect_kind: String(t.effectKind),
      instant_effect_kind: t.instantEffectKind ? String(t.instantEffectKind) : null,
      pct_str: typeof t.pctStr === 'number' ? Number(t.pctStr) : null,
      pct_lng: typeof t.pctLng === 'number' ? Number(t.pctLng) : null,
      pct_def: typeof t.pctDef === 'number' ? Number(t.pctDef) : null,
      pct_hp: typeof t.pctHp === 'number' ? Number(t.pctHp) : null,
    })),
    ...buildStructureRows(),
  ]
}

async function main() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  const supabase = createClient(url, serviceRoleKey)

  const { count, error: countError } = await supabase
    .from('card_templates')
    .select('*', { count: 'exact', head: true })
  if (countError) throw countError
  if (count && count > 0) {
    throw new Error(
      `card_templates already has ${count} rows — seeding must run exactly once ` +
        `against an empty table. Aborting.`
    )
  }

  const rows = buildCardTemplateRows()
  const batchSize = 200
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from('card_templates').insert(batch)
    if (error) throw error
  }
  console.log(
    `Seeded ${rows.length} card templates (${catalogData.length} unit + ${(boostCatalogData as unknown[]).length} boost + 10 structure)`
  )
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
