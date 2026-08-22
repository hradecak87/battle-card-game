import { supabase } from '@/lib/supabase/client'
import { BoostCardTemplate, Rank, ScoutCardTemplate, StructureCardTemplate } from './types'

/**
 * Castle/Village/Wall/Boost templates have no client-only static catalog
 * (unlike units in catalog-data.json) — they live only in the persisted
 * `card_templates` table, publicly readable via the
 * `card_templates_select_all` RLS policy (see 0002_territories.sql).
 * The /catalog page uses this to show every existing card, not just units.
 */
interface CardTemplateRow {
  id: string
  category: string
  rank: string
  name: string | null
  flavor_text: string | null
  defense_bonus_pct: number | null
  attack_bonus_pct: number | null
  boost_type: string | null
  effect_kind: string | null
  instant_effect_kind: string | null
  pct_str: number | null
  pct_lng: number | null
  pct_def: number | null
  pct_hp: number | null
  total_supply: number | null
}

export async function getNonUnitCardTemplates(): Promise<
  (StructureCardTemplate | BoostCardTemplate | ScoutCardTemplate)[]
> {
  const { data, error } = await supabase
    .from('card_templates')
    .select(
      'id, category, rank, name, flavor_text, defense_bonus_pct, attack_bonus_pct, boost_type, effect_kind, instant_effect_kind, pct_str, pct_lng, pct_def, pct_hp, total_supply'
    )
    .neq('category', 'unit')
    .order('category')
    .order('rank')

  if (error) {
    throw new Error(error.message)
  }

  return ((data ?? []) as CardTemplateRow[]).map((row) => {
    if (row.category === 'boost') {
      return {
        id: row.id,
        category: 'boost',
        rank: row.rank as Rank,
        name: row.name ?? row.id,
        flavorText: row.flavor_text ?? '',
        boostType: row.boost_type as BoostCardTemplate['boostType'],
        effectKind: row.effect_kind as BoostCardTemplate['effectKind'],
        instantEffectKind: row.instant_effect_kind as BoostCardTemplate['instantEffectKind'],
        pctStr: row.pct_str,
        pctLng: row.pct_lng,
        pctDef: row.pct_def,
        pctHp: row.pct_hp,
        totalSupply: row.total_supply,
      } satisfies BoostCardTemplate
    }

    if (row.category === 'scout') {
      return {
        id: 'scout',
        category: 'scout',
        rank: row.rank as Rank,
        name: row.name ?? row.id,
        flavorText: row.flavor_text ?? '',
        totalSupply: null,
      } satisfies ScoutCardTemplate
    }

    return {
      id: row.id,
      category: row.category as StructureCardTemplate['category'],
      rank: row.rank as Rank,
      name: row.name ?? row.id,
      flavorText: row.flavor_text ?? '',
      defenseBonusPct: row.defense_bonus_pct ?? 0,
      attackBonusPct: row.attack_bonus_pct,
      totalSupply: row.total_supply,
    } satisfies StructureCardTemplate
  })
}
