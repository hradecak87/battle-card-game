'use client'

import { useEffect, useMemo, useState } from 'react'
import { applyRank } from '@/lib/cards/combat'
import type { Rank, UnitCardTemplate, UnitType } from '@/lib/cards/types'
import { TradingCard } from '@/components/cards/TradingCard'
import { CardZoomIconButton, CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import type {
  CreateTradeOfferInput,
  CounterOfferInput,
  RespondToPublicOfferInput,
  TradeOfferDirection,
  TradePlayerOption,
  TradeRequestedCriteria,
  TradeSelectableCard,
} from '@/lib/trading/api'

type ModalSubmitPayload =
  | { kind: 'create'; payload: CreateTradeOfferInput }
  | { kind: 'counter'; payload: CounterOfferInput }
  | { kind: 'respond'; payload: RespondToPublicOfferInput }

interface CreateTradeOfferModalProps {
  direction: TradeOfferDirection
  ownCards: TradeSelectableCard[]
  targetPlayers: TradePlayerOption[]
  targetCards: TradeSelectableCard[]
  loadingTargetCards: boolean
  initialType?: 'direct' | 'public'
  initialTargetPlayerId?: string | null
  initialMessage?: string | null
  onClose: () => void
  onSubmit: (payload: ModalSubmitPayload) => Promise<{ ok: boolean; error?: string | null }>
  onSearchPlayers: (query: string) => void
  onTargetPlayerChange: (playerId: string | null) => void
}

function toUnitTemplate(card: TradeSelectableCard): UnitCardTemplate | null {
  if (!card.template_base_stats || !card.template_unit_type) return null
  return {
    id: card.template_id,
    category: 'unit',
    unitType: card.template_unit_type as UnitType,
    rank: card.template_rank as Rank,
    name: card.template_name,
    flavorText: card.template_flavor_text,
    baseStats: card.template_base_stats,
    totalSupply: card.template_total_supply,
  }
}

function CardSelector({
  cards,
  selectedIds,
  title,
  onToggle,
}: {
  cards: TradeSelectableCard[]
  selectedIds: string[]
  title: string
  onToggle: (id: string) => void
}) {
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-zinc-300">{title}</legend>
      {cards.length === 0 ? (
        <p className="text-sm text-zinc-500">Žádné karty.</p>
      ) : (
        <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto md:grid-cols-3">
          {cards.map((card) => {
            const template = toUnitTemplate(card)
            if (!template) return null
            const checked = selectedIds.includes(card.instance_id)
            const stats = applyRank(template.baseStats, template.rank)
            return (
              <div
                key={card.instance_id}
                className={`relative rounded-xl p-1 ${checked ? 'ring-2 ring-emerald-500' : 'ring-1 ring-zinc-800'}`}
              >
                <button
                  type="button"
                  onClick={() => onToggle(card.instance_id)}
                  aria-pressed={checked}
                  className="block w-full text-left"
                >
                  <TradingCard template={template} stats={stats} compact />
                </button>
                <CardZoomIconButton
                  cardName={card.template_name}
                  className="absolute right-2 top-2"
                  onClick={(event) => {
                    event.stopPropagation()
                    openZoom(template, stats)
                  }}
                />
              </div>
            )
          })}
        </div>
      )}
      <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
    </fieldset>
  )
}

export function CreateTradeOfferModal({
  direction,
  ownCards,
  targetPlayers,
  targetCards,
  loadingTargetCards,
  initialType = 'direct',
  initialTargetPlayerId = null,
  initialMessage = null,
  onClose,
  onSubmit,
  onSearchPlayers,
  onTargetPlayerChange,
}: CreateTradeOfferModalProps) {
  const [offerType, setOfferType] = useState<'direct' | 'public'>(initialType)
  const [targetPlayerId, setTargetPlayerId] = useState(initialTargetPlayerId ?? '')
  const [playerSearch, setPlayerSearch] = useState('')
  const [offeredCardIds, setOfferedCardIds] = useState<string[]>([])
  const [requestedCardIds, setRequestedCardIds] = useState<string[]>([])
  const [message, setMessage] = useState(initialMessage ?? '')
  const [criteriaRank, setCriteriaRank] = useState('')
  const [criteriaUnitType, setCriteriaUnitType] = useState('')
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (direction !== 'create') return
    setOfferType(initialType)
  }, [direction, initialType])

  useEffect(() => {
    if (direction === 'respond') return
    onSearchPlayers(playerSearch)
  }, [direction, onSearchPlayers, playerSearch])

  const title = useMemo(() => {
    if (direction === 'counter') return 'Protinabídka'
    if (direction === 'respond') return 'Reakce na veřejnou nabídku'
    return 'Nová nabídka'
  }, [direction])

  function toggleSelected(ids: string[], id: string, setter: (next: string[]) => void) {
    setter(ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])
  }

  async function handleSubmit() {
    const needsTarget = direction !== 'respond' && (direction === 'counter' || offerType === 'direct')
    const needsRequestedCards = direction === 'counter' || (direction === 'create' && offerType === 'direct')
    const nextErrors: string[] = []

    if (needsTarget && !targetPlayerId) {
      nextErrors.push('Vyber hráče, kterému chceš nabídku poslat.')
    }
    if (offeredCardIds.length === 0) {
      nextErrors.push('Vyber alespoň jednu svou kartu.')
    }
    if (needsRequestedCards && requestedCardIds.length === 0) {
      nextErrors.push('Vyber alespoň jednu požadovanou kartu protihráče.')
    }

    if (nextErrors.length > 0) {
      setFormErrors(nextErrors)
      return
    }

    setFormErrors([])
    setSubmitting(true)

    const requestedCriteria: TradeRequestedCriteria | null =
      direction === 'create' && offerType === 'public'
        ? {
            rank: (criteriaRank || null) as Rank | null,
            unit_type: (criteriaUnitType || null) as UnitType | null,
          }
        : null

    const result =
      direction === 'respond'
        ? await onSubmit({
            kind: 'respond',
            payload: { offeredCardIds, message: message.trim() || null },
          })
        : direction === 'counter'
          ? await onSubmit({
              kind: 'counter',
              payload: { offeredCardIds, requestedCardIds, message: message.trim() || null },
            })
          : await onSubmit({
              kind: 'create',
              payload: {
                type: offerType,
                targetPlayerId: offerType === 'direct' ? targetPlayerId : null,
                offeredCardIds,
                requestedCardIds: offerType === 'direct' ? requestedCardIds : null,
                requestedCriteria:
                  offerType === 'public' &&
                  (requestedCriteria?.rank != null || requestedCriteria?.unit_type != null)
                    ? requestedCriteria
                    : null,
                message: message.trim() || null,
              },
            })

    setSubmitting(false)

    if (!result.ok) {
      setFormErrors([result.error ?? 'Nepodařilo se uložit nabídku.'])
      return
    }

    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-zinc-400 hover:bg-zinc-800">
            ✕
          </button>
        </div>

        {direction === 'create' && (
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setOfferType('direct')}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                offerType === 'direct' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Přímá nabídka
            </button>
            <button
              type="button"
              onClick={() => setOfferType('public')}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                offerType === 'public' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Veřejná nabídka
            </button>
          </div>
        )}

        {(direction === 'counter' || (direction === 'create' && offerType === 'direct')) && (
          <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <label className="flex flex-col gap-2 text-sm text-zinc-300">
              Hledat hráče
              <input
                value={playerSearch}
                onChange={(event) => setPlayerSearch(event.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
                placeholder="Zadej jméno hráče…"
              />
            </label>
            <label className="mt-3 flex flex-col gap-2 text-sm text-zinc-300">
              Hráč
              <select
                value={targetPlayerId}
                onChange={(event) => {
                  const nextId = event.target.value
                  setTargetPlayerId(nextId)
                  onTargetPlayerChange(nextId || null)
                }}
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
              >
                <option value="">— vyber hráče —</option>
                {targetPlayers.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.display_name}
                    {player.kingdom_name ? ` (${player.kingdom_name})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {direction === 'create' && offerType === 'public' && (
          <div className="mb-4 grid gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-zinc-300">
              Požadovaný rank
              <select
                value={criteriaRank}
                onChange={(event) => setCriteriaRank(event.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
              >
                <option value="">Libovolný</option>
                <option value="common">common</option>
                <option value="uncommon">uncommon</option>
                <option value="rare">rare</option>
                <option value="epic">epic</option>
                <option value="legend">legend</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm text-zinc-300">
              Požadovaný typ vojska
              <select
                value={criteriaUnitType}
                onChange={(event) => setCriteriaUnitType(event.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
              >
                <option value="">Libovolný</option>
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
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <CardSelector
            cards={ownCards}
            selectedIds={offeredCardIds}
            title="Tvé nabízené karty"
            onToggle={(id) => toggleSelected(offeredCardIds, id, setOfferedCardIds)}
          />

          {(direction === 'counter' || (direction === 'create' && offerType === 'direct')) && (
            <div>
              {loadingTargetCards ? (
                <p className="text-sm text-zinc-400">Načítám karty vybraného hráče…</p>
              ) : (
                <CardSelector
                  cards={targetCards}
                  selectedIds={requestedCardIds}
                  title="Požadované karty"
                  onToggle={(id) => toggleSelected(requestedCardIds, id, setRequestedCardIds)}
                />
              )}
            </div>
          )}
        </div>

        <label className="mt-6 flex flex-col gap-2 text-sm text-zinc-300">
          Zpráva
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-28 rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
            placeholder="Doplň krátký komentář…"
          />
        </label>

        {formErrors.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1 text-sm text-red-400">
            {formErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
          >
            Zavřít
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Odesílám…' : 'Odeslat nabídku'}
          </button>
        </div>
      </div>
    </div>
  )
}
