'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/supabase/useSession'
import {
  getMyCardInstances,
  MyCardInstance,
  returnCardToPool,
  withdrawFromDeposit,
} from '@/lib/territories/api'
import { applyRank } from '@/lib/cards/combat'
import { BoostCardTemplate, RANKS, Rank, UNIT_TYPES, UnitType } from '@/lib/cards/types'
import { TradingCard } from '@/components/cards/TradingCard'
import { CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import { VisibleBoostCardTile } from '@/components/cards/BoostCardTile'
import { boostEffectSummary } from '@/lib/cards/boosts'
import { levelForXp } from '@/lib/players/leveling'
import { deckLimit } from '@/lib/players/cardLimit'
import { formatEta } from '@/lib/time/formatEta'

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
type CategoryFilter = 'all' | 'unit' | 'boost'
const IN_TRANSIT = 'in_transit'
type LocationFilter = typeof IN_TRANSIT | 'all' | number

function locationLabel(card: MyCardInstance): string {
  if (card.status === 'deposit') return 'V depozitu'
  if (card.status === 'in_transit' || !card.territories) return 'Na cestě'
  const t = card.territories
  return t.is_home ? `Domov (${t.x}, ${t.y})` : `Území (${t.x}, ${t.y})`
}

function returnConfirmCopy(rank: string): string {
  return rank === 'common' || rank === 'uncommon'
    ? 'Tato karta zanikne a už se ti nevrátí.'
    : 'Tato karta se vrátí do oběhu a může znovu padnout někomu jinému.'
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
  const { user, player, loading } = useSession()
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()

  const [instances, setInstances] = useState<MyCardInstance[] | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [confirmingReturnId, setConfirmingReturnId] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const [unitTypeFilter, setUnitTypeFilter] = useState<UnitTypeFilter>('all')
  const [rankFilter, setRankFilter] = useState<RankFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all')
  const [search, setSearch] = useState('')

  async function loadCards(currentUserId: string) {
    const { data, error } = await getMyCardInstances(currentUserId)
    if (error) {
      setFetchError(error.message)
      return
    }
    setFetchError(null)
    setInstances(data ?? [])
  }

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push('/login')
      return
    }
    void loadCards(user.id)
  }, [loading, user, router])

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  const locationOptions = useMemo(() => {
    if (!instances) return []
    const byTerritory = new Map<number, { id: number; x: number; y: number; is_home: boolean }>()
    let hasInTransit = false
    for (const card of instances) {
      if (card.status === 'deposit') continue
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
      if (card.status === 'deposit') return false
      const template = card.card_templates
      if (!template) return false
      if (categoryFilter !== 'all' && template.category !== categoryFilter) return false
      if (
        template.category === 'unit' &&
        (unitTypeFilter !== 'all' && template.unit_type !== unitTypeFilter)
      ) {
        return false
      }
      if (template.category === 'boost' && unitTypeFilter !== 'all') return false
      if (rankFilter !== 'all' && template.rank !== rankFilter) return false
      if (locationFilter !== 'all') {
        if (locationFilter === IN_TRANSIT) {
          if (card.status !== 'in_transit') return false
        } else if (card.stationed_territory_id !== locationFilter) {
          return false
        }
      }
      if (query && !(template.name ?? '').toLowerCase().includes(query)) return false
      return true
    })
  }, [instances, categoryFilter, unitTypeFilter, rankFilter, locationFilter, search])

  const depositCards = useMemo(
    () => (instances ?? []).filter((card) => card.status === 'deposit' && card.card_templates),
    [instances]
  )

  const currentLevel = levelForXp(player?.xp ?? 0)
  const currentDeckLimit = deckLimit(currentLevel)
  const deckCount = (instances ?? []).filter((card) => card.status !== 'deposit').length
  const deckHasRoom = deckCount < currentDeckLimit

  async function handleReturnCard(instanceId: string) {
    const { error } = await returnCardToPool(instanceId)
    if (error) {
      setFetchError(error.message)
      return
    }
    setConfirmingReturnId(null)
    if (user) await loadCards(user.id)
  }

  async function handleWithdraw(instanceId: string) {
    const { error } = await withdrawFromDeposit(instanceId)
    if (error) {
      setFetchError(error.message)
      return
    }
    if (user) await loadCards(user.id)
  }

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
        <div className="mb-6 space-y-1">
          <p className="text-sm text-zinc-400">
            {filtered.length} z {deckCount} karet
          </p>
          <p className="text-sm text-zinc-300">Balíček: {deckCount} / {currentDeckLimit}</p>
        </div>
      )}

      {depositCards.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">V depozitu ti čekají karty.</p>
          <p className="text-amber-50/85">
            Dokud si v balíčku neuděláš místo, další vyhrané karty můžou skončit rovnou zpět v centrální sadě.
          </p>
        </div>
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
          Kategorie
          <select
            aria-label="Kategorie"
            className="bg-zinc-800 text-zinc-100 rounded px-3 py-2 min-w-[10rem]"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
          >
            <option value="all">Vše</option>
            <option value="unit">Vojska</option>
            <option value="boost">Boost karty</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Typ vojska
          <select
            aria-label="Typ vojska"
            className="bg-zinc-800 text-zinc-100 rounded px-3 py-2 min-w-[10rem]"
            value={unitTypeFilter}
            onChange={(e) => setUnitTypeFilter(e.target.value as UnitTypeFilter)}
            disabled={categoryFilter === 'boost'}
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

      {depositCards.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-semibold">Depozit</h2>
          <ul className="grid grid-cols-3 gap-2 sm:gap-4 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
            {depositCards.map((card) => {
              const template = card.card_templates!
              if (
                template.category !== 'unit' ||
                !template.base_stats ||
                !template.unit_type ||
                !template.name ||
                template.flavor_text == null
              ) {
                return null
              }

              const zoomTemplate = {
                id: template.id,
                category: 'unit' as const,
                unitType: template.unit_type as UnitType,
                rank: template.rank as Rank,
                name: template.name,
                flavorText: template.flavor_text,
                baseStats: template.base_stats,
                totalSupply: template.total_supply,
              }
              const stats = applyRank(template.base_stats, template.rank as Rank)

              return (
                <li key={card.instance_id} className="flex flex-col gap-2">
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
                  <p className="text-center text-[11px] text-amber-200">
                    Vyprší {formatEta(card.deposit_expires_at ?? new Date(now).toISOString(), now)}
                  </p>
                  <button
                    type="button"
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!deckHasRoom}
                    onClick={() => void handleWithdraw(card.instance_id)}
                  >
                    Vyzvednout z depozitu
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <ul className="grid grid-cols-3 gap-2 sm:gap-4 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {filtered.map((card) => {
          const template = card.card_templates!
          if (template.category === 'boost') {
            const boostTemplate: BoostCardTemplate = {
              id: template.id,
              category: 'boost',
              rank: template.rank as Rank,
              name: template.name ?? card.template_id,
              flavorText: template.flavor_text ?? '',
              boostType: template.boost_type!,
              effectKind: template.effect_kind!,
              instantEffectKind: template.instant_effect_kind ?? null,
              pctStr: template.pct_str ?? null,
              pctLng: template.pct_lng ?? null,
              pctDef: template.pct_def ?? null,
              pctHp: template.pct_hp ?? null,
              totalSupply: template.total_supply,
            }
            return (
              <li key={card.instance_id} className="flex flex-col gap-1">
                <VisibleBoostCardTile template={boostTemplate} />
                <p className="text-center text-[11px] text-zinc-400">{boostEffectSummary(boostTemplate)}</p>
                <p data-testid="card-location" className="text-center text-[11px] text-zinc-500">
                  {locationLabel(card)}
                </p>
                {card.status === 'stationed' && (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100"
                      onClick={() => setConfirmingReturnId(card.instance_id)}
                    >
                      Vrátit do centrální sady
                    </button>
                    {confirmingReturnId === card.instance_id && (
                      <div className="rounded-lg border border-red-500/30 bg-zinc-900/70 p-3 text-xs text-zinc-200">
                        <p className="mb-2">{returnConfirmCopy(template.rank)}</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded bg-red-600 px-3 py-1 text-white"
                            onClick={() => void handleReturnCard(card.instance_id)}
                          >
                            Potvrdit vrácení karty
                          </button>
                          <button
                            type="button"
                            className="rounded border border-zinc-600 px-3 py-1"
                            onClick={() => setConfirmingReturnId(null)}
                          >
                            Zrušit vrácení karty
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </li>
            )
          }

          if (
            !template.base_stats ||
            !template.unit_type ||
            !template.name ||
            template.flavor_text == null
          ) {
            return null
          }
          const zoomTemplate = {
            id: template.id,
            category: 'unit' as const,
            unitType: template.unit_type as UnitType,
            rank: template.rank as Rank,
            name: template.name,
            flavorText: template.flavor_text,
            baseStats: template.base_stats,
            totalSupply: template.total_supply,
          }
          const stats = applyRank(template.base_stats, template.rank as Rank)
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
              {card.status === 'stationed' && (
                <>
                  <button
                    type="button"
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100"
                    onClick={() => setConfirmingReturnId(card.instance_id)}
                  >
                    Vrátit do centrální sady
                  </button>
                  {confirmingReturnId === card.instance_id && (
                    <div className="rounded-lg border border-red-500/30 bg-zinc-900/70 p-3 text-xs text-zinc-200">
                      <p className="mb-2">{returnConfirmCopy(template.rank)}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded bg-red-600 px-3 py-1 text-white"
                          onClick={() => void handleReturnCard(card.instance_id)}
                        >
                          Potvrdit vrácení karty
                        </button>
                        <button
                          type="button"
                          className="rounded border border-zinc-600 px-3 py-1"
                          onClick={() => setConfirmingReturnId(null)}
                        >
                          Zrušit vrácení karty
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
      <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
    </main>
  )
}
