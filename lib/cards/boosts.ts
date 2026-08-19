import { BoostCardTemplate, Rank } from './types'

export const RANK_LABELS: Record<Rank, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legend: 'Legend',
}

export function boostTypeLabel(boostType: BoostCardTemplate['boostType']) {
  return boostType === 'territorial' ? 'Obranný boost' : 'Útočný boost'
}

export function boostEffectSummary(template: Pick<
  BoostCardTemplate,
  'effectKind' | 'instantEffectKind' | 'pctStr' | 'pctLng' | 'pctDef' | 'pctHp'
>) {
  if (template.effectKind === 'instant_effect') {
    if (template.instantEffectKind === 'steal_unit') return 'Krysa — ukradne náhodnou nepřátelskou jednotku'
    return 'Okamžitý efekt'
  }

  const parts = [
    template.pctStr ? `Síla +${template.pctStr} %` : null,
    template.pctLng ? `Dálka +${template.pctLng} %` : null,
    template.pctDef ? `Obrana +${template.pctDef} %` : null,
    template.pctHp ? `HP +${template.pctHp} %` : null,
  ].filter(Boolean)

  return parts.join(' · ') || 'Statový boost'
}
