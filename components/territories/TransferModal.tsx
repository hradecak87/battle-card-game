'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CardInstanceWithTemplate,
  MyTerritory,
  Territory,
  getCardInstancesAtTerritory,
  getMyTerritories,
  getPlayerPublicInfo,
  startTransfer,
} from '@/lib/territories/api'
import { TradingCard } from '@/components/cards/TradingCard'
import { CardZoomIconButton, CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'
import { chebyshevDistance, transferHours } from '@/lib/territories/formulas'
import { formatEta } from '@/lib/time/formatEta'
import { NationId } from '@/lib/players/nations'

export interface TransferModalProps {
  /** The caller-owned territory receiving the transferred troops. */
  territory: Territory
  myPlayerId: string | null
  onClose: () => void
  /** Called after a successful transfer so the parent can refresh/close. */
  onTransferred?: () => void
}

function toUnitTemplate(row: NonNullable<CardInstanceWithTemplate['card_templates']>): UnitCardTemplate | null {
  if (row.category !== 'unit' || !row.base_stats || !row.unit_type) return null
  return {
    id: row.id,
    category: 'unit',
    unitType: row.unit_type as UnitType,
    rank: row.rank as Rank,
    name: row.name ?? 'Neznámá karta',
    flavorText: row.flavor_text ?? '',
    baseStats: row.base_stats,
    totalSupply: row.total_supply,
  }
}

export default function TransferModal({ territory, myPlayerId, onClose, onTransferred }: TransferModalProps) {
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()
  const [myTerritories, setMyTerritories] = useState<MyTerritory[] | null>(null)
  const [territoriesError, setTerritoriesError] = useState<string | null>(null)
  const [originTerritoryId, setOriginTerritoryId] = useState('')
  const [originInstances, setOriginInstances] = useState<CardInstanceWithTemplate[] | null>(null)
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [attackerNation, setAttackerNation] = useState<NationId | null>(null)
  const loadRequestIdRef = useRef(0)

  useEffect(() => {
    if (!myPlayerId) return
    getPlayerPublicInfo(myPlayerId).then(({ data }) => {
      setAttackerNation((data?.nation as NationId) ?? null)
    })
  }, [myPlayerId])

  useEffect(() => {
    if (!myPlayerId) return
    let cancelled = false
    getMyTerritories(myPlayerId).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        setTerritoriesError(error.message)
        return
      }
      setMyTerritories((data ?? []).filter((t) => t.id !== territory.id))
    })
    return () => {
      cancelled = true
    }
  }, [myPlayerId, territory.id])

  async function handleLoadOrigin(originId: number) {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setLoading(true)
    setLoadError(null)
    setOriginInstances(null)
    setSelectedInstanceIds([])
    const { data, error } = await getCardInstancesAtTerritory(originId)
    if (loadRequestIdRef.current !== requestId) return
    setLoading(false)
    if (error) {
      setLoadError(error.message)
      return
    }
    const eligible = (data ?? []).filter((ci) => {
      if (ci.owner_id !== myPlayerId || ci.status !== 'stationed' || !ci.card_templates) return false
      const template = toUnitTemplate(ci.card_templates)
      return Boolean(template)
    })
    setOriginInstances(eligible)
  }

  function handleSelectOrigin(value: string) {
    setOriginTerritoryId(value)
    const originId = Number(value)
    if (value && Number.isFinite(originId)) {
      handleLoadOrigin(originId)
    } else {
      loadRequestIdRef.current += 1
      setLoading(false)
      setLoadError(null)
      setOriginInstances(null)
      setSelectedInstanceIds([])
    }
  }

  function toggleInstance(id: string) {
    setSelectedInstanceIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  const originTerritory = myTerritories?.find((t) => t.id === Number(originTerritoryId)) ?? null

  // Slowest selected unit sets the pace for the whole group (backlog #12).
  // Falls back to `undefined` (baseline speed, i.e. today's plain formula)
  // until at least one card is selected.
  const groupSpeed = useMemo(() => {
    if (!originInstances || selectedInstanceIds.length === 0) return undefined
    const speeds = originInstances
      .filter((ci) => selectedInstanceIds.includes(ci.instance_id))
      .map((ci) => ci.card_templates?.base_stats?.speed)
      .filter((s): s is number => typeof s === 'number')
    return speeds.length > 0 ? Math.min(...speeds) : undefined
  }, [originInstances, selectedInstanceIds])

  const etaText = useMemo(() => {
    if (!originTerritory) return null
    const distance = chebyshevDistance(originTerritory, territory)
    const hours = transferHours(distance, attackerNation ?? undefined, groupSpeed)
    return formatEta(new Date(Date.now() + hours * 3600000).toISOString())
  }, [originTerritory, territory, attackerNation, groupSpeed])

  async function handleSubmit() {
    const originId = Number(originTerritoryId)
    if (!Number.isFinite(originId) || selectedInstanceIds.length === 0) return
    setSubmitting(true)
    setSubmitError(null)
    const { error } = await startTransfer(originId, territory.id, selectedInstanceIds)
    setSubmitting(false)
    if (error) {
      setSubmitError(error.message)
      return
    }
    onTransferred?.()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        data-testid="transfer-modal"
        className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            Přesunout vojska — území ({territory.x}, {territory.y})
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

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-zinc-400">
            Odkud přesouváš
            <select
              aria-label="Odkud přesouváš"
              value={originTerritoryId}
              onChange={(e) => handleSelectOrigin(e.target.value)}
              disabled={myTerritories === null}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            >
              <option value="">{myTerritories === null ? 'Načítám tvá území…' : '— vyber území —'}</option>
              {myTerritories?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.is_home ? 'Domov' : 'Území'} ({t.x}, {t.y})
                </option>
              ))}
            </select>
          </label>

          {etaText && (
            <p data-testid="transfer-eta" className="text-sm text-zinc-300">
              Vojska dorazí na cíl: <span className="font-semibold">{etaText}</span>
            </p>
          )}

          {loading && <p className="text-sm text-zinc-400">Načítám vojska…</p>}
          {territoriesError && <p className="text-sm text-red-400">{territoriesError}</p>}
          {loadError && <p className="text-sm text-red-400">{loadError}</p>}

          {originInstances !== null && originInstances.length === 0 && (
            <p className="text-sm text-zinc-400">Na tomto území nemáš žádná dostupná vojska.</p>
          )}

          {originInstances !== null && originInstances.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm text-zinc-400">Vyber vojska k přesunu</legend>
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {originInstances.map((instance) => {
                  const unitTemplate = instance.card_templates ? toUnitTemplate(instance.card_templates) : null
                  if (!unitTemplate) return null
                  const checked = selectedInstanceIds.includes(instance.instance_id)
                  const stats = applyRank(unitTemplate.baseStats, unitTemplate.rank)
                  return (
                    <div
                      key={instance.instance_id}
                      className={`relative flex flex-col items-center gap-1 rounded p-1 ${
                        checked ? 'ring-2 ring-emerald-500' : ''
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`transfer-card-select-${instance.instance_id}`}
                        aria-label={`Vybrat kartu ${unitTemplate.name}`}
                        aria-pressed={checked}
                        onClick={() => toggleInstance(instance.instance_id)}
                        className="block w-full cursor-pointer rounded text-left transition hover:scale-[1.02]"
                      >
                        <TradingCard template={unitTemplate} stats={stats} compact />
                      </button>
                      <CardZoomIconButton
                        cardName={unitTemplate.name}
                        className="absolute right-2 top-2"
                        onClick={(event) => {
                          event.stopPropagation()
                          openZoom(unitTemplate, stats)
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </fieldset>
          )}

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}

          <button
            type="button"
            disabled={submitting || !originTerritoryId || selectedInstanceIds.length === 0}
            onClick={handleSubmit}
            className="rounded bg-emerald-700 px-3 py-2 font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Přesouvám vojska…' : `Přesunout vojska (${selectedInstanceIds.length})`}
          </button>
          <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
        </div>
      </div>
    </div>
  )
}
