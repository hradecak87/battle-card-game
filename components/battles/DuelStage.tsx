'use client'

import { useEffect, useState } from 'react'
import { BattleCard, BattleCardTemplate } from '@/lib/battles/api'
import { TradingCard } from '@/components/cards/TradingCard'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'

export interface DuelStageProps {
  attackerCard: BattleCard | null
  defenderCard: BattleCard | null
  roundNumber: number
  roundDeadline: string | null
  score: { attacker: number; defender: number }
  lastWinnerSide: 'attacker' | 'defender' | null
}

export function toUnitTemplate(t: BattleCardTemplate): UnitCardTemplate | null {
  if (t.category !== 'unit' || !t.base_stats || !t.unit_type) return null
  return {
    id: t.id,
    category: 'unit',
    unitType: t.unit_type as UnitType,
    rank: t.rank as Rank,
    name: t.name,
    flavorText: t.flavor_text,
    baseStats: t.base_stats,
    totalSupply: t.total_supply,
  }
}


function useCountdown(deadline: string | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (!deadline) {
      setRemaining(null)
      return
    }
    const target = new Date(deadline).getTime()
    function tick() {
      setRemaining(Math.max(0, Math.round((target - Date.now()) / 1000)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])

  return remaining
}

/**
 * Center duel stage (Task 18): the current round's two `TradingCard`s
 * facing off, the round countdown (defender's 120s pick window, PvP
 * only), and the running per-side score.
 */
export default function DuelStage({
  attackerCard,
  defenderCard,
  roundNumber,
  roundDeadline,
  score,
  lastWinnerSide,
}: DuelStageProps) {
  const remaining = useCountdown(roundDeadline)
  const attackerTemplate = attackerCard ? toUnitTemplate(attackerCard.template) : null
  const defenderTemplate = defenderCard ? toUnitTemplate(defenderCard.template) : null

  return (
    <div data-testid="duel-stage" className="flex flex-col items-center gap-3">
      <p className="text-sm text-zinc-400">Kolo {roundNumber}</p>

      <div className="flex items-center gap-6 text-lg font-bold">
        <span className={lastWinnerSide === 'attacker' ? 'text-amber-400' : ''}>{score.attacker}</span>
        <span className="text-zinc-500">:</span>
        <span className={lastWinnerSide === 'defender' ? 'text-amber-400' : ''}>{score.defender}</span>
      </div>

      {remaining !== null && (
        <p data-testid="round-countdown" className="text-sm text-red-400">
          Čas na výběr obránce: {remaining}s
        </p>
      )}

      <div className="flex items-center gap-4">
        <div className="w-32">
          {attackerTemplate ? (
            <TradingCard
              template={attackerTemplate}
              stats={applyRank(attackerTemplate.baseStats, attackerTemplate.rank)}
              compact
            />
          ) : (
            <div className="flex aspect-[5/7] w-full items-center justify-center rounded-xl border border-dashed border-zinc-700 text-xs text-zinc-500">
              —
            </div>
          )}
        </div>

        <span className="text-2xl">⚔️</span>

        <div className="w-32">
          {defenderTemplate ? (
            <TradingCard
              template={defenderTemplate}
              stats={applyRank(defenderTemplate.baseStats, defenderTemplate.rank)}
              compact
            />
          ) : (
            <div className="flex aspect-[5/7] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-700 p-2 text-center text-xs text-zinc-500">
              Čeká se na výběr obránce…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
