'use client'

import { useState } from 'react'
import { BattleRoundRow, BattleCard } from '@/lib/battles/api'

export interface RoundHistoryProps {
  rounds: BattleRoundRow[]
  attackerRoster: BattleCard[]
  defenderPool: BattleCard[]
}

function historicalCardName(
  liveCardId: string | null,
  historicalCard: BattleRoundRow['attacker_card'] | BattleRoundRow['defender_card'],
  attackerRoster: BattleCard[],
  defenderPool: BattleCard[],
): string {
  if (historicalCard?.template.name) return historicalCard.template.name
  if (!liveCardId) return '—'

  const liveCard =
    attackerRoster.find((card) => card.instance_id === liveCardId) ??
    defenderPool.find((card) => card.instance_id === liveCardId)

  return liveCard?.template.name ?? 'Neznámá jednotka'
}

/**
 * Collapsible round-by-round history log (Task 18), reading the raw
 * `battle_rounds` rows returned by `get_battle`.
 */
export default function RoundHistory({ rounds, attackerRoster, defenderPool }: RoundHistoryProps) {
  const [open, setOpen] = useState(false)
  const resolved = rounds.filter((r) => r.skipped || r.defender_card_instance_id)

  return (
    <div data-testid="round-history" className="w-full max-w-2xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded bg-zinc-900 px-3 py-2 text-left text-sm font-semibold text-zinc-300"
      >
        {open ? '▾' : '▸'} Historie kol ({resolved.length})
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-zinc-400">
          {resolved.length === 0 && <li>Zatím žádná kola.</li>}
          {resolved.map((round) => (
            <li key={round.id} className="flex items-center justify-between rounded bg-zinc-900/50 px-2 py-1">
              <span>Kolo {round.round_number}</span>
              {round.skipped ? (
                <span className="text-zinc-500">přeskočeno (odpočinek)</span>
              ) : (
                <span>
                  {historicalCardName(round.attacker_card_instance_id, round.attacker_card, attackerRoster, defenderPool)} vs{' '}
                  {historicalCardName(round.defender_card_instance_id, round.defender_card, attackerRoster, defenderPool)} —{' '}
                  <span className="font-semibold text-amber-400">
                    {round.winner_card_instance_id === round.attacker_card_instance_id ? 'útočník' : 'obránce'}
                  </span>
                  {round.auto_picked && <span className="text-zinc-500"> (automatický výběr)</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
