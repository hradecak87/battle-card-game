'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  getMyMovements,
  getTerritoriesByIds,
  getMyActiveBattles,
  debugSpeedUpMovement,
  TroopMovement,
  TerritoryCoords,
  ActiveBattleRef,
} from '@/lib/territories/api'
import { formatEta } from '@/lib/time/formatEta'

export interface MyMovementsPanelProps {
  myPlayerId: string | null
  /** Bumped by the parent (e.g. after loadViewport) to trigger a refetch. */
  refreshKey?: number
}

const KIND_LABELS: Record<TroopMovement['kind'], string> = {
  claim: 'Zábor',
  transfer: 'Přesun',
  attack: 'Útok',
}

/**
 * "Moje probíhající akce" panel (design follow-up): lists every in-flight
 * claim/transfer/attack for the current player with an ETA, and once an
 * attack has actually arrived and a battle exists, swaps the ETA for a
 * direct link to the battle screen. Polls every 15s so ETAs count down
 * and arrivals flip over to "battle in progress" without a manual reload
 * (each poll's `getMyMovements()` call also triggers the server's lazy
 * `resolve_due_movements()`, so arrivals actually get processed).
 */
export default function MyMovementsPanel({ myPlayerId, refreshKey }: MyMovementsPanelProps) {
  const [movements, setMovements] = useState<TroopMovement[] | null>(null)
  const [coordsById, setCoordsById] = useState<Map<number, TerritoryCoords>>(new Map())
  const [battleByTerritoryId, setBattleByTerritoryId] = useState<Map<number, ActiveBattleRef>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [speedingUpId, setSpeedingUpId] = useState<string | null>(null)

  async function load(cancelledRef?: { current: boolean }) {
    const { data: movementRows, error: movementsError } = await getMyMovements()
    if (cancelledRef?.current) return
    if (movementsError) {
      setError(movementsError.message)
      return
    }
    setError(null)
    const rows = movementRows ?? []
    setMovements(rows)

    const territoryIds = Array.from(
      new Set(rows.flatMap((m) => [m.origin_territory_id, m.destination_territory_id]))
    )
    const [{ data: territoryRows }, { data: battleRows }] = await Promise.all([
      getTerritoriesByIds(territoryIds),
      getMyActiveBattles(myPlayerId as string),
    ])
    if (cancelledRef?.current) return
    setCoordsById(new Map((territoryRows ?? []).map((t) => [t.id, t])))
    setBattleByTerritoryId(new Map((battleRows ?? []).map((b) => [b.territory_id, b])))
  }

  useEffect(() => {
    if (!myPlayerId) return
    const cancelledRef = { current: false }

    load(cancelledRef)
    const interval = setInterval(() => load(cancelledRef), 15000)
    return () => {
      cancelledRef.current = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPlayerId, refreshKey])

  async function handleSpeedUp(movementId: string) {
    setSpeedingUpId(movementId)
    try {
      const { error: speedUpError } = await debugSpeedUpMovement(movementId)
      if (speedUpError) {
        setError(speedUpError.message)
        return
      }
      await load()
    } finally {
      setSpeedingUpId(null)
    }
  }

  if (!myPlayerId) return null
  if (movements !== null && movements.length === 0) return null

  return (
    <div className="w-full rounded border border-zinc-800 p-4">
      <h2 className="mb-2 text-sm font-bold text-zinc-300">Moje probíhající akce</h2>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {movements === null ? (
        <p className="text-sm text-zinc-400">Načítám…</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {movements.map((m) => {
            const origin = coordsById.get(m.origin_territory_id)
            const destination = coordsById.get(m.destination_territory_id)
            const battle = battleByTerritoryId.get(m.destination_territory_id)
            return (
              <li key={m.id} className="flex items-center justify-between text-sm text-zinc-300">
                <span>
                  <span className="font-semibold">{KIND_LABELS[m.kind]}</span>{' '}
                  {origin ? `(${origin.x}, ${origin.y})` : '?'} →{' '}
                  {destination ? `(${destination.x}, ${destination.y})` : '?'}
                </span>
                {battle ? (
                  <Link href={`/battles/${battle.id}`} className="text-red-400 underline">
                    Bitva probíhá →
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 text-zinc-400">
                    {formatEta(
                      m.kind === 'claim' && destination?.claim_occupation_completes_at
                        ? destination.claim_occupation_completes_at
                        : m.transfer_arrives_at
                    )}
                    <button
                      type="button"
                      onClick={() => handleSpeedUp(m.id)}
                      disabled={speedingUpId === m.id}
                      title="Testovací zkratka: zkrátí zbývající čas na ~10s"
                      className="rounded border border-zinc-600 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {speedingUpId === m.id ? '…' : '⏩ 10s (test)'}
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
