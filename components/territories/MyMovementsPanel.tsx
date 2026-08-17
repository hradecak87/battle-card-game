'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  getMyMovements,
  getTerritoriesByIds,
  getMyActiveBattles,
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

  useEffect(() => {
    if (!myPlayerId) return
    let cancelled = false

    async function load() {
      const { data: movementRows, error: movementsError } = await getMyMovements()
      if (cancelled) return
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
      if (cancelled) return
      setCoordsById(new Map((territoryRows ?? []).map((t) => [t.id, t])))
      setBattleByTerritoryId(new Map((battleRows ?? []).map((b) => [b.territory_id, b])))
    }

    load()
    const interval = setInterval(load, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [myPlayerId, refreshKey])

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
                  <span className="text-zinc-400">
                    {formatEta(
                      m.kind === 'claim' && destination?.claim_occupation_completes_at
                        ? destination.claim_occupation_completes_at
                        : m.transfer_arrives_at
                    )}
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
