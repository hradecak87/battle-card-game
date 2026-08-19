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

function outcomeBadgeClass(outcome: BattleHistoryEntry['outcome']) {
  switch (outcome) {
    case 'won':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    case 'lost':
      return 'border-red-500/40 bg-red-500/10 text-red-300'
    default:
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200'
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

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

  function toggleBattleDetails(battleId: string) {
    setExpandedIds((current) => {
      const next = new Set(current)

      if (next.has(battleId)) {
        next.delete(battleId)
      } else {
        next.add(battleId)
      }

      return next
    })
  }

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
          {history.map((battle) => {
            const isOpen = expandedIds.has(battle.id)
            const detailsId = `battle-history-details-${battle.id}`

            return (
              <li key={battle.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={detailsId}
                  data-testid={`battle-history-row-${battle.id}`}
                  onClick={() => toggleBattleDetails(battle.id)}
                  className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-zinc-900/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                    <p className="font-semibold">{battle.opponent_name}</p>
                    <p className="text-sm text-zinc-400">{roleLabel(battle.role)}</p>
                    <span
                      className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${outcomeBadgeClass(battle.outcome)}`}
                    >
                      {outcomeLabel(battle.outcome)}
                    </span>
                  </div>
                  <p className="shrink-0 text-sm text-zinc-400">{resolvedAtLabel(battle)}</p>
                </button>

                {isOpen && (
                  <div
                    id={detailsId}
                    data-testid={detailsId}
                    className="border-t border-zinc-800 px-4 pb-4 pt-3"
                  >
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-zinc-500">Území:</span> ({battle.territory?.x ?? '?'}, {battle.territory?.y ?? '?'})
                      </p>
                      <p>
                        <span className="text-zinc-500">Kola:</span> {roundCountLabel(battle.round_count)}
                      </p>
                      <p>
                        <span className="text-zinc-500">Zisky / ztráty:</span>{' '}
                        {troopSummary(battle.troops_gained, battle.troops_lost)}
                      </p>
                      <p>{territoryChangeLabel(battle.territory_change)}</p>
                    </div>

                    <Link
                      href={`/battles/${battle.id}`}
                      aria-label={`Detail bitvy ${battle.id}`}
                      className="mt-3 inline-flex text-sm underline text-zinc-300 hover:text-zinc-100"
                    >
                      Detail bitvy →
                    </Link>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
