'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  getMovementCards,
  getMyCardInstances,
  getScoutMovementReport,
  sendScoutPeek,
  type MovementCard,
  type ScoutReportSnapshotCard,
} from '@/lib/territories/api'
import { formatEta } from '@/lib/time/formatEta'
import type { MapMovementArrow } from '@/lib/territories/useMapMovementArrows'
import { TradingCard } from '@/components/cards/TradingCard'
import { CardZoomIconButton, CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'

export interface MovementDetailModalProps {
  arrow: MapMovementArrow
  onClose: () => void
  onNavigateToTerritory: (x: number, y: number) => void
}

function titleForArrow(arrow: MapMovementArrow) {
  if (arrow.category === 'incoming') return 'Příchozí útok'
  if (arrow.category === 'ally-incoming') return 'Příchozí útok na spojence'
  if (arrow.movementKind === 'transfer') return 'Přesun vojsk'
  if (arrow.movementKind === 'claim') return 'Zábor území'
  if (arrow.movementKind === 'loan') return 'Půjčka vojsk'
  return 'Útočící vojska'
}

function labelForPoint(name: string | null | undefined, x: number, y: number) {
  return name ? `${name} (${x}, ${y})` : `(${x}, ${y})`
}

function formatUnitType(unitType: string | null | undefined) {
  if (!unitType) return 'neznámý typ'
  const labels: Record<string, string> = {
    archers: 'Lučištníci',
    cavalry: 'Jízda',
    infantry: 'Pěchota',
    spearmen: 'Kopiníci',
  }
  return labels[unitType] ?? unitType
}

function formatRank(rank: string | null | undefined) {
  const labels: Record<string, string> = {
    common: 'běžná',
    uncommon: 'neobvyklá',
    rare: 'vzácná',
    epic: 'epická',
    legend: 'legendární',
  }
  return rank ? (labels[rank] ?? rank) : 'neznámá'
}

function allyIdentityLabel(arrow: MapMovementArrow) {
  if (!('allyPlayerId' in arrow)) return null
  const name = arrow.allyIsNpc ? 'NPC spojenec' : arrow.allyDisplayName ?? 'Neznámý spojenec'
  return arrow.allyKingdomName ? `Spojenec: ${name} (${arrow.allyKingdomName})` : `Spojenec: ${name}`
}

/** Rebuilds the `UnitCardTemplate` shape `TradingCard` expects from the flat DB row (mirrors TransferModal/GarrisonModal). */
function toUnitTemplate(row: NonNullable<MovementCard['card_templates']>): UnitCardTemplate | null {
  if (row.category !== 'unit' || !row.base_stats || !row.unit_type) return null
  return {
    id: row.id,
    category: 'unit',
    unitType: row.unit_type as UnitType,
    rank: row.rank as Rank,
    name: row.name ?? 'Neznámá karta',
    flavorText: row.flavor_text ?? '',
    baseStats: row.base_stats,
    totalSupply: row.total_supply,
  }
}

export default function MovementDetailModal({ arrow, onClose, onNavigateToTerritory }: MovementDetailModalProps) {
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()
  const [cards, setCards] = useState<MovementCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [availableScoutIds, setAvailableScoutIds] = useState<string[]>([])
  const [scoutReport, setScoutReport] = useState<{ captured_at: string; expires_at: string; snapshot: ScoutReportSnapshotCard[] } | null>(null)
  const [scoutSending, setScoutSending] = useState(false)
  const [scoutError, setScoutError] = useState<string | null>(null)

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if ((arrow.category === 'incoming' || arrow.category === 'ally-incoming') || !arrow.movementId) {
      setCards(null)
      setError(null)
      return
    }

    let cancelled = false
    setCards(null)
    setError(null)

    getMovementCards(arrow.movementId).then(({ data, error: cardsError }) => {
      if (cancelled) return
      if (cardsError) {
        setError(cardsError.message)
        return
      }
      setCards(data ?? [])
    })

    return () => {
      cancelled = true
    }
  }, [arrow])

  useEffect(() => {
    if (arrow.category !== 'incoming') {
      setAvailableScoutIds([])
      setScoutReport(null)
      return
    }

    let cancelled = false
    getMyCardInstances('self').then(({ data }) => {
      if (cancelled) return
      setAvailableScoutIds(
        (data ?? [])
          .filter((instance) => instance.status === 'stationed' && instance.card_templates?.category === 'scout')
          .map((instance) => instance.instance_id)
      )
    })
    getScoutMovementReport(arrow.id.replace(/^incoming-/, '')).then(({ data }) => {
      if (cancelled) return
      setScoutReport(data ? { captured_at: data.captured_at, expires_at: data.expires_at, snapshot: data.snapshot } : null)
    })

    return () => {
      cancelled = true
    }
  }, [arrow])

  const etaText = useMemo(() => formatEta(arrow.arrivesAt, now), [arrow.arrivesAt, now])

  function snapshotToUnitTemplate(card: ScoutReportSnapshotCard): UnitCardTemplate | null {
    if (card.category !== 'unit' || !card.base_stats || !card.unit_type || !card.name) return null
    return {
      id: card.template_id,
      category: 'unit',
      unitType: card.unit_type as UnitType,
      rank: card.rank as Rank,
      name: card.name,
      flavorText: card.flavor_text ?? '',
      baseStats: card.base_stats,
      totalSupply: card.total_supply ?? null,
    }
  }

  async function handleScoutPeek() {
    if (arrow.category !== 'incoming' || availableScoutIds.length === 0) return
    setScoutSending(true)
    setScoutError(null)
    const movementId = arrow.id.replace(/^incoming-/, '')
    const { error: sendError } = await sendScoutPeek(movementId, availableScoutIds[0])
    setScoutSending(false)
    if (sendError) {
      setScoutError(sendError.message)
    }
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-4 sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Zavřít detail pohybu"
          onClick={onClose}
          className="absolute right-2 top-2 rounded-full px-3 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          ✕
        </button>

        <div className="mb-4 pr-10">
          <h2 className="text-lg font-bold text-zinc-100">{titleForArrow(arrow)}</h2>
          <p className="text-sm text-zinc-400">Dorazí {etaText}</p>
        </div>

        {arrow.category === 'incoming' || arrow.category === 'ally-incoming' ? (
          <div className="flex flex-col gap-4 text-sm text-zinc-200">
            {allyIdentityLabel(arrow) && (
              <div className="rounded-lg border border-cyan-900/70 bg-cyan-950/30 p-3">
                <p className="font-semibold text-cyan-200">{allyIdentityLabel(arrow)}</p>
              </div>
            )}

            <div className="rounded-lg border border-fuchsia-900/70 bg-fuchsia-950/30 p-3">
              <p className="font-semibold text-fuchsia-200">
                {arrow.attackerIsNpc ? 'NPC říše' : arrow.attackerDisplayName ?? 'Neznámý útočník'}
              </p>
              {arrow.attackerKingdomName && (
                <p className="text-zinc-300">Království: {arrow.attackerKingdomName}</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  onNavigateToTerritory(arrow.destX, arrow.destY)
                  onClose()
                }}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left hover:border-zinc-600"
              >
                <span className="block text-xs uppercase tracking-wide text-zinc-500">Napadené území</span>
                <span className="block text-sm font-semibold text-zinc-100">
                  {labelForPoint(arrow.destinationName, arrow.destX, arrow.destY)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onNavigateToTerritory(arrow.originX, arrow.originY)
                  onClose()
                }}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left hover:border-zinc-600"
              >
                <span className="block text-xs uppercase tracking-wide text-zinc-500">Domov útočníka</span>
                <span className="block text-sm font-semibold text-zinc-100">
                  {labelForPoint(null, arrow.originX, arrow.originY)}
                </span>
              </button>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-zinc-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  {scoutReport ? 'Zvěd odhalil složení útočící armády.' : 'Složení útočící armády zůstává skryté do začátku bitvy.'}
                </p>
                <button
                  type="button"
                  disabled={scoutSending || availableScoutIds.length === 0}
                  onClick={handleScoutPeek}
                  className="rounded bg-amber-700 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {scoutSending ? 'Vysílám…' : `Vyslat zvěda (${availableScoutIds.length} ks)`}
                </button>
              </div>
              {scoutError && <p className="mt-2 text-red-400">{scoutError}</p>}
              {scoutReport && (
                <>
                  <p data-testid="movement-scout-report-meta" className="mt-2 text-xs text-zinc-400">
                    Zvěd hlásí od {new Date(scoutReport.captured_at).toLocaleString('cs-CZ')} · platí do{' '}
                    {new Date(scoutReport.expires_at).toLocaleString('cs-CZ')}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {scoutReport.snapshot.map((card, index) => {
                      const unitTemplate = snapshotToUnitTemplate(card)
                      if (!unitTemplate) return null
                      const stats = applyRank(unitTemplate.baseStats, unitTemplate.rank)
                      return (
                        <div key={`${card.template_id}-${index}`} className="relative flex flex-col items-center gap-1">
                          <TradingCard template={unitTemplate} stats={stats} compact />
                          <CardZoomIconButton
                            cardName={unitTemplate.name}
                            className="absolute right-2 top-2"
                            onClick={() => openZoom(unitTemplate, stats)}
                          />
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm text-zinc-200">
            {allyIdentityLabel(arrow) && (
              <div className="rounded-lg border border-cyan-900/70 bg-cyan-950/30 p-3">
                <p className="font-semibold text-cyan-200">{allyIdentityLabel(arrow)}</p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  onNavigateToTerritory(arrow.originX, arrow.originY)
                  onClose()
                }}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left hover:border-zinc-600"
              >
                <span className="block text-xs uppercase tracking-wide text-zinc-500">Původ</span>
                <span className="block text-sm font-semibold text-zinc-100">
                  {labelForPoint(arrow.originName, arrow.originX, arrow.originY)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onNavigateToTerritory(arrow.destX, arrow.destY)
                  onClose()
                }}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left hover:border-zinc-600"
              >
                <span className="block text-xs uppercase tracking-wide text-zinc-500">Cíl</span>
                <span className="block text-sm font-semibold text-zinc-100">
                  {labelForPoint(arrow.destinationName, arrow.destX, arrow.destY)}
                </span>
              </button>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <h3 className="mb-2 font-semibold text-zinc-100">Karty v pohybu</h3>
              {error ? (
                <p className="text-red-400">{error}</p>
              ) : cards === null ? (
                <p className="text-zinc-400">Načítám složení armády…</p>
              ) : cards.length === 0 ? (
                <p className="text-zinc-400">V tomto pohybu nejsou žádné karty.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {cards.map((card) => {
                    const unitTemplate = card.card_templates ? toUnitTemplate(card.card_templates) : null
                    if (!unitTemplate) {
                      return (
                        <div
                          key={card.instance_id}
                          className="flex aspect-[5/7] w-full flex-col items-center justify-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-center"
                        >
                          <p className="text-xs font-medium text-zinc-100">
                            {card.card_templates?.name ?? 'Neznámá karta'}
                          </p>
                          <p className="text-[10px] text-zinc-400">
                            {formatUnitType(card.card_templates?.unit_type)} • {formatRank(card.card_templates?.rank)}
                          </p>
                        </div>
                      )
                    }
                    const stats = applyRank(unitTemplate.baseStats, unitTemplate.rank)
                    return (
                      <div key={card.instance_id} className="relative flex flex-col items-center gap-1">
                        <TradingCard template={unitTemplate} stats={stats} compact />
                        <CardZoomIconButton
                          cardName={unitTemplate.name}
                          className="absolute right-2 top-2"
                          onClick={() => openZoom(unitTemplate, stats)}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
    </div>
  )
}
