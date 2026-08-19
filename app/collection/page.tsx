'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/supabase/useSession'
import { getMyCardInstances, MyCardInstance } from '@/lib/territories/api'
import { applyRank } from '@/lib/cards/combat'
import { RANKS, Rank, UNIT_TYPES, UnitType } from '@/lib/cards/types'
import { TradingCard } from '@/components/cards/TradingCard'
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
const IN_TRANSIT = 'in_transit'
type LocationFilter = typeof IN_TRANSIT | 'all' | number

function locationLabel(card: MyCardInstance): string {
  if (card.status === 'in_transit' || !card.territories) return 'Na cestě'
  const t = card.territories
  return t.is_home ? `Domov (${t.x}, ${t.y})` : `Území (${t.x}, ${t.y})`
}

/**
 * "Moje sbírka" (spec follow-up) — every card instance the current player
 * owns, with rank/type/location filters and a name search, as opposed to
 * /catalog which shows every template in the game regardless of
 * ownership. Location comes from the joined `territories` row (or
 * "Na cestě" while `status = 'in_transit'`).
 */
export default function MyCollectionPage() {
  const router = useRouter()
  const { user, loading } = useSession()
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()

  const [instances, setInstances] = useState<MyCardInstance[] | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [unitTypeFilter, setUnitTypeFilter] = useState<UnitTypeFilter>('all')
  const [rankFilter, setRankFilter] = useState<RankFilter>('all')
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push('/login')
      return
    }
    getMyCardInstances(user.id).then(({ data, error }) => {
      if (error) {
        setFetchError(error.message)
        return
      }
      setInstances(data ?? [])
    })
  }, [loading, user, router])

  const locationOptions = useMemo(() => {
    if (!instances) return []
    const byTerritory = new Map<number, { id: number; x: number; y: number; is_home: boolean }>()
    let hasInTransit = false
    for (const card of instances) {
      if (card.status === 'in_transit' || !card.territories) {
        hasInTransit = true
        continue
      }
      byTerritory.set(card.territories.id, card.territories)
    }
    const options: { value: LocationFilter; label: string }[] = Array.from(byTerritory.values())
      .sort((a, b) => (a.is_home === b.is_home ? a.x - b.x || a.y - b.y : a.is_home ? -1 : 1))
      .map((t) => ({ value: t.id, label: t.is_home ? `Domov (${t.x}, ${t.y})` : `Území (${t.x}, ${t.y})` }))
    if (hasInTransit) options.push({ value: IN_TRANSIT, label: 'Na cestě' })
    return options
  }, [instances])

  const filtered = useMemo(() => {
    if (!instances) return []
    const query = search.trim().toLowerCase()
    return instances.filter((card) => {
      const template = card.card_templates
      if (!template || template.category !== 'unit' || !template.base_stats || !template.unit_type) return false
      if (unitTypeFilter !== 'all' && template.unit_type !== unitTypeFilter) return false
      if (rankFilter !== 'all' && template.rank !== rankFilter) return false
      if (locationFilter !== 'all') {
        if (locationFilter === IN_TRANSIT) {
          if (card.status !== 'in_transit') return false
        } else if (card.stationed_territory_id !== locationFilter) {
          return false
        }
      }
      if (query && !template.name.toLowerCase().includes(query)) return false
      return true
    })
  }, [instances, unitTypeFilter, rankFilter, locationFilter, search])

  if (loading || !user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p className="text-zinc-400">Načítám…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <Link href="/catalog" className="underline text-sm text-zinc-400 hover:text-zinc-200">
        Katalog všech karet →
      </Link>
      <h1 className="text-2xl font-bold mb-1 mt-2">Moje sbírka</h1>

      {fetchError && <p className="text-red-400 text-sm mb-4">{fetchError}</p>}

      {instances && (
        <p className="text-sm text-zinc-400 mb-6">
          {filtered.length} z {instances.length} karet
        </p>
      )}

      <div className="flex flex-wrap gap-4 mb-8">
        <label className="flex flex-col gap-1 text-sm">
          Hledat
          <input
            type="text"
            aria-label="Hledat kartu podle názvu"
            placeholder="Název karty…"
            className="bg-zinc-800 text-zinc-100 rounded px-3 py-2 min-w-[10rem]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

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

        <label className="flex flex-col gap-1 text-sm">
          Oblast
          <select
            aria-label="Oblast"
            className="bg-zinc-800 text-zinc-100 rounded px-3 py-2 min-w-[10rem]"
            value={String(locationFilter)}
            onChange={(e) => {
              const v = e.target.value
              setLocationFilter(v === 'all' || v === IN_TRANSIT ? (v as LocationFilter) : Number(v))
            }}
          >
            <option value="all">Vše</option>
            {locationOptions.map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {instances && instances.length === 0 && (
        <p className="text-zinc-400 text-sm">Zatím nevlastníš žádné karty vojsk.</p>
      )}

      <ul className="grid grid-cols-3 gap-2 sm:gap-4 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {filtered.map((card) => {
          const template = card.card_templates!
          const zoomTemplate = {
            id: template.id,
            category: 'unit' as const,
            unitType: template.unit_type as UnitType,
            rank: template.rank as Rank,
            name: template.name,
            flavorText: template.flavor_text,
            baseStats: template.base_stats!,
            totalSupply: template.total_supply,
          }
          const stats = applyRank(template.base_stats!, template.rank as Rank)
          return (
            <li key={card.instance_id} className="flex flex-col gap-1">
              <button
                type="button"
                aria-label={`Zvětšit kartu ${template.name}`}
                onClick={() => openZoom(zoomTemplate, stats)}
                className="group relative block w-full cursor-pointer rounded-xl text-left transition hover:scale-[1.02]"
              >
                <TradingCard template={zoomTemplate} stats={stats} />
                <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white shadow-sm">
                  🔍
                </span>
              </button>
              <p data-testid="card-location" className="text-center text-[11px] text-zinc-500">
                {locationLabel(card)}
              </p>
            </li>
          )
        })}
      </ul>
      <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
    </main>
  )
}
