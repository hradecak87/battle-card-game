'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { WarList } from '@/components/diplomacy/WarList'
import { PeaceOfferList } from '@/components/diplomacy/PeaceOfferList'
import { PeaceProposalForm } from '@/components/diplomacy/PeaceProposalForm'
import {
  acceptPeace,
  cancelPeace,
  listOffers,
  listWars,
  proposePeace,
  rejectPeace,
} from '@/lib/diplomacy/api'
import type { DiplomacyOfferRow, DiplomacyWarRow, ProposePeaceInput } from '@/lib/diplomacy/types'
import { getMyCardInstances, getMyTerritories, type MyCardInstance, type MyTerritory } from '@/lib/territories/api'
import { useSession } from '@/lib/supabase/useSession'
import { useVisiblePolling } from '@/components/chat/useVisiblePolling'

const POLL_INTERVAL_MS = 12_000

export default function DiplomacyPage() {
  const { user, loading } = useSession()
  const [wars, setWars] = useState<DiplomacyWarRow[]>([])
  const [offers, setOffers] = useState<DiplomacyOfferRow[]>([])
  const [cards, setCards] = useState<MyCardInstance[]>([])
  const [territories, setTerritories] = useState<MyTerritory[]>([])
  const [activeWar, setActiveWar] = useState<DiplomacyWarRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.id) {
      setWars([])
      setOffers([])
      setCards([])
      setTerritories([])
      return
    }

    const [warsResult, offersResult, cardsResult, territoriesResult] = await Promise.all([
      listWars(),
      listOffers(),
      getMyCardInstances(user.id),
      getMyTerritories(user.id),
    ])

    if (warsResult.error || offersResult.error || cardsResult.error || territoriesResult.error) {
      setError(
        warsResult.error?.message ??
          offersResult.error?.message ??
          cardsResult.error?.message ??
          territoriesResult.error?.message ??
          'Nepodařilo se načíst diplomacii.',
      )
      return
    }

    setError(null)
    setWars(warsResult.data ?? [])
    setOffers(offersResult.data ?? [])
    setCards(cardsResult.data ?? [])
    setTerritories(territoriesResult.data ?? [])
  }, [user?.id])

  useVisiblePolling(load, POLL_INTERVAL_MS, !loading && !!user?.id)

  const pendingTargetIds = useMemo(
    () =>
      offers
        .filter((offer) => offer.initiator_id === user?.id && offer.status === 'pending')
        .map((offer) => offer.target_id),
    [offers, user?.id],
  )

  async function handleSubmitProposal(input: ProposePeaceInput) {
    const { error: submitError } = await proposePeace(input)
    if (submitError) {
      return { ok: false, error: submitError.message }
    }
    await load()
    return { ok: true }
  }

  async function handleAccept(offerId: string) {
    const { error: acceptError } = await acceptPeace(offerId)
    if (acceptError) {
      setError(acceptError.message)
      return
    }
    setError(null)
    await load()
  }

  async function handleReject(offerId: string) {
    const { error: rejectError } = await rejectPeace(offerId)
    if (rejectError) {
      setError(rejectError.message)
      return
    }
    setError(null)
    await load()
  }

  async function handleCancel(offerId: string) {
    const { error: cancelError } = await cancelPeace(offerId)
    if (cancelError) {
      setError(cancelError.message)
      return
    }
    setError(null)
    await load()
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
          <p className="text-sm text-zinc-400">Sleduj aktivní války a vyjednávej bílý mír nebo tribut.</p>
        </header>

        {error && <p className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}

        <div data-testid="diplomacy-sections" className="flex flex-col gap-6">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-zinc-100">Moje války</h2>
            <WarList wars={wars} pendingTargetIds={pendingTargetIds} onPropose={(playerId) => setActiveWar(wars.find((war) => war.other_player_id === playerId) ?? null)} />
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-zinc-100">Nabídky míru</h2>
            <PeaceOfferList
              offers={offers}
              currentPlayerId={user.id}
              onAccept={handleAccept}
              onReject={handleReject}
              onCancel={handleCancel}
            />
          </section>
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
