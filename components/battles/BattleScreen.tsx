'use client'

import { useCallback, useEffect, useState } from 'react'
import { getBattle, markReady, pickDefenderCard, GetBattleResult, BattleCard } from '@/lib/battles/api'
import { useBattleChannel } from '@/lib/battles/useBattleChannel'
import RosterStrip from './RosterStrip'
import DuelStage from './DuelStage'
import RoundHistory from './RoundHistory'

export interface BattleScreenProps {
  battleId: string
  currentUserId: string | null
}

function tallyScore(data: GetBattleResult) {
  let attacker = 0
  let defender = 0
  let lastWinnerSide: 'attacker' | 'defender' | null = null
  for (const round of data.rounds) {
    if (round.skipped || !round.winner_card_instance_id) continue
    if (round.winner_card_instance_id === round.attacker_card_instance_id) {
      attacker += 1
      lastWinnerSide = 'attacker'
    } else {
      defender += 1
      lastWinnerSide = 'defender'
    }
  }
  return { score: { attacker, defender }, lastWinnerSide }
}

/**
 * Battle screen (Task 18/19): loads `get_battle` on mount, then stays live
 * via `useBattleChannel` — no polling after the initial load. Same
 * component handles both the desktop (side-by-side roster strips) and
 * mobile (stacked, horizontally-scrollable strips) layouts via responsive
 * classes, matching this project's established convention (see
 * MapViewport.tsx — no separate `*.mobile.tsx` files exist here).
 */
export default function BattleScreen({ battleId, currentUserId }: BattleScreenProps) {
  const [data, setData] = useState<GetBattleResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [readySubmitting, setReadySubmitting] = useState(false)
  const [pickSubmittingId, setPickSubmittingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(() => {
    getBattle(battleId).then(({ data: result, error: rpcError }) => {
      if (rpcError) {
        setError(rpcError.message)
        return
      }
      setError(null)
      setData(result)
    })
  }, [battleId])

  useEffect(() => {
    load()
  }, [load])

  useBattleChannel(battleId, load)

  async function handleMarkReady() {
    setReadySubmitting(true)
    setActionError(null)
    const { error: rpcError } = await markReady(battleId)
    setReadySubmitting(false)
    if (rpcError) {
      setActionError(rpcError.message)
      return
    }
    load()
  }

  async function handlePickDefender(instanceId: string) {
    setPickSubmittingId(instanceId)
    setActionError(null)
    const { error: rpcError } = await pickDefenderCard(battleId, instanceId)
    setPickSubmittingId(null)
    if (rpcError) {
      setActionError(rpcError.message)
      return
    }
    load()
  }

  if (error) return <p className="text-red-400 text-sm">{error}</p>
  if (!data) return <p className="text-zinc-400 text-sm">Načítám…</p>

  const { battle, attacker_roster: attackerRoster, defender_pool: defenderPool, rounds } = data
  const isAttacker = currentUserId === battle.attacker_id
  const isDefender = currentUserId !== null && currentUserId === battle.defender_id
  const { score, lastWinnerSide } = tallyScore(data)

  const pendingRound = rounds.find((r) => r.round_number === battle.current_round + 1 && !r.skipped)
  const attackerCard: BattleCard | null =
    (pendingRound && attackerRoster.find((c) => c.instance_id === pendingRound.attacker_card_instance_id)) ??
    (rounds.length > 0
      ? attackerRoster.find((c) => c.instance_id === rounds[rounds.length - 1]?.attacker_card_instance_id) ?? null
      : null)
  const defenderCard: BattleCard | null = pendingRound?.defender_card_instance_id
    ? defenderPool.find((c) => c.instance_id === pendingRound.defender_card_instance_id) ?? null
    : null

  const awaitingMyReady =
    battle.status === 'awaiting_ready' &&
    ((isAttacker && !battle.attacker_ready_at) || (isDefender && !battle.defender_ready_at))
  const isMyPickTurn = battle.status === 'active' && isDefender && Boolean(pendingRound) && !defenderCard

  return (
    <div data-testid="battle-screen" className="flex flex-col items-center gap-6 p-4">
      {actionError && <p className="text-red-400 text-sm">{actionError}</p>}

      {battle.status === 'awaiting_ready' && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-zinc-400">
            Bitva čeká, až budou oba hráči online. Útočník ready: {battle.attacker_ready_at ? 'ano' : 'ne'} · Obránce
            ready: {battle.defender_ready_at ? 'ano' : 'ne'}
          </p>
          {(isAttacker || isDefender) && awaitingMyReady && (
            <button
              type="button"
              disabled={readySubmitting}
              onClick={handleMarkReady}
              className="rounded bg-emerald-700 hover:bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {readySubmitting ? 'Potvrzuji…' : 'Jsem připraven'}
            </button>
          )}
        </div>
      )}

      {(battle.status === 'resolved' || battle.status === 'expired') && (
        <p className="text-lg font-bold">
          {battle.winner_side === 'attacker' && 'Vítězí útočník'}
          {battle.winner_side === 'defender' && 'Vítězí obránce'}
          {!battle.winner_side && 'Bitva vypršela bez vítěze'}
        </p>
      )}

      <div className="flex w-full flex-col items-center gap-4 md:flex-row md:items-start md:justify-center">
        <RosterStrip title="Útočník" cards={attackerRoster} activeInstanceId={attackerCard?.instance_id} />

        <DuelStage
          attackerCard={attackerCard}
          defenderCard={defenderCard}
          roundNumber={battle.current_round + 1}
          roundDeadline={battle.status === 'active' ? battle.round_deadline : null}
          score={score}
          lastWinnerSide={lastWinnerSide}
        />

        <RosterStrip
          title="Obránce"
          cards={defenderPool}
          clickable={isMyPickTurn}
          onSelect={handlePickDefender}
          activeInstanceId={defenderCard?.instance_id}
          submittingInstanceId={pickSubmittingId}
        />
      </div>

      <RoundHistory rounds={rounds} attackerRoster={attackerRoster} defenderPool={defenderPool} />
    </div>
  )
}
