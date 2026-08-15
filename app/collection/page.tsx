'use client'

import { useMemo, useState } from 'react'
import { getAllTemplates } from '@/lib/cards/catalog'
import { applyRank } from '@/lib/cards/combat'
import { RANKS, Rank, UNIT_TYPES, UnitType } from '@/lib/cards/types'

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

const RANK_BADGE_CLASSES: Record<Rank, string> = {
  common: 'bg-zinc-700 text-zinc-100',
  uncommon: 'bg-emerald-700 text-emerald-50',
  rare: 'bg-blue-700 text-blue-50',
  epic: 'bg-purple-700 text-purple-50',
  legend: 'bg-amber-600 text-amber-50',
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

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((t) => {
          const stats = applyRank(t.baseStats, t.rank)
          return (
            <li
              key={t.id}
              className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{t.name}</h2>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${RANK_BADGE_CLASSES[t.rank]}`}
                >
                  {RANK_LABELS[t.rank]}
                </span>
              </div>
              <p className="text-xs text-zinc-400">{UNIT_TYPE_LABELS[t.unitType]}</p>
              <p className="text-sm text-zinc-300 italic">{t.flavorText}</p>
              <dl className="grid grid-cols-4 gap-2 text-center text-xs mt-2">
                <div>
                  <dt className="text-zinc-500">STR</dt>
                  <dd className="font-mono font-semibold">{stats.str}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">LNG</dt>
                  <dd className="font-mono font-semibold">{stats.lng}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">DEF</dt>
                  <dd className="font-mono font-semibold">{stats.def}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">HP</dt>
                  <dd className="font-mono font-semibold">{stats.hp}</dd>
                </div>
              </dl>
              <p className="text-xs text-zinc-500 mt-1">
                {t.totalSupply === null ? 'Neomezeno' : `Existuje jen ${t.totalSupply}×`}
              </p>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
