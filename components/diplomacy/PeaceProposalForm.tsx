'use client'

import { useMemo, useState } from 'react'
import { TradingCard } from '@/components/cards/TradingCard'
import { VisibleBoostCardTile } from '@/components/cards/BoostCardTile'
import { applyRank } from '@/lib/cards/combat'
import type { MyCardInstance, MyTerritory } from '@/lib/territories/api'
import type { ProposePeaceInput } from '@/lib/diplomacy/types'
import type { BoostCardTemplate, Rank, UnitCardTemplate, UnitType } from '@/lib/cards/types'

interface PeaceProposalFormProps {
  isOpen: boolean
  targetPlayerId: string
  targetPlayerName: string
  availableCards: MyCardInstance[]
  availableTerritories: MyTerritory[]
  onClose: () => void
  onSubmit: (input: ProposePeaceInput) => Promise<{ ok: boolean; error?: string | null }>
}

function toUnitTemplate(card: MyCardInstance): UnitCardTemplate | null {
  if (card.card_templates?.category !== 'unit' || !card.card_templates.base_stats || !card.card_templates.unit_type) {
    return null
  }

  return {
    id: card.template_id,
    category: 'unit',
    unitType: card.card_templates.unit_type as UnitType,
    rank: card.card_templates.rank as Rank,
    name: card.card_templates.name ?? 'Neznámá karta',
    flavorText: card.card_templates.flavor_text ?? '',
    baseStats: card.card_templates.base_stats,
    totalSupply: card.card_templates.total_supply,
  }
}

function toBoostTemplate(card: MyCardInstance): BoostCardTemplate | null {
  if (
    card.card_templates?.category !== 'boost' ||
    !card.card_templates.boost_type ||
    !card.card_templates.effect_kind
  ) {
    return null
  }

  return {
    id: card.template_id,
    category: 'boost',
    rank: card.card_templates.rank as Rank,
    name: card.card_templates.name ?? 'Neznámý boost',
    flavorText: card.card_templates.flavor_text ?? '',
    boostType: card.card_templates.boost_type,
    effectKind: card.card_templates.effect_kind,
    instantEffectKind: card.card_templates.instant_effect_kind ?? null,
    pctStr: card.card_templates.pct_str ?? null,
    pctLng: card.card_templates.pct_lng ?? null,
    pctDef: card.card_templates.pct_def ?? null,
    pctHp: card.card_templates.pct_hp ?? null,
    totalSupply: card.card_templates.total_supply,
  }
}

function territoryLabel(territory: MyTerritory) {
  const base = territory.name ? `${territory.name} ` : ''
  return `${base}(${territory.x}, ${territory.y})`
}

export function PeaceProposalForm({
  isOpen,
  targetPlayerId,
  targetPlayerName,
  availableCards,
  availableTerritories,
  onClose,
  onSubmit,
}: PeaceProposalFormProps) {
  const [kind, setKind] = useState<'white_peace' | 'tribute_peace'>('white_peace')
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const garrisonedTerritoryIds = useMemo(
    () =>
      new Set(
        availableCards
          .filter((card) => card.status === 'stationed' && card.stationed_territory_id != null)
          .map((card) => card.stationed_territory_id as number),
      ),
    [availableCards],
  )

  const selectableCards = useMemo(
    () =>
      availableCards.filter(
        (card) =>
          card.status === 'stationed' &&
          (card.card_templates?.category === 'unit' || card.card_templates?.category === 'boost'),
      ),
    [availableCards],
  )

  const selectableTerritories = useMemo(
    () =>
      availableTerritories.filter(
        (territory) =>
          !territory.is_home &&
          !territory.claim_locked_by &&
          !territory.battle_locked_by &&
          !garrisonedTerritoryIds.has(territory.id),
      ),
    [availableTerritories, garrisonedTerritoryIds],
  )

  if (!isOpen) return null

  async function handleSubmit() {
    if (kind === 'tribute_peace' && selectedCardIds.length === 0 && selectedTerritoryId == null) {
      setError('Vyber alespoň jednu kartu nebo jedno území jako tribut.')
      return
    }

    setSubmitting(true)
    setError(null)

    const result = await onSubmit({
      targetPlayerId,
      kind,
      offeredCardIds: kind === 'tribute_peace' ? selectedCardIds : [],
      offeredTerritoryId: kind === 'tribute_peace' ? selectedTerritoryId : null,
    })

    setSubmitting(false)

    if (!result.ok) {
      setError(result.error ?? 'Nepodařilo se odeslat návrh míru.')
      return
    }

    onClose()
  }

  return (
    <div
      data-testid="peace-proposal-overlay"
      className="fixed inset-0 z-[70] flex flex-col bg-zinc-950 p-4 md:items-center md:justify-center md:bg-black/70"
      onClick={onClose}
    >
      <div
        className="flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-800 bg-zinc-950 md:max-h-[90vh] md:w-full md:max-w-5xl md:flex-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">Návrh míru pro {targetPlayerName}</h2>
            <p className="text-sm text-zinc-400">Bílý mír nebo mír za tribut.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-700 px-3 py-1 text-sm text-zinc-300"
          >
            Zavřít
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setKind('white_peace')}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                kind === 'white_peace' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Bílý mír
            </button>
            <button
              type="button"
              onClick={() => setKind('tribute_peace')}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                kind === 'tribute_peace' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Mír za tribut
            </button>
          </div>

          {kind === 'tribute_peace' && (
            <>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-zinc-200">Nabízené karty</h3>
                {selectableCards.length === 0 ? (
                  <p className="text-sm text-zinc-500">Nemáš žádné vhodné karty pro nabídku.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {selectableCards.map((card) => {
                      const unitTemplate = toUnitTemplate(card)
                      const boostTemplate = toBoostTemplate(card)
                      const checked = selectedCardIds.includes(card.instance_id)
                      return (
                        <button
                          key={card.instance_id}
                          type="button"
                          onClick={() =>
                            setSelectedCardIds((current) =>
                              current.includes(card.instance_id)
                                ? current.filter((value) => value !== card.instance_id)
                                : [...current, card.instance_id],
                            )
                          }
                          className={`rounded-2xl p-1 text-left ${
                            checked ? 'ring-2 ring-amber-500' : 'ring-1 ring-zinc-800'
                          }`}
                        >
                          {unitTemplate ? (
                            <TradingCard
                              template={unitTemplate}
                              stats={applyRank(unitTemplate.baseStats, unitTemplate.rank)}
                              compact
                            />
                          ) : boostTemplate ? (
                            <VisibleBoostCardTile template={boostTemplate} compact />
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>

              <label className="flex flex-col gap-2 text-sm text-zinc-300">
                Nabízené území
                <select
                  value={selectedTerritoryId ?? ''}
                  onChange={(event) => setSelectedTerritoryId(event.target.value ? Number(event.target.value) : null)}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
                >
                  <option value="">Žádné území</option>
                  {selectableTerritories.map((territory) => (
                    <option key={territory.id} value={territory.id}>
                      {territoryLabel(territory)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Odesílám…' : 'Odeslat návrh'}
          </button>
        </div>
      </div>
    </div>
  )
}
