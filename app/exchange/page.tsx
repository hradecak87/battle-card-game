'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { useSession } from '@/lib/supabase/useSession'
import { getMyCardInstances } from '@/lib/territories/api'
import {
  acceptOffer,
  cancelOffer,
  counterOffer,
  createTradeOffer,
  listMyOffers,
  listPublicMarketplace,
  listTradeHistory,
  rejectOffer,
  respondToPublicOffer,
  type CreateTradeOfferInput,
  type CounterOfferInput,
  type RespondToPublicOfferInput,
  type TradeOffer,
  type TradeOfferDirection,
  type TradeMarketplaceFilters,
  type TradePlayerOption,
  type TradeSelectableCard,
} from '@/lib/trading/api'
import { CreateTradeOfferModal } from '@/components/exchange/CreateTradeOfferModal'
import { TradeOfferList } from '@/components/exchange/TradeOfferList'

type ExchangeTab = 'mine' | 'market' | 'history'
const ACTIVE_MY_OFFER_STATUSES: TradeOffer['status'][] = ['pending', 'countered']

function filterUnitCards(cards: TradeSelectableCard[]) {
  return cards.filter((card) => card.template_base_stats && card.template_unit_type)
}

function mapTradeSelectableCards(rows: unknown[]): TradeSelectableCard[] {
  return rows.map((row) => {
    const card = row as Record<string, unknown>
    const template = card.card_templates as Record<string, unknown>
    return {
      instance_id: String(card.instance_id),
      template_id: String(card.template_id),
      owner_id: card.owner_id ? String(card.owner_id) : null,
      stationed_territory_id:
        typeof card.stationed_territory_id === 'number' ? card.stationed_territory_id : null,
      status: String(card.status) as TradeSelectableCard['status'],
      template_name: String(template.name),
      template_rank: String(template.rank) as TradeSelectableCard['template_rank'],
      template_unit_type: template.unit_type ? String(template.unit_type) as TradeSelectableCard['template_unit_type'] : null,
      template_flavor_text: String(template.flavor_text ?? ''),
      template_base_stats: (template.base_stats as TradeSelectableCard['template_base_stats']) ?? null,
      template_total_supply: typeof template.total_supply === 'number' ? Number(template.total_supply) : null,
    }
  })
}

function criteriaText(offer: TradeOffer) {
  const parts = [
    offer.requested_criteria?.rank ? `rank ${offer.requested_criteria.rank}` : null,
    offer.requested_criteria?.unit_type ? `typ ${offer.requested_criteria.unit_type}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Cokoliv rozumného'
}

function isOfferTarget(offer: TradeOffer, playerId: string) {
  return offer.target_player_id === playerId
}

export default function ExchangePage() {
  const router = useRouter()
  const { user, player, loading } = useSession()

  const [tab, setTab] = useState<ExchangeTab>('mine')
  const [myOffers, setMyOffers] = useState<TradeOffer[]>([])
  const [marketplaceOffers, setMarketplaceOffers] = useState<TradeOffer[]>([])
  const [tradeHistory, setTradeHistory] = useState<TradeOffer[]>([])
  const [ownCards, setOwnCards] = useState<TradeSelectableCard[]>([])
  const [targetPlayers, setTargetPlayers] = useState<TradePlayerOption[]>([])
  const [targetCards, setTargetCards] = useState<TradeSelectableCard[]>([])
  const [loadingTargetCards, setLoadingTargetCards] = useState(false)
  const [selectedOffer, setSelectedOffer] = useState<TradeOffer | null>(null)
  const [selectedMarketOffer, setSelectedMarketOffer] = useState<TradeOffer | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [marketFilters, setMarketFilters] = useState({ rank: '', unitType: '', ownerName: '' })
  const [modalState, setModalState] = useState<{
    direction: TradeOfferDirection
    offer: TradeOffer | null
  } | null>(null)

  const selectedThread = useMemo(() => {
    if (!selectedOffer) return []
    const threadOffers = myOffers
      .filter((offer) => offer.root_offer_id === selectedOffer.root_offer_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    const rootMarketplaceOffer = marketplaceOffers.find((offer) => offer.id === selectedOffer.root_offer_id)
    if (rootMarketplaceOffer && !threadOffers.some((offer) => offer.id === rootMarketplaceOffer.id)) {
      return [rootMarketplaceOffer, ...threadOffers].sort((a, b) => a.created_at.localeCompare(b.created_at))
    }
    return threadOffers
  }, [marketplaceOffers, myOffers, selectedOffer])

  const activeMyOffers = useMemo(
    () => myOffers.filter((offer) => ACTIVE_MY_OFFER_STATUSES.includes(offer.status)),
    [myOffers]
  )

  async function loadAll() {
    const filters: TradeMarketplaceFilters = {
      rank: (marketFilters.rank || null) as TradeMarketplaceFilters['rank'],
      unitType: (marketFilters.unitType || null) as TradeMarketplaceFilters['unitType'],
      ownerName: marketFilters.ownerName || null,
    }
    const [mineResult, marketResult, historyResult] = await Promise.all([
      listMyOffers(),
      listPublicMarketplace(filters),
      listTradeHistory(),
    ])

    if (mineResult.error || marketResult.error || historyResult.error) {
      setPageError(mineResult.error?.message ?? marketResult.error?.message ?? historyResult.error?.message ?? 'Nepodařilo se načíst směnárnu.')
      return
    }

    setPageError(null)
    setMyOffers(mineResult.data ?? [])
    setMarketplaceOffers(marketResult.data ?? [])
    setTradeHistory(historyResult.data ?? [])
  }

  async function loadOwnCards() {
    if (!user) return
    const { data, error } = await getMyCardInstances(user.id)
    if (error) {
      setPageError(error.message)
      return
    }
    setOwnCards(filterUnitCards(mapTradeSelectableCards(data ?? [])))
  }

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push('/login')
      return
    }
    if (player && !player.onboarding_completed) {
      router.push('/onboarding/kingdom')
      return
    }
    loadAll()
    loadOwnCards()
    const intervalId = window.setInterval(() => {
      loadAll()
    }, 15000)
    return () => window.clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, player, router])

  useEffect(() => {
    if (!user) return
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketFilters.rank, marketFilters.unitType, marketFilters.ownerName, user])

  useEffect(() => {
    if (!selectedOffer) return
    const nextSelected = activeMyOffers.find((offer) => offer.id === selectedOffer.id)
    setSelectedOffer(nextSelected ?? null)
  }, [activeMyOffers, selectedOffer])

  async function handleSearchPlayers(query: string) {
    if (!user || modalState?.direction === 'respond') return
    if (query.trim().length === 0) {
      setTargetPlayers([])
      return
    }

    const { data, error } = await (supabase
      .from('players')
      .select('id, display_name, kingdom_name')
      .ilike('display_name', `%${query.trim()}%`)
      .neq('id', user.id) as unknown as Promise<{
      data: TradePlayerOption[] | null
      error: { message: string } | null
    }>)

    if (!error) setTargetPlayers(data ?? [])
  }

  async function handleTargetPlayerChange(playerId: string | null) {
    if (!playerId) {
      setTargetCards([])
      return
    }

    setLoadingTargetCards(true)
    const { data, error } = await (supabase
      .from('card_instances')
      .select(
        'instance_id, template_id, owner_id, stationed_territory_id, status, card_templates!inner(name, rank, unit_type, flavor_text, base_stats, total_supply, category)'
      )
      .eq('owner_id', playerId) as unknown as Promise<{
      data: unknown[] | null
      error: { message: string } | null
    }>)

    setLoadingTargetCards(false)
    if (error) {
      setTargetCards([])
      setPageError(error.message)
      return
    }

    setTargetCards(filterUnitCards(mapTradeSelectableCards(data ?? [])))
  }

  async function submitModal(payload:
    | { kind: 'create'; payload: CreateTradeOfferInput }
    | { kind: 'counter'; payload: CounterOfferInput }
    | { kind: 'respond'; payload: RespondToPublicOfferInput }
  ) {
    let errorMessage: string | null = null

    if (payload.kind === 'create') {
      const { error } = await createTradeOffer(payload.payload)
      errorMessage = error?.message ?? null
    } else if (payload.kind === 'counter' && modalState?.offer) {
      const { error } = await counterOffer(modalState.offer.id, payload.payload)
      errorMessage = error?.message ?? null
    } else if (payload.kind === 'respond' && modalState?.offer) {
      const { error } = await respondToPublicOffer(modalState.offer.id, payload.payload)
      errorMessage = error?.message ?? null
    }

    if (errorMessage) {
      return { ok: false, error: errorMessage }
    }

    await loadAll()
    await loadOwnCards()
    setModalState(null)
    return { ok: true }
  }

  async function handleOfferAction(action: 'accept' | 'reject' | 'cancel', offerId: string) {
    const fn = action === 'accept' ? acceptOffer : action === 'reject' ? rejectOffer : cancelOffer
    const { error } = await fn(offerId)
    if (error) {
      setPageError(error.message)
      return
    }
    await loadAll()
  }

  if (loading || !user || (player && !player.onboarding_completed)) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p className="text-zinc-400">Načítám…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="text-sm text-zinc-400 underline hover:text-zinc-200">
              ← Domů
            </Link>
            <h1 className="mt-2 text-3xl font-bold">Směnárna</h1>
            <p className="text-sm text-zinc-400">
              Nabízej své jednotky napřímo nebo je vystav do veřejné tržnice.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setTargetPlayers([])
              setTargetCards([])
              setModalState({ direction: 'create', offer: null })
            }}
            className="rounded-full bg-amber-600 px-5 py-2 font-semibold text-white"
          >
            Nová nabídka
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'mine', label: 'Moje nabídky' },
            { id: 'market', label: 'Tržnice' },
            { id: 'history', label: 'Historie' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as ExchangeTab)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                tab === item.id ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {pageError && <p className="text-sm text-red-400">{pageError}</p>}

        {tab === 'mine' && (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div>
              <h2 className="mb-4 text-2xl font-semibold">Moje nabídky</h2>
              <TradeOfferList
                offers={activeMyOffers}
                emptyMessage="Zatím tu nemáš žádné nabídky."
                selectedOfferId={selectedOffer?.id ?? null}
                onSelect={setSelectedOffer}
              />
            </div>

            <aside className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
              <h3 className="text-xl font-semibold">Detail nabídky</h3>
              {!selectedOffer ? (
                <p className="mt-3 text-sm text-zinc-400">Vyber nabídku ze seznamu.</p>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  <div>
                    <p className="text-sm text-zinc-500">
                      {selectedOffer.initiator_display_name}
                      {selectedOffer.target_display_name ? ` → ${selectedOffer.target_display_name}` : ''}
                    </p>
                    {selectedOffer.message && <p className="mt-2 text-sm text-zinc-200">{selectedOffer.message}</p>}
                    {selectedOffer.type === 'public' && (
                      <p className="mt-2 text-sm text-zinc-400">Hledá: {criteriaText(selectedOffer)}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedOffer.status === 'pending' && selectedOffer.type === 'direct' && isOfferTarget(selectedOffer, user.id) && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOfferAction('accept', selectedOffer.id)}
                          className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
                        >
                          Přijmout
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOfferAction('reject', selectedOffer.id)}
                          className="rounded-full bg-red-700 px-4 py-2 text-sm font-semibold text-white"
                        >
                          Odmítnout
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTargetPlayers([])
                            setTargetCards([])
                            setModalState({ direction: 'counter', offer: selectedOffer })
                            handleTargetPlayerChange(selectedOffer.initiator_id)
                          }}
                          className="rounded-full bg-zinc-700 px-4 py-2 text-sm font-semibold text-white"
                        >
                          Protinabídka
                        </button>
                      </>
                    )}
                    {selectedOffer.status === 'pending' && selectedOffer.initiator_id === user.id && (
                      <button
                        type="button"
                        onClick={() => handleOfferAction('cancel', selectedOffer.id)}
                        className="rounded-full bg-zinc-700 px-4 py-2 text-sm font-semibold text-white"
                      >
                        Zrušit
                      </button>
                    )}
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Historie vyjednávání</h4>
                    <ul className="mt-3 flex flex-col gap-3">
                      {selectedThread.map((offer) => (
                        <li key={offer.id} className="rounded-xl border border-zinc-800 p-3">
                          <div className="text-xs uppercase tracking-wide text-zinc-500">
                            {offer.type} · {offer.status}
                          </div>
                          <div className="mt-1 text-sm font-semibold">
                            {offer.initiator_display_name}
                            {offer.target_display_name ? ` → ${offer.target_display_name}` : ''}
                          </div>
                          {offer.message && <p className="mt-1 text-sm text-zinc-300">{offer.message}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </aside>
          </section>
        )}

        {tab === 'market' && (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div>
              <h2 className="mb-4 text-2xl font-semibold">Tržnice</h2>
              <div className="mb-4 grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm text-zinc-300">
                  Rank
                  <select
                    value={marketFilters.rank}
                    onChange={(event) => setMarketFilters((current) => ({ ...current, rank: event.target.value }))}
                    className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
                  >
                    <option value="">Vše</option>
                    <option value="common">common</option>
                    <option value="uncommon">uncommon</option>
                    <option value="rare">rare</option>
                    <option value="epic">epic</option>
                    <option value="legend">legend</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-zinc-300">
                  Typ vojska
                  <select
                    value={marketFilters.unitType}
                    onChange={(event) => setMarketFilters((current) => ({ ...current, unitType: event.target.value }))}
                    className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
                  >
                    <option value="">Vše</option>
                    <option value="archers">Lučištníci</option>
                    <option value="crossbowmen">Kušiníci</option>
                    <option value="spearmen">Oštěpníci</option>
                    <option value="swordsmen">Šermíři</option>
                    <option value="halberdiers">Halapartníci</option>
                    <option value="knights">Rytíři</option>
                    <option value="lightCavalry">Lehká jízda</option>
                    <option value="siegeEngines">Obléhací stroje</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-zinc-300">
                  Jméno vlastníka
                  <input
                    value={marketFilters.ownerName}
                    onChange={(event) => setMarketFilters((current) => ({ ...current, ownerName: event.target.value }))}
                    className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
                    placeholder="Např. Artuš"
                  />
                </label>
              </div>
              <TradeOfferList
                offers={marketplaceOffers}
                emptyMessage="Žádné veřejné nabídky neodpovídají filtru."
                selectedOfferId={selectedMarketOffer?.id ?? null}
                onSelect={setSelectedMarketOffer}
              />
            </div>

            <aside className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
              <h3 className="text-xl font-semibold">Detail nabídky</h3>
              {!selectedMarketOffer ? (
                <p className="mt-3 text-sm text-zinc-400">Vyber veřejnou nabídku z tržnice.</p>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  <div>
                    <p className="text-sm font-semibold">{selectedMarketOffer.initiator_display_name}</p>
                    <p className="mt-1 text-sm text-zinc-400">Hledá: {criteriaText(selectedMarketOffer)}</p>
                    {selectedMarketOffer.message && <p className="mt-2 text-sm text-zinc-200">{selectedMarketOffer.message}</p>}
                  </div>
                  {selectedMarketOffer.initiator_id !== user.id && selectedMarketOffer.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => {
                        setTargetPlayers([])
                        setTargetCards([])
                        setModalState({ direction: 'respond', offer: selectedMarketOffer })
                      }}
                      className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Odpovědět nabídkou
                    </button>
                  )}
                </div>
              )}
            </aside>
          </section>
        )}

        {tab === 'history' && (
          <section>
            <h2 className="mb-4 text-2xl font-semibold">Historie</h2>
            <TradeOfferList
              offers={tradeHistory}
              emptyMessage="Zatím tu nejsou žádné dokončené směny."
            />
          </section>
        )}
      </div>

      {modalState && (
        <CreateTradeOfferModal
          direction={modalState.direction}
          ownCards={ownCards}
          targetPlayers={targetPlayers}
          targetCards={targetCards}
          loadingTargetCards={loadingTargetCards}
          initialType={modalState.direction === 'respond' ? 'public' : 'direct'}
          initialTargetPlayerId={
            modalState.direction === 'counter'
              ? (modalState.offer?.initiator_id ?? null)
              : null
          }
          onClose={() => setModalState(null)}
          onSubmit={submitModal}
          onSearchPlayers={handleSearchPlayers}
          onTargetPlayerChange={handleTargetPlayerChange}
        />
      )}
    </main>
  )
}
