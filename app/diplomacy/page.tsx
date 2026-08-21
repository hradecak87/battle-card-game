'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { CoalitionPanel } from '@/components/diplomacy/CoalitionPanel'
import { DiplomacyTabs, type DiplomacyTabKey } from '@/components/diplomacy/DiplomacyTabs'
import { PactList } from '@/components/diplomacy/PactList'
import { WarList } from '@/components/diplomacy/WarList'
import { PeaceOfferList } from '@/components/diplomacy/PeaceOfferList'
import { PeaceProposalForm } from '@/components/diplomacy/PeaceProposalForm'
import {
  acceptCoalitionInvite,
  acceptCoalitionJoinRequest,
  acceptNonAggression,
  acceptPeace,
  cancelNonAggression,
  cancelPeace,
  createCoalition,
  declareCoalitionPeace,
  declareCoalitionWar,
  disbandCoalition,
  getMyCoalition,
  inviteToCoalition,
  listCoalitionInvites,
  listCoalitionJoinRequests,
  listCoalitions,
  listNonAggressionPacts,
  listOffers,
  listWars,
  proposeNonAggression,
  proposePeace,
  rejectCoalitionInvite,
  rejectCoalitionJoinRequest,
  rejectNonAggression,
  rejectPeace,
  requestJoinCoalition,
  transferCoalitionLeadership,
  kickCoalitionMember,
  leaveCoalition,
} from '@/lib/diplomacy/api'
import type {
  CoalitionDetail,
  CoalitionInviteRow,
  CoalitionJoinRequestRow,
  CoalitionSummary,
  DiplomacyOfferRow,
  DiplomacyWarRow,
  NonAggressionPactRow,
  ProposePeaceInput,
} from '@/lib/diplomacy/types'
import { getMyCardInstances, getMyTerritories, type MyCardInstance, type MyTerritory } from '@/lib/territories/api'
import { useSession } from '@/lib/supabase/useSession'
import { useVisiblePolling } from '@/components/chat/useVisiblePolling'

const POLL_INTERVAL_MS = 12_000

type RpcActionResult = { error: { message: string } | null }

export default function DiplomacyPage() {
  const { user, loading } = useSession()
  const [activeTab, setActiveTab] = useState<DiplomacyTabKey>('wars')
  const [wars, setWars] = useState<DiplomacyWarRow[]>([])
  const [offers, setOffers] = useState<DiplomacyOfferRow[]>([])
  const [pacts, setPacts] = useState<NonAggressionPactRow[]>([])
  const [cards, setCards] = useState<MyCardInstance[]>([])
  const [territories, setTerritories] = useState<MyTerritory[]>([])
  const [myCoalition, setMyCoalition] = useState<CoalitionDetail | null>(null)
  const [coalitions, setCoalitions] = useState<CoalitionSummary[]>([])
  const [coalitionInvites, setCoalitionInvites] = useState<CoalitionInviteRow[]>([])
  const [coalitionJoinRequests, setCoalitionJoinRequests] = useState<CoalitionJoinRequestRow[]>([])
  const [activeWar, setActiveWar] = useState<DiplomacyWarRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.id) {
      setWars([])
      setOffers([])
      setPacts([])
      setCards([])
      setTerritories([])
      setMyCoalition(null)
      setCoalitions([])
      setCoalitionInvites([])
      setCoalitionJoinRequests([])
      return
    }

    const [
      warsResult,
      offersResult,
      cardsResult,
      territoriesResult,
      pactsResult,
      myCoalitionResult,
      coalitionsResult,
      coalitionInvitesResult,
    ] = await Promise.all([
      listWars(),
      listOffers(),
      getMyCardInstances(user.id),
      getMyTerritories(user.id),
      listNonAggressionPacts(),
      getMyCoalition(),
      listCoalitions(),
      listCoalitionInvites(),
    ])

    const resolvedCoalition =
      myCoalitionResult.data?.find((row) => row && row.id != null) ?? null

    const joinRequestsResult =
      resolvedCoalition?.id && resolvedCoalition.leader_id === user.id
        ? await listCoalitionJoinRequests(resolvedCoalition.id)
        : { data: [], error: null }

    const firstError =
      warsResult.error?.message ??
      offersResult.error?.message ??
      cardsResult.error?.message ??
      territoriesResult.error?.message ??
      pactsResult.error?.message ??
      myCoalitionResult.error?.message ??
      coalitionsResult.error?.message ??
      coalitionInvitesResult.error?.message ??
      joinRequestsResult.error?.message

    if (firstError) {
      setError(firstError ?? 'Nepodařilo se načíst diplomacii.')
      return
    }

    setError(null)
    setWars(warsResult.data ?? [])
    setOffers(offersResult.data ?? [])
    setCards(cardsResult.data ?? [])
    setTerritories(territoriesResult.data ?? [])
    setPacts(pactsResult.data ?? [])
    setMyCoalition(resolvedCoalition)
    setCoalitions(coalitionsResult.data ?? [])
    setCoalitionInvites(coalitionInvitesResult.data ?? [])
    setCoalitionJoinRequests(joinRequestsResult.data ?? [])
  }, [user?.id])

  useVisiblePolling(load, POLL_INTERVAL_MS, !loading && !!user?.id)

  const peaceOffers = useMemo(
    () => offers.filter((offer) => offer.kind !== 'non_aggression'),
    [offers],
  )
  const pactOffers = useMemo(
    () => offers.filter((offer) => offer.kind === 'non_aggression'),
    [offers],
  )
  const pendingTargetIds = useMemo(
    () =>
      peaceOffers
        .filter((offer) => offer.initiator_id === user?.id && offer.status === 'pending')
        .map((offer) => offer.target_id),
    [peaceOffers, user?.id],
  )

  const runAction = useCallback(
    async (action: () => Promise<RpcActionResult>) => {
      const { error: actionError } = await action()
      if (actionError) {
        setError(actionError.message)
        return false
      }
      setError(null)
      await load()
      return true
    },
    [load],
  )

  async function handleSubmitProposal(input: ProposePeaceInput) {
    const { error: submitError } = await proposePeace(input)
    if (submitError) {
      return { ok: false, error: submitError.message }
    }
    await load()
    return { ok: true }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p className="text-zinc-400">Načítám…</p>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-zinc-300">Pro diplomacii se nejdřív přihlas.</p>
        <Link href="/login" className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white">
          Přejít na přihlášení
        </Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Link href="/" className="text-sm text-zinc-400 underline hover:text-zinc-200">
          ← Domů
        </Link>
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-zinc-100">Diplomacie</h1>
          <p className="text-sm text-zinc-400">
            Sleduj války, nabídky míru, koalice i pakty o neútočení.
          </p>
        </header>

        {error && <p className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

        <DiplomacyTabs activeTab={activeTab} onChange={setActiveTab} />

        <div data-testid="diplomacy-sections" className="flex flex-col gap-6">
          {activeTab === 'wars' && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-zinc-100">Moje války</h2>
              <WarList
                wars={wars}
                pendingTargetIds={pendingTargetIds}
                onPropose={(playerId) => setActiveWar(wars.find((war) => war.other_player_id === playerId) ?? null)}
              />
            </section>
          )}

          {activeTab === 'peace' && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-zinc-100">Nabídky míru</h2>
              <PeaceOfferList
                offers={peaceOffers}
                currentPlayerId={user.id}
                onAccept={async (offerId) => {
                  await runAction(() => acceptPeace(offerId))
                }}
                onReject={async (offerId) => {
                  await runAction(() => rejectPeace(offerId))
                }}
                onCancel={async (offerId) => {
                  await runAction(() => cancelPeace(offerId))
                }}
              />
            </section>
          )}

          {activeTab === 'coalition' && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-zinc-100">Koalice</h2>
              <CoalitionPanel
                myCoalition={myCoalition}
                coalitions={coalitions}
                invites={coalitionInvites}
                joinRequests={coalitionJoinRequests}
                currentPlayerId={user.id}
                onCreate={async (name) => {
                  await runAction(() => createCoalition(name))
                }}
                onRequestJoin={async (coalitionId) => {
                  await runAction(() => requestJoinCoalition(coalitionId))
                }}
                onAcceptInvite={async (inviteId) => {
                  await runAction(() => acceptCoalitionInvite(inviteId))
                }}
                onRejectInvite={async (inviteId) => {
                  await runAction(() => rejectCoalitionInvite(inviteId))
                }}
                onInvite={async (coalitionId, playerId) => {
                  await runAction(() => inviteToCoalition(coalitionId, playerId))
                }}
                onAcceptJoinRequest={async (requestId) => {
                  await runAction(() => acceptCoalitionJoinRequest(requestId))
                }}
                onRejectJoinRequest={async (requestId) => {
                  await runAction(() => rejectCoalitionJoinRequest(requestId))
                }}
                onKickMember={async (playerId) => {
                  await runAction(() => kickCoalitionMember(playerId))
                }}
                onTransferLeadership={async (playerId) => {
                  await runAction(() => transferCoalitionLeadership(playerId))
                }}
                onLeave={async () => {
                  await runAction(() => leaveCoalition())
                }}
                onDisband={async () => {
                  await runAction(() => disbandCoalition())
                }}
                onDeclareWar={async (targetPlayerId) => {
                  await runAction(() => declareCoalitionWar(targetPlayerId))
                }}
                onDeclarePeace={async (targetPlayerId) => {
                  await runAction(() => declareCoalitionPeace(targetPlayerId))
                }}
              />
            </section>
          )}

          {activeTab === 'pacts' && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-zinc-100">Pakty</h2>
              <PactList
                pacts={pacts}
                offers={pactOffers}
                currentPlayerId={user.id}
                onPropose={async (targetPlayerId) => {
                  await runAction(() => proposeNonAggression(targetPlayerId))
                }}
                onAccept={async (offerId) => {
                  await runAction(() => acceptNonAggression(offerId))
                }}
                onReject={async (offerId) => {
                  await runAction(() => rejectNonAggression(offerId))
                }}
                onCancel={async (offerId) => {
                  await runAction(() => cancelNonAggression(offerId))
                }}
              />
            </section>
          )}
        </div>
      </div>

      {activeWar && (
        <PeaceProposalForm
          isOpen
          targetPlayerId={activeWar.other_player_id}
          targetPlayerName={activeWar.other_player_display_name}
          availableCards={cards}
          availableTerritories={territories}
          onClose={() => setActiveWar(null)}
          onSubmit={handleSubmitProposal}
        />
      )}
    </main>
  )
}
