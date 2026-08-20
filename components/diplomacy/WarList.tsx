'use client'

import Link from 'next/link'
import type { DiplomacyWarRow } from '@/lib/diplomacy/types'

interface WarListProps {
  wars: DiplomacyWarRow[]
  pendingTargetIds?: string[]
  onPropose: (playerId: string) => void
}

function formatStartedAt(value: string) {
  return new Date(value).toLocaleString('cs-CZ')
}

export function WarList({ wars, pendingTargetIds = [], onPropose }: WarListProps) {
  if (wars.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
        Momentálně s nikým neválčíš.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {wars.map((war) => {
        const pending = pendingTargetIds.includes(war.other_player_id)
        return (
          <article
            key={war.other_player_id}
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-zinc-100">{war.other_player_display_name}</h3>
                <p className="text-sm text-zinc-400">
                  {war.other_kingdom_name ? `${war.other_kingdom_name} · ` : ''}
                  Válka od {formatStartedAt(war.war_started_at)}
                </p>
                {war.other_home_x != null && war.other_home_y != null ? (
                  <Link
                    href={`/map?x=${war.other_home_x}&y=${war.other_home_y}`}
                    className="text-sm text-amber-300 underline"
                  >
                    Domov ({war.other_home_x}, {war.other_home_y})
                  </Link>
                ) : (
                  <p className="text-sm text-zinc-500">Domovské souřadnice nejsou dostupné.</p>
                )}
              </div>

              <button
                type="button"
                disabled={pending}
                onClick={() => onPropose(war.other_player_id)}
                className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Nabídka čeká' : 'Navrhnout mír'}
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
