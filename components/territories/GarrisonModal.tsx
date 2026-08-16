'use client'

import { CardInstanceWithTemplate, Territory } from '@/lib/territories/api'
import { TradingCard } from '@/components/cards/TradingCard'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'

export interface GarrisonModalProps {
  territory: Territory
  instances: CardInstanceWithTemplate[] | null
  error: string | null
  onClose: () => void
}

/** Rebuilds the `UnitCardTemplate` shape `TradingCard` expects from the flat DB row. */
function toUnitTemplate(row: NonNullable<CardInstanceWithTemplate['card_templates']>): UnitCardTemplate | null {
  if (row.category !== 'unit' || !row.base_stats || !row.unit_type) return null
  return {
    id: row.id,
    category: 'unit',
    unitType: row.unit_type as UnitType,
    rank: row.rank as Rank,
    name: row.name,
    flavorText: row.flavor_text,
    baseStats: row.base_stats,
    totalSupply: row.total_supply,
  }
}

/**
 * Popup shown when a map tile is selected (design follow-up to Task 12):
 * renders the garrison stationed there as actual `TradingCard` visuals
 * instead of a plain text list, reusing subsystem #1's card art/frame.
 */
export default function GarrisonModal({ territory, instances, error, onClose }: GarrisonModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        data-testid="garrison-modal"
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            Posádka — území ({territory.x}, {territory.y})
          </h2>
          <button
            type="button"
            aria-label="Zavřít"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!error && instances === null && <p className="text-zinc-400 text-sm">Načítám…</p>}

        {!error && instances !== null && instances.length === 0 && (
          <p className="text-zinc-400 text-sm">Žádná vojska na tomto území.</p>
        )}

        {!error && instances !== null && instances.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {instances.map((instance) => {
              const row = instance.card_templates
              const unitTemplate = row ? toUnitTemplate(row) : null
              return (
                <div key={instance.instance_id} className="flex flex-col items-center gap-1">
                  {unitTemplate ? (
                    <TradingCard
                      template={unitTemplate}
                      stats={applyRank(unitTemplate.baseStats, unitTemplate.rank)}
                      compact
                    />
                  ) : (
                    <div className="flex aspect-[5/7] w-full flex-col items-center justify-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-center">
                      <span className="text-2xl">{row?.category === 'castle' ? '🏰' : '🏘️'}</span>
                      <span className="text-xs font-semibold">{row?.name ?? instance.template_id}</span>
                      <span className="text-[10px] text-zinc-500">{row?.rank}</span>
                    </div>
                  )}
                  {instance.status === 'in_transit' && (
                    <span className="text-[10px] text-zinc-500">na cestě</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
