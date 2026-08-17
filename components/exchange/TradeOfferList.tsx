'use client'

import type { TradeOffer } from '@/lib/trading/api'

interface TradeOfferListProps {
  offers: TradeOffer[]
  emptyMessage: string
  selectedOfferId?: string | null
  onSelect?: (offer: TradeOffer) => void
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
  if (offers.length === 0) {
    return <p className="text-sm text-zinc-400">{emptyMessage}</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {offers.map((offer) => (
        <li key={offer.id}>
          <button
            type="button"
            onClick={() => onSelect?.(offer)}
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
                <div className="mt-1 flex flex-wrap gap-2">
                  {offer.offered_cards.map((card) => (
                    <span key={card.instance_id} className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
                      {card.template_name}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {offer.type === 'public' ? 'Hledá' : 'Požaduje'}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {offer.type === 'public' ? (
                    <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
                      {criteriaLabel(offer)}
                    </span>
                  ) : offer.requested_cards.length > 0 ? (
                    offer.requested_cards.map((card) => (
                      <span key={card.instance_id} className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-200">
                        {card.template_name}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-200">Bez konkrétní karty</span>
                  )}
                </div>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
