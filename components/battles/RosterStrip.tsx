'use client'

import { BattleCard } from '@/lib/battles/api'
import { TradingCard } from '@/components/cards/TradingCard'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'

export interface RosterStripProps {
  title: string
  cards: BattleCard[]
  /** True only for the defender's own pool during their 120s pick window. */
  clickable?: boolean
  onSelect?: (instanceId: string) => void
  /** The card currently in the duel (if any), highlighted instead of greyed. */
  activeInstanceId?: string | null
  previewInstanceId?: string | null
  submittingInstanceId?: string | null
}

function toUnitTemplate(card: BattleCard): UnitCardTemplate | null {
  const t = card.template
  if (t.category !== 'unit' || !t.base_stats || !t.unit_type) return null
  return {
    id: t.id,
    category: 'unit',
    unitType: t.unit_type as UnitType,
    rank: t.rank as Rank,
    name: t.name,
    flavorText: t.flavor_text,
    baseStats: t.base_stats,
    totalSupply: t.total_supply,
  }
}

/**
 * Vertical roster strip (Task 18, desktop) — collapses into a
 * horizontally-scrollable strip on narrow viewports (Task 19) via the
 * `flex-row md:flex-col` / `overflow-x-auto md:overflow-visible`
 * responsive classes below, following this project's established
 * single-component-handles-both-breakpoints convention (no separate
 * `*.mobile.tsx` files exist anywhere in this codebase — see
 * MapViewport.tsx).
 */
export default function RosterStrip({
  title,
  cards,
  clickable = false,
  onSelect,
  activeInstanceId,
  previewInstanceId,
  submittingInstanceId,
}: RosterStripProps) {
  return (
    <div data-testid="roster-strip" className="flex w-full max-w-full min-w-0 flex-col gap-2 md:w-40">
      <h3 className="text-sm font-semibold text-zinc-400">{title}</h3>
      <div
        data-testid="roster-scroll"
        className="flex min-w-0 snap-x snap-mandatory flex-row gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-visible md:pb-0"
      >
        {cards.map((card) => {
          const template = toUnitTemplate(card)
          if (!template) return null
          const isActive = card.instance_id === activeInstanceId
          const isPreview = card.instance_id === previewInstanceId
          const isSubmitting = card.instance_id === submittingInstanceId
          return (
            <button
              key={card.instance_id}
              type="button"
              data-testid={`roster-card-${card.instance_id}`}
              disabled={!clickable || card.is_resting || isSubmitting}
              onClick={() => onSelect?.(card.instance_id)}
              className={`w-[4.875rem] shrink-0 snap-start rounded-lg text-left transition md:w-full ${
                card.is_resting ? 'opacity-40 grayscale' : ''
              } ${isActive ? 'ring-2 ring-amber-400' : isPreview ? 'ring-2 ring-sky-400' : ''} ${
                clickable && !card.is_resting ? 'cursor-pointer hover:scale-[1.03]' : 'cursor-default'
              }`}
            >
              <TradingCard template={template} stats={applyRank(template.baseStats, template.rank)} compact />
              {card.is_resting && <p className="mt-1 text-center text-[10px] text-zinc-500">odpočívá</p>}
            </button>
          )
        })}
        {cards.length === 0 && <p className="text-xs text-zinc-500">Žádná vojska</p>}
      </div>
    </div>
  )
}
