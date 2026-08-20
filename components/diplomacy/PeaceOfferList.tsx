'use client'

import Link from 'next/link'
import type { DiplomacyOfferRow } from '@/lib/diplomacy/types'

interface PeaceOfferListProps {
  offers: DiplomacyOfferRow[]
  currentPlayerId: string
  onAccept: (offerId: string) => void | Promise<void>
  onReject: (offerId: string) => void | Promise<void>
  onCancel: (offerId: string) => void | Promise<void>
}

function territoryLink(offer: DiplomacyOfferRow) {
  if (offer.offered_territory_x == null || offer.offered_territory_y == null) {
    return offer.offered_territory_name ?? 'Neznámé území'
  }

  return (
    <Link
      href={`/map?x=${offer.offered_territory_x}&y=${offer.offered_territory_y}`}
      className="underline"
    >
      {offer.offered_territory_name
        ? `${offer.offered_territory_name} (${offer.offered_territory_x}, ${offer.offered_territory_y})`
        : `Území (${offer.offered_territory_x}, ${offer.offered_territory_y})`}
    </Link>
  )
}

function offerSummary(offer: DiplomacyOfferRow) {
  if (offer.kind === 'white_peace') {
    return 'Bílý mír bez tributu.'
  }

  const parts: string[] = []
  if (offer.offered_cards.length > 0) {
    parts.push(
      `Karty: ${offer.offered_cards.map((card) => card.template_name).join(', ')}`
    )
  }
  if (offer.offered_territory_id != null) {
    parts.push('Území: ')
  }

  return parts.length > 0 ? parts.join(' · ') : 'Tribut bez detailů.'
}

export function PeaceOfferList({
  offers,
  currentPlayerId,
  onAccept,
  onReject,
  onCancel,
}: PeaceOfferListProps) {
  if (offers.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
        Žádné čekající nabídky míru.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {offers.map((offer) => {
        const incoming = offer.target_id === currentPlayerId
        return (
          <article key={offer.id} className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
                <span>{incoming ? 'Příchozí nabídka' : 'Odchozí nabídka'}</span>
                <span>·</span>
                <span>{offer.kind === 'white_peace' ? 'Bílý mír' : 'Mír za tribut'}</span>
              </div>
              <h3 className="text-lg font-semibold text-zinc-100">
                {incoming ? offer.initiator_display_name : offer.target_display_name}
              </h3>
              <p className="text-sm text-zinc-300">{offerSummary(offer)}</p>
              {offer.offered_territory_id != null && (
                <p className="text-sm text-amber-300">{territoryLink(offer)}</p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {incoming ? (
                <>
                  <button
                    type="button"
                    onClick={() => void onAccept(offer.id)}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Přijmout
                  </button>
                  <button
                    type="button"
                    onClick={() => void onReject(offer.id)}
                    className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
                  >
                    Odmítnout
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void onCancel(offer.id)}
                  className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
                >
                  Zrušit nabídku
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
