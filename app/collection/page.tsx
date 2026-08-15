'use client'

import { useMemo, useState } from 'react'
import { getAllTemplates } from '@/lib/cards/catalog'
import { applyRank } from '@/lib/cards/combat'
import { RANKS, Rank, UNIT_TYPES, UnitType } from '@/lib/cards/types'
import { TradingCard } from '@/components/cards/TradingCard'

const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  archers: 'Lučištníci',
  crossbowmen: 'Kušiníci',
  spearmen: 'Oštěpníci',
  swordsmen: 'Šermíři',
  halberdiers: 'Halapartníci',
  knights: 'Rytíři',
  lightCavalry: 'Lehká jízda',
  siegeEngines: 'Obléhací stroje',
}

const RANK_LABELS: Record<Rank, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legend: 'Legend',
}

type UnitTypeFilter = UnitType | 'all'
type RankFilter = Rank | 'all'

export default function CollectionPage() {
  const [unitTypeFilter, setUnitTypeFilter] = useState<UnitTypeFilter>('all')
  const [rankFilter, setRankFilter] = useState<RankFilter>('all')

  const allTemplates = useMemo(() => getAllTemplates(), [])

  const filtered = useMemo(() => {
    return allTemplates.filter((t) => {
      if (unitTypeFilter !== 'all' && t.unitType !== unitTypeFilter) return false
      if (rankFilter !== 'all' && t.rank !== rankFilter) return false
      return true
    })
  }, [allTemplates, unitTypeFilter, rankFilter])

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <h1 className="text-2xl font-bold mb-1">Sbírka karet</h1>
      <p className="text-sm text-zinc-400 mb-6">
        {filtered.length} z {allTemplates.length} karet
      </p>

      <div className="flex flex-wrap gap-4 mb-8">
        <label className="flex flex-col gap-1 text-sm">
          Typ vojska
          <select
            aria-label="Typ vojska"
            className="bg-zinc-800 text-zinc-100 rounded px-3 py-2 min-w-[10rem]"
            value={unitTypeFilter}
            onChange={(e) => setUnitTypeFilter(e.target.value as UnitTypeFilter)}
          >
            <option value="all">Vše</option>
            {UNIT_TYPES.map((ut) => (
              <option key={ut} value={ut}>
                {UNIT_TYPE_LABELS[ut]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Rank
          <select
            aria-label="Rank"
            className="bg-zinc-800 text-zinc-100 rounded px-3 py-2 min-w-[10rem]"
            value={rankFilter}
            onChange={(e) => setRankFilter(e.target.value as RankFilter)}
          >
            <option value="all">Vše</option>
            {RANKS.map((r) => (
              <option key={r} value={r}>
                {RANK_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {filtered.map((t) => (
          <li key={t.id}>
            <TradingCard template={t} stats={applyRank(t.baseStats, t.rank)} />
          </li>
        ))}
      </ul>
    </main>
  )
}
