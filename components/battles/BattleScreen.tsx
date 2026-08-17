'use client'

import { useCallback, useEffect, useState } from 'react'
import { getBattle, markReady, pickDefenderCard, GetBattleResult, BattleCard, BattleRoundRow } from '@/lib/battles/api'
import { useBattleChannel } from '@/lib/battles/useBattleChannel'
import { getLastSeenRound, setLastSeenRound } from '@/lib/battles/lastSeenRound'
import RosterStrip from './RosterStrip'
import DuelStage from './DuelStage'
import RoundHistory from './RoundHistory'
import RoundResultPopup from './RoundResultPopup'

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
  const [popupQueue, setPopupQueue] = useState<BattleRoundRow[]>([])

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

  // Task 13's mark_ready re-evaluates the "both online right now" check
  // fresh on every call, but only the *first* call is user-triggered (the
  // "Jsem připraven" button hides itself once the caller's own ready_at is
  // set). If the two sides don't happen to have that click overlap within
  // the 2-minute window, the battle gets stuck at awaiting_ready forever
  // with nothing left to click. So once a participant has this screen
  // open, keep silently re-calling markReady (idempotent, safe) so the
  // joint check gets retried automatically as soon as both are actually
  // online together — no manual re-click required.
  const battleStatus = data?.battle.status
  const attackerId = data?.battle.attacker_id
  const defenderId = data?.battle.defender_id
  const isParticipant =
    currentUserId !== null && (currentUserId === attackerId || currentUserId === defenderId)

  useEffect(() => {
    if (battleStatus !== 'awaiting_ready' || !isParticipant) return
    const interval = setInterval(() => {
      markReady(battleId).then(() => load())
    }, 20_000)
    return () => clearInterval(interval)
  }, [battleStatus, isParticipant, battleId, load])

  // Every RPC (including the plain read `get_battle`) lazily runs
  // resolve_due_battles() first, which auto-picks the defender's card and
  // advances the round once round_deadline has passed — but nothing
  // calls any RPC on its own once the countdown hits zero, so without
  // this, a round only actually advances when *someone* happens to
  // trigger a fresh request (e.g. a manual page reload). Schedule a
  // single timer per round that fires just after its deadline and calls
  // load(), so an expired round advances on its own for anyone who has
  // the battle screen open, no refresh needed.
  const roundDeadline = battleStatus === 'active' ? data?.battle.round_deadline ?? null : null

  useEffect(() => {
    if (!roundDeadline) return
    const delay = Math.max(0, new Date(roundDeadline).getTime() - Date.now()) + 250
    const timeout = setTimeout(load, delay)
    return () => clearTimeout(timeout)
  }, [roundDeadline, load])

  // Queue any round newer than this browser's last-seen marker (see
  // lib/battles/lastSeenRound.ts) that has actually resolved or been
  // skipped — `winner_card_instance_id`/`skipped` are the correct
  // "is this round done?" signals (`resolved_at` is set at round-start,
  // not at resolution, so it can't be used for this). Sorted ascending so
  // a first-time view of an already-finished NPC battle (many rounds
  // resolved in one server call) plays back every round's popup in
  // sequence, one at a time.
  useEffect(() => {
    if (!data) return
    const lastSeen = getLastSeenRound(battleId)
    const unseen = data.rounds
      .filter((r) => r.round_number > lastSeen && (r.skipped || r.winner_card_instance_id !== null))
      .sort((a, b) => a.round_number - b.round_number)
    if (unseen.length === 0) return
    setPopupQueue((prev) => {
      const alreadyQueued = new Set(prev.map((r) => r.round_number))
      const toAdd = unseen.filter((r) => !alreadyQueued.has(r.round_number))
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev
    })
  }, [data, battleId])

  function handleDismissPopup() {
    const [shown, ...rest] = popupQueue
    if (shown) setLastSeenRound(battleId, shown.round_number)
    setPopupQueue(rest)
  }

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
      <p data-testid="my-role" className="text-xs text-zinc-500">
        Tvá role v této bitvě: {isAttacker ? 'útočník' : isDefender ? 'obránce' : 'divák (nejsi účastník)'}
      </p>
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

      {popupQueue[0] && <RoundResultPopup round={popupQueue[0]} onDismiss={handleDismissPopup} />}
    </div>
  )
}
