'use client'

import { useState } from 'react'
import { Territory, CardInstanceWithTemplate, getCardInstancesAtTerritory } from '@/lib/territories/api'
import { declareAttack } from '@/lib/battles/api'
import { TradingCard } from '@/components/cards/TradingCard'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'

export interface DeclareAttackModalProps {
  /** The target territory being attacked (not the caller's own). */
  territory: Territory
  myPlayerId: string | null
  onClose: () => void
  /** Called after a successful declare_attack, so the parent can refresh/close. */
  onDeclared?: () => void
}

/** Rebuilds the `UnitCardTemplate` shape `TradingCard` expects from the flat DB row (mirrors GarrisonModal's toUnitTemplate). */
function toUnitTemplate(row: NonNullable<CardInstanceWithTemplate['card_templates']>): UnitCardTemplate | null {
  if (row.category !== 'unit' || !row.base_stats || !row.unit_type) return null
  return {
    id: row.id,
    category: 'unit',
    unitType: row.unit_type as UnitType,
    rank: row.rank as Rank,
    name: row.name,
    flavorText: row.flavor_text,
    baseStats: row.base_stats,
    totalSupply: row.total_supply,
  }
}

/**
 * Declare-attack modal (Task 17): pick one of the caller's own territories
 * as the origin, load its stationed unit-category cards, select a subset
 * to send, then call declare_attack. Opened from a territory popup (e.g.
 * GarrisonModal) for any territory that isn't the caller's own.
 */
export default function DeclareAttackModal({ territory, myPlayerId, onClose, onDeclared }: DeclareAttackModalProps) {
  const [originTerritoryId, setOriginTerritoryId] = useState('')
  const [originInstances, setOriginInstances] = useState<CardInstanceWithTemplate[] | null>(null)
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleLoadOrigin() {
    const originId = Number(originTerritoryId)
    if (!Number.isFinite(originId)) return
    setLoading(true)
    setLoadError(null)
    setOriginInstances(null)
    setSelectedInstanceIds([])
    const { data, error } = await getCardInstancesAtTerritory(originId)
    setLoading(false)
    if (error) {
      setLoadError(error.message)
      return
    }
    const eligible = (data ?? []).filter(
      (ci) => ci.owner_id === myPlayerId && ci.status === 'stationed' && ci.card_templates?.category === 'unit'
    )
    setOriginInstances(eligible)
  }

  function toggleInstance(id: string) {
    setSelectedInstanceIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  async function handleSubmit() {
    const originId = Number(originTerritoryId)
    if (!Number.isFinite(originId) || selectedInstanceIds.length === 0) return
    setSubmitting(true)
    setSubmitError(null)
    const { error } = await declareAttack(originId, territory.id, selectedInstanceIds)
    setSubmitting(false)
    if (error) {
      setSubmitError(error.message)
      return
    }
    setSuccess(true)
    onDeclared?.()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        data-testid="declare-attack-modal"
        className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            Vyhlásit útok — území ({territory.x}, {territory.y})
          </h2>
          <button
            type="button"
            aria-label="Zavřít"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        {success ? (
          <p className="text-sm text-emerald-400">
            Útok vyslán! Vojska dorazí na cíl po uplynutí doby přesunu, poté začne bitva.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Původní území (ID)
              <div className="flex gap-2">
                <input
                  aria-label="Původní území"
                  value={originTerritoryId}
                  onChange={(e) => setOriginTerritoryId(e.target.value)}
                  className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
                />
                <button
                  type="button"
                  disabled={loading || !originTerritoryId}
                  onClick={handleLoadOrigin}
                  className="rounded bg-zinc-800 px-3 py-1 text-zinc-100 disabled:opacity-50"
                >
                  {loading ? 'Načítám…' : 'Načíst vojska'}
                </button>
              </div>
            </label>

            {loadError && <p className="text-red-400 text-sm">{loadError}</p>}

            {originInstances !== null && originInstances.length === 0 && (
              <p className="text-sm text-zinc-400">Na tomto území nemáš žádná dostupná vojska.</p>
            )}

            {originInstances !== null && originInstances.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm text-zinc-400">Vyber vojska k útoku</legend>
                <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                  {originInstances.map((instance) => {
                    const unitTemplate = instance.card_templates ? toUnitTemplate(instance.card_templates) : null
                    if (!unitTemplate) return null
                    const checked = selectedInstanceIds.includes(instance.instance_id)
                    return (
                      <label
                        key={instance.instance_id}
                        className={`flex cursor-pointer flex-col items-center gap-1 rounded p-1 ${
                          checked ? 'ring-2 ring-red-500' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => toggleInstance(instance.instance_id)}
                        />
                        <TradingCard
                          template={unitTemplate}
                          stats={applyRank(unitTemplate.baseStats, unitTemplate.rank)}
                          compact
                        />
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {submitError && <p className="text-red-400 text-sm">{submitError}</p>}

            <button
              type="button"
              disabled={submitting || !originTerritoryId || selectedInstanceIds.length === 0}
              onClick={handleSubmit}
              className="rounded bg-red-700 px-3 py-2 font-semibold text-white disabled:opacity-50"
            >
              {submitting ? 'Vyhlašuji útok…' : `Zaútočit (${selectedInstanceIds.length} vojsk)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
