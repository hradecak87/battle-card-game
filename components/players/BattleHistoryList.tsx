'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getMyBattleHistory, type BattleHistoryEntry } from '@/lib/battles/api'

interface BattleHistoryListProps {
  playerId: string
}

function outcomeLabel(outcome: BattleHistoryEntry['outcome']) {
  switch (outcome) {
    case 'won':
      return 'Vyhráno'
    case 'lost':
      return 'Prohráno'
    default:
      return 'Vypršelo bez vítěze'
  }
}

function roleLabel(role: BattleHistoryEntry['role']) {
  return role === 'attacker' ? 'Útočník' : 'Obránce'
}

function territoryChangeLabel(change: BattleHistoryEntry['territory_change']) {
  switch (change) {
    case 'gained':
      return 'Území získáno'
    case 'lost':
      return 'Území ztraceno'
    default:
      return 'Území beze změny'
  }
}

function pluralize(count: number, one: string, few: string, many: string) {
  const mod100 = count % 100
  const mod10 = count % 10

  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

function troopSummary(gained: number, lost: number) {
  return `+${gained} ${pluralize(gained, 'vojsko', 'vojska', 'vojsk')} / -${lost} ${pluralize(
    lost,
    'vojsko',
    'vojska',
    'vojsk',
  )}`
}

function roundCountLabel(roundCount: number) {
  return `${roundCount} ${pluralize(roundCount, 'kolo', 'kola', 'kol')}`
}

function resolvedAtLabel(battle: BattleHistoryEntry) {
  return new Date(battle.resolved_at ?? battle.created_at).toLocaleString('cs-CZ')
}

export default function BattleHistoryList({ playerId }: BattleHistoryListProps) {
  const [history, setHistory] = useState<BattleHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadHistory() {
      const result = await getMyBattleHistory(playerId)
      if (cancelled) return
      setError(result.error?.message ?? null)
      setHistory(result.data ?? [])
    }

    loadHistory()

    return () => {
      cancelled = true
    }
  }, [playerId])

  return (
    <section className="w-full max-w-xl rounded-lg border border-zinc-800 p-6">
      <h2 className="text-lg font-bold">Historie bitev</h2>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {!error && history === null && <p className="mt-3 text-sm text-zinc-400">Načítám historii bitev…</p>}

      {!error && history?.length === 0 && (
        <p className="mt-3 text-sm text-zinc-400">Zatím jsi neodehrál žádnou uzavřenou bitvu.</p>
      )}

      {!error && history && history.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {history.map((battle) => (
            <li key={battle.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">
                    Území ({battle.territory?.x ?? '?'}, {battle.territory?.y ?? '?'})
                  </p>
                  <p className="text-sm text-zinc-400">{resolvedAtLabel(battle)}</p>
                </div>
                <Link
                  href={`/battles/${battle.id}`}
                  aria-label={`Detail bitvy ${battle.id}`}
                  className="text-sm underline text-zinc-300 hover:text-zinc-100"
                >
                  Detail bitvy →
                </Link>
              </div>

              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  <span className="text-zinc-500">Role:</span> {roleLabel(battle.role)}
                </p>
                <p>
                  <span className="text-zinc-500">Protivník:</span> {battle.opponent_name}
                </p>
                <p>
                  <span className="text-zinc-500">Výsledek:</span> {outcomeLabel(battle.outcome)}
                </p>
                <p>
                  <span className="text-zinc-500">Kola:</span> {roundCountLabel(battle.round_count)}
                </p>
                <p>
                  <span className="text-zinc-500">Zisky / ztráty:</span> {troopSummary(battle.troops_gained, battle.troops_lost)}
                </p>
                <p>{territoryChangeLabel(battle.territory_change)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
