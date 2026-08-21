'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { DiplomacyOfferRow, NonAggressionPactRow } from '@/lib/diplomacy/types'
import { PlayerSearchInput, type PlayerSearchSelection } from '@/components/players/PlayerSearchInput'

type ActionResult = void | boolean | Promise<void | boolean>

interface PactListProps {
  pacts: NonAggressionPactRow[]
  offers: DiplomacyOfferRow[]
  currentPlayerId: string
  onPropose: (targetPlayerId: string) => ActionResult
  onAccept: (offerId: string) => ActionResult
  onReject: (offerId: string) => ActionResult
  onCancel: (offerId: string) => ActionResult
}

function pactLink(pact: NonAggressionPactRow) {
  if (pact.other_home_x == null || pact.other_home_y == null) {
    return <span>{pact.other_player_display_name}</span>
  }

  return (
    <Link href={`/map?x=${pact.other_home_x}&y=${pact.other_home_y}`} className="underline">
      {pact.other_player_display_name}
    </Link>
  )
}

export function PactList({ pacts, offers, currentPlayerId, onPropose, onAccept, onReject, onCancel }: PactListProps) {
  const [targetPlayer, setTargetPlayer] = useState<PlayerSearchSelection | null>(null)

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <h3 className="text-lg font-semibold text-zinc-100">Navrhnout pakt o neútočení</h3>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <PlayerSearchInput value={targetPlayer} onChange={setTargetPlayer} />
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!targetPlayer) return
              const ok = await onPropose(targetPlayer.id)
              if (ok !== false) setTargetPlayer(null)
            }}
            disabled={!targetPlayer}
            className="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Navrhnout pakt
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-zinc-100">Aktivní pakty</h3>
        {pacts.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
            Nemáš žádný aktivní pakt o neútočení.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pacts.map((pact) => (
              <article key={pact.other_player_id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                <h4 className="text-lg font-semibold text-zinc-100">{pactLink(pact)}</h4>
                <p className="text-sm text-zinc-400">
                  {pact.other_kingdom_name ? `${pact.other_kingdom_name} · ` : ''}
                  Uzavřeno {new Date(pact.pact_started_at).toLocaleString('cs-CZ')}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-zinc-100">Čekající návrhy</h3>
        {offers.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
            Žádné čekající návrhy paktu.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {offers.map((offer) => {
              const incoming = offer.target_id === currentPlayerId
              return (
                <article key={offer.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
                      <span>{incoming ? 'Příchozí návrh' : 'Odchozí návrh'}</span>
                      <span>·</span>
                      <span>Pakt o neútočení</span>
                    </div>
                    <h4 className="text-lg font-semibold text-zinc-100">
                      {incoming ? offer.initiator_display_name : offer.target_display_name}
                    </h4>
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
                        Zrušit návrh
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
