'use client'

import type { KeyboardEvent, MouseEvent } from 'react'
import { CardZoomIconButton, CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import { TradingCard } from '@/components/cards/TradingCard'
import { applyRank } from '@/lib/cards/combat'
import type { BoostCardTemplate, Rank, UnitCardTemplate, UnitType } from '@/lib/cards/types'
import type { TradeOffer } from '@/lib/trading/api'
import { VisibleBoostCardTile } from '@/components/cards/BoostCardTile'

interface TradeOfferListProps {
  offers: TradeOffer[]
  emptyMessage: string
  selectedOfferId?: string | null
  onSelect?: (offer: TradeOffer) => void
}

function toUnitTemplate(card: TradeOffer['offered_cards'][number]): UnitCardTemplate | null {
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

function toBoostTemplate(card: TradeOffer['offered_cards'][number]): BoostCardTemplate | null {
  if (card.template_category !== 'boost' || !card.template_boost_type || !card.template_effect_kind) {
    return null
  }
  return {
    id: card.template_id,
    category: 'boost',
    rank: card.template_rank as Rank,
    name: card.template_name,
    flavorText: card.template_flavor_text,
    boostType: card.template_boost_type,
    effectKind: card.template_effect_kind,
    instantEffectKind: card.template_instant_effect_kind,
    pctStr: card.template_pct_str,
    pctLng: card.template_pct_lng,
    pctDef: card.template_pct_def,
    pctHp: card.template_pct_hp,
    totalSupply: card.template_total_supply,
  }
}

function OfferCardThumbnail({
  card,
  onZoom,
}: {
  card: TradeOffer['offered_cards'][number]
  onZoom: (event: MouseEvent<HTMLButtonElement>, card: UnitCardTemplate) => void
}) {
  const template = toUnitTemplate(card)
  const boostTemplate = toBoostTemplate(card)
  if (!template && !boostTemplate) {
    return (
      <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
        {card.template_name}
      </span>
    )
  }

  return (
    <div className="relative w-24 shrink-0">
      {template ? (
        <>
          <TradingCard template={template} stats={applyRank(template.baseStats, template.rank)} compact />
          <CardZoomIconButton
            cardName={template.name}
            className="absolute right-1 top-1"
            onClick={(event) => onZoom(event, template)}
          />
        </>
      ) : boostTemplate ? (
        <VisibleBoostCardTile template={boostTemplate} compact />
      ) : null}
    </div>
  )
}

function criteriaLabel(offer: TradeOffer) {
  if (!offer.requested_criteria) return 'Cokoliv rozumného'

  const parts: string[] = []
  if (offer.requested_criteria.rank) parts.push(`rank ${offer.requested_criteria.rank}`)
  if (offer.requested_criteria.unit_type) parts.push(`typ ${offer.requested_criteria.unit_type}`)
  return parts.join(' · ') || 'Cokoliv rozumného'
}

export function TradeOfferList({
  offers,
  emptyMessage,
  selectedOfferId = null,
  onSelect,
}: TradeOfferListProps) {
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()

  function handleOfferKeyDown(event: KeyboardEvent<HTMLDivElement>, offer: TradeOffer) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect?.(offer)
  }

  if (offers.length === 0) {
    return <p className="text-sm text-zinc-400">{emptyMessage}</p>
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {offers.map((offer) => (
          <li key={offer.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect?.(offer)}
              onKeyDown={(event) => handleOfferKeyDown(event, offer)}
              className={`w-full rounded-2xl border p-4 text-left transition ${
                selectedOfferId === offer.id
                  ? 'border-amber-500 bg-amber-950/20'
                  : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">
                    {offer.type === 'public' ? 'Veřejná nabídka' : 'Přímá nabídka'} · {offer.status}
                  </div>
                  <h3 className="mt-1 text-lg font-semibold">
                    <span>{offer.initiator_display_name}</span>
                    {offer.target_display_name && (
                      <>
                        <span aria-hidden="true"> → </span>
                        <span>{offer.target_display_name}</span>
                      </>
                    )}
                  </h3>
                  {offer.message && <p className="mt-1 text-sm text-zinc-300">{offer.message}</p>}
                </div>
                <div className="text-right text-xs text-zinc-500">
                  <div>Vytvořeno {new Date(offer.created_at).toLocaleString('cs-CZ')}</div>
                  <div>Vyprší {new Date(offer.expires_at).toLocaleString('cs-CZ')}</div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Nabízí</div>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {offer.offered_cards.map((card) => (
                      <OfferCardThumbnail
                        key={card.instance_id}
                        card={card}
                        onZoom={(event, template) => {
                          event.stopPropagation()
                          openZoom(template, applyRank(template.baseStats, template.rank))
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {offer.type === 'public' ? 'Hledá' : 'Požaduje'}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {offer.type === 'public' ? (
                      <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
                        {criteriaLabel(offer)}
                      </span>
                    ) : offer.requested_cards.length > 0 ? (
                      offer.requested_cards.map((card) => (
                        <OfferCardThumbnail
                          key={card.instance_id}
                          card={card}
                          onZoom={(event, template) => {
                            event.stopPropagation()
                            openZoom(template, applyRank(template.baseStats, template.rank))
                          }}
                        />
                      ))
                    ) : (
                      <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-200">Bez konkrétní karty</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
    </>
  )
}
