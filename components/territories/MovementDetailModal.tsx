'use client'

import { useEffect, useMemo, useState } from 'react'
import { getMovementCards, type MovementCard } from '@/lib/territories/api'
import { formatEta } from '@/lib/time/formatEta'
import type { MapMovementArrow } from '@/lib/territories/useMapMovementArrows'

export interface MovementDetailModalProps {
  arrow: MapMovementArrow
  onClose: () => void
  onNavigateToTerritory: (x: number, y: number) => void
}

function titleForArrow(arrow: MapMovementArrow) {
  if (arrow.category === 'incoming') return 'Příchozí útok'
  if (arrow.movementKind === 'transfer') return 'Přesun vojsk'
  if (arrow.movementKind === 'claim') return 'Zábor území'
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

export default function MovementDetailModal({ arrow, onClose, onNavigateToTerritory }: MovementDetailModalProps) {
  const [cards, setCards] = useState<MovementCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (arrow.category === 'incoming' || !arrow.movementId) {
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

  const etaText = useMemo(() => formatEta(arrow.arrivesAt, now), [arrow.arrivesAt, now])

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

        {arrow.category === 'incoming' ? (
          <div className="flex flex-col gap-4 text-sm text-zinc-200">
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
              Složení útočící armády zůstává skryté do začátku bitvy.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm text-zinc-200">
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
                <ul className="space-y-2">
                  {cards.map((card) => (
                    <li key={card.instance_id} className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                      <p className="font-medium text-zinc-100">
                        {card.card_templates?.name ?? 'Neznámá karta'}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {formatUnitType(card.card_templates?.unit_type)} • {formatRank(card.card_templates?.rank)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
