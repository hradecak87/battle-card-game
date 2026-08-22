'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getAllTemplates } from '@/lib/cards/catalog'
import { getNonUnitCardTemplates } from '@/lib/cards/nonUnitTemplates'
import { applyRank } from '@/lib/cards/combat'
import { BoostCardTemplate, CardTemplate, RANKS, Rank, ScoutCardTemplate, StructureCardTemplate, UNIT_TYPES, UnitType } from '@/lib/cards/types'
import { TradingCard } from '@/components/cards/TradingCard'
import { NonUnitTradingCard } from '@/components/cards/NonUnitTradingCard'
import { CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'

const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  archers: 'Lučištníci',
  crossbowmen: 'Kušiníci',
  spearmen: 'Oštěpníci',
  swordsmen: 'Šermíři',
  halberdiers: 'Halapartníci',
  knights: 'Rytíři',
  lightCavalry: 'Lehká jízda',
  siegeEngines: 'Obléhací stroje',
  settlers: 'Osadníci',
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
  const [nonUnitTemplates, setNonUnitTemplates] = useState<(StructureCardTemplate | BoostCardTemplate | ScoutCardTemplate)[]>([])
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()

  const unitTemplates = useMemo(() => getAllTemplates(), [])

  useEffect(() => {
    let cancelled = false
    void getNonUnitCardTemplates().then((templates) => {
      if (!cancelled) setNonUnitTemplates(templates)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const allTemplates: CardTemplate[] = useMemo(
    () => [...unitTemplates, ...nonUnitTemplates],
    [unitTemplates, nonUnitTemplates]
  )

  const filtered = useMemo(() => {
    return allTemplates.filter((t) => {
      if (unitTypeFilter !== 'all') {
        if (t.category !== 'unit' || t.unitType !== unitTypeFilter) return false
      }
      if (rankFilter !== 'all' && t.rank !== rankFilter) return false
      return true
    })
  }, [allTemplates, unitTypeFilter, rankFilter])

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <Link href="/collection" className="underline text-sm text-zinc-400 hover:text-zinc-200">
        ← Moje sbírka
      </Link>
      <h1 className="text-2xl font-bold mb-1 mt-2">Katalog karet</h1>
      <p className="text-xs text-zinc-500 mb-1">Všechny karty ve hře (bez ohledu na vlastnictví)</p>
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
        {filtered.map((t) => {
          if (t.category === 'unit') {
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-label={`Zvětšit kartu ${t.name}`}
                  onClick={() => openZoom(t, applyRank(t.baseStats, t.rank))}
                  className="group relative block w-full cursor-pointer rounded-xl text-left transition hover:scale-[1.02]"
                >
                  <TradingCard template={t} stats={applyRank(t.baseStats, t.rank)} />
                  <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white shadow-sm">
                    🔍
                  </span>
                </button>
              </li>
            )
          }

          if (
            t.category === 'boost' ||
            t.category === 'castle' ||
            t.category === 'village' ||
            t.category === 'wall' ||
            t.category === 'scout'
          ) {
            return (
              <li key={t.id}>
                <NonUnitTradingCard template={t} />
              </li>
            )
          }

          return null
        })}
      </ul>
      <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
    </main>
  )
}
