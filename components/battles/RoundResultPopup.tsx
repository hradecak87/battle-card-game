'use client'

import { useEffect, useState } from 'react'
import { BattleRoundRow } from '@/lib/battles/api'
import { TradingCard } from '@/components/cards/TradingCard'
import { applyRank } from '@/lib/cards/combat'
import { toUnitTemplate } from './DuelStage'

export interface RoundResultPopupProps {
  round: BattleRoundRow
  onDismiss: () => void
}

const AUTO_DISMISS_SECONDS = 20

function useCountdownSeconds(seconds: number, onExpire: () => void, resetKey: string) {
  const [{ remaining, activeKey }, setCountdown] = useState({
    remaining: seconds,
    activeKey: resetKey,
  })

  useEffect(() => {
    setCountdown({ remaining: seconds, activeKey: resetKey })
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev.activeKey !== resetKey) return prev
        if (prev.remaining <= 1) return { remaining: 0, activeKey: prev.activeKey }
        return { remaining: prev.remaining - 1, activeKey: prev.activeKey }
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [seconds, resetKey])

  useEffect(() => {
    if (activeKey === resetKey && remaining === 0) onExpire()
  }, [activeKey, remaining, resetKey, onExpire])

  return remaining
}

function explanation(round: BattleRoundRow): string {
  const attackerNeverDealtDamage = round.attacker_ttk === null && round.attacker_dmg_dealt === 0
  const defenderNeverDealtDamage = round.defender_ttk === null && round.defender_dmg_dealt === 0
  const attackerWon = round.winner_card_instance_id === round.attacker_card_instance_id

  if (round.flavor_text) {
    return attackerWon
      ? 'Útočník zvítězil navzdory papírovým předpokladům.'
      : 'Obránce zvítězil navzdory papírovým předpokladům.'
  }
  if (attackerWon && defenderNeverDealtDamage) {
    return 'Útočník zvítězil beze ztrát — protivník ho vůbec nestihl zasáhnout.'
  }
  if (!attackerWon && attackerNeverDealtDamage) {
    return 'Obránce zvítězil beze ztrát — útočník ho vůbec nestihl zasáhnout.'
  }
  if (attackerWon) {
    return 'Útočník zvítězil, protože stihl soupeře zabít dřív (nižší čas na zabití).'
  }
  return 'Obránce zvítězil, protože stihl soupeře zabít dřív (nižší čas na zabití).'
}

function formatTtk(ttk: number | null): string {
  return ttk === null ? '∞' : ttk.toFixed(2)
}

function formatPercent(probability: number | null): string | null {
  return probability === null ? null : `${Math.round(probability * 100)} %`
}

/**
 * Modal shown after a round resolves (spec:
 * docs/superpowers/specs/2026-08-17-battle-round-result-popup-design.md).
 * Auto-dismisses after a visible 20s countdown, or immediately via the ✕
 * button. Renders a short "skipped" variant when `round.skipped` (no card
 * art/stats — matches the `_start_next_round` skip condition, which fires
 * when either side had no eligible card that round).
 */
export default function RoundResultPopup({ round, onDismiss }: RoundResultPopupProps) {
  const remaining = useCountdownSeconds(AUTO_DISMISS_SECONDS, onDismiss, round.id)

  const attackerTemplate = round.attacker_card ? toUnitTemplate(round.attacker_card.template) : null
  const defenderTemplate = round.defender_card ? toUnitTemplate(round.defender_card.template) : null

  return (
    <div
      data-testid="round-result-popup"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="relative w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5">
        <button
          type="button"
          data-testid="round-result-close"
          onClick={onDismiss}
          className="absolute right-3 top-3 text-zinc-400 hover:text-white"
          aria-label="Zavřít"
        >
          ✕
        </button>

        <p data-testid="round-result-countdown" className="mb-3 text-center text-xs text-zinc-500">
          Zavře se za {remaining}s
        </p>

        {round.skipped ? (
          <p className="py-6 text-center text-sm text-zinc-300">
            Kolo přeskočeno – všechny karty odpočívají.
          </p>
        ) : (
          <>
            <p className="mb-3 text-center text-sm text-zinc-400">Kolo {round.round_number}</p>
            {formatPercent(round.attacker_win_probability) && (
              <p data-testid="round-result-probability" className="mb-3 text-center text-xs text-sky-200">
                Šance útočníka na výhru: {formatPercent(round.attacker_win_probability)}
              </p>
            )}
            {round.flavor_text && (
              <p
                data-testid="round-result-upset"
                className="mb-3 rounded-lg border border-amber-500/50 bg-amber-950/40 px-3 py-2 text-center text-sm text-amber-100"
              >
                Zvrat! ⚡ {round.flavor_text}
              </p>
            )}
            <div className="flex items-start justify-center gap-4">
              <div
                data-testid="round-result-attacker"
                className={`flex-1 rounded-lg border p-2 ${
                  round.winner_card_instance_id === round.attacker_card_instance_id
                    ? 'border-amber-500 bg-amber-950/30'
                    : 'border-zinc-700'
                }`}
              >
                <p className="mb-1 text-center text-xs text-zinc-400">Útočník</p>
                {attackerTemplate && (
                  <div className="mx-auto mb-2 max-w-[110px]">
                    <TradingCard
                      template={attackerTemplate}
                      stats={applyRank(attackerTemplate.baseStats, attackerTemplate.rank)}
                      compact
                    />
                  </div>
                )}
                <dl className="grid grid-cols-3 gap-1 text-center text-[11px]">
                  <div>
                    <dt className="text-zinc-500">ATK</dt>
                    <dd className="font-mono font-semibold">{round.attacker_atk ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">DMG</dt>
                    <dd className="font-mono font-semibold">{round.attacker_dmg_dealt ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">TTK</dt>
                    <dd className="font-mono font-semibold">{formatTtk(round.attacker_ttk)}</dd>
                  </div>
                </dl>
                {round.winner_card_instance_id === round.attacker_card_instance_id && (
                  <p className="mt-1 text-center text-xs font-semibold text-amber-400">VÍTĚZ</p>
                )}
              </div>

              <div
                data-testid="round-result-defender"
                className={`flex-1 rounded-lg border p-2 ${
                  round.winner_card_instance_id === round.defender_card_instance_id
                    ? 'border-amber-500 bg-amber-950/30'
                    : 'border-zinc-700'
                }`}
              >
                <p className="mb-1 text-center text-xs text-zinc-400">Obránce</p>
                {defenderTemplate && (
                  <div className="mx-auto mb-2 max-w-[110px]">
                    <TradingCard
                      template={defenderTemplate}
                      stats={applyRank(defenderTemplate.baseStats, defenderTemplate.rank)}
                      compact
                    />
                  </div>
                )}
                <dl className="grid grid-cols-3 gap-1 text-center text-[11px]">
                  <div>
                    <dt className="text-zinc-500">ATK</dt>
                    <dd className="font-mono font-semibold">{round.defender_atk ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">DMG</dt>
                    <dd className="font-mono font-semibold">{round.defender_dmg_dealt ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">TTK</dt>
                    <dd className="font-mono font-semibold">{formatTtk(round.defender_ttk)}</dd>
                  </div>
                </dl>
                {round.winner_card_instance_id === round.defender_card_instance_id && (
                  <p className="mt-1 text-center text-xs font-semibold text-amber-400">VÍTĚZ</p>
                )}
              </div>
            </div>

            <p data-testid="round-result-explanation" className="mt-3 text-center text-xs text-zinc-300">
              {explanation(round)}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
