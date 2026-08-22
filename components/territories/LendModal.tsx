'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { TradingCard } from '@/components/cards/TradingCard'
import { CardZoomIconButton, CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'
import { NationId } from '@/lib/players/nations'
import { formatEta } from '@/lib/time/formatEta'
import { chebyshevDistance, transferHours } from '@/lib/territories/formulas'
import type { CardInstanceWithTemplate, MyTerritory, Territory } from '@/lib/territories/api'
import { getCardInstancesAtTerritory, getMyTerritories, getPlayerPublicInfo, lendTroops } from '@/lib/territories/api'

export interface LendModalProps {
  destinationTerritory: Territory
  myPlayerId: string | null
  onClose: () => void
  onLent?: () => void
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

export default function LendModal({ destinationTerritory, myPlayerId, onClose, onLent }: LendModalProps) {
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()
  const [myTerritories, setMyTerritories] = useState<MyTerritory[] | null>(null)
  const [territoriesError, setTerritoriesError] = useState<string | null>(null)
  const [originTerritoryId, setOriginTerritoryId] = useState('')
  const [originInstances, setOriginInstances] = useState<CardInstanceWithTemplate[] | null>(null)
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>([])
  const [durationHours, setDurationHours] = useState('24')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [playerNation, setPlayerNation] = useState<NationId | null>(null)
  const loadRequestIdRef = useRef(0)

  useEffect(() => {
    if (!myPlayerId) return
    getPlayerPublicInfo(myPlayerId).then(({ data }) => {
      setPlayerNation((data?.nation as NationId) ?? null)
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
      setMyTerritories(data ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [myPlayerId])

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
      if (ci.owner_id !== myPlayerId || ci.status !== 'stationed' || ci.loaned_from_id || !ci.card_templates) return false
      return Boolean(toUnitTemplate(ci.card_templates))
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

  function toggleInstance(instanceId: string) {
    setSelectedInstanceIds((current) =>
      current.includes(instanceId) ? current.filter((id) => id !== instanceId) : [...current, instanceId],
    )
  }

  const originTerritory = myTerritories?.find((t) => t.id === Number(originTerritoryId)) ?? null

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
    const distance = chebyshevDistance(originTerritory, destinationTerritory)
    const hours = transferHours(distance, playerNation ?? undefined, groupSpeed)
    return formatEta(new Date(Date.now() + hours * 3600000).toISOString())
  }, [originTerritory, destinationTerritory, playerNation, groupSpeed])

  async function handleSubmit() {
    const parsedDuration = Number(durationHours)
    if (selectedInstanceIds.length === 0 || !Number.isFinite(parsedDuration)) {
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    const { error } = await lendTroops(destinationTerritory.id, selectedInstanceIds, parsedDuration)
    setSubmitting(false)
    if (error) {
      setSubmitError(error.message)
      return
    }
    onLent?.()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-xl border border-zinc-700 bg-zinc-950 p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            Poslat vojska na pomoc — {destinationTerritory.name ? `${destinationTerritory.name} ` : ''}(
            {destinationTerritory.x}, {destinationTerritory.y})
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
            Odkud posíláš
            <select
              aria-label="Odkud posíláš"
              value={originTerritoryId}
              onChange={(event) => handleSelectOrigin(event.target.value)}
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

          <label className="flex flex-col gap-1 text-sm text-zinc-400">
            Doba půjčky (hodiny)
            <input
              type="number"
              min={0}
              max={336}
              value={durationHours}
              onChange={(event) => setDurationHours(event.target.value)}
              aria-label="Doba půjčky (hodiny)"
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            />
          </label>

          {etaText ? (
            <p className="text-sm text-zinc-300">
              Vojska dorazí na cíl: <span className="font-semibold">{etaText}</span>
            </p>
          ) : null}

          {loading ? <p className="text-sm text-zinc-400">Načítám vojska…</p> : null}
          {territoriesError ? <p className="text-sm text-red-400">{territoriesError}</p> : null}
          {loadError ? <p className="text-sm text-red-400">{loadError}</p> : null}

          {originInstances !== null && originInstances.length === 0 ? (
            <p className="text-sm text-zinc-400">Na tomto území nemáš žádná dostupná vojska.</p>
          ) : null}

          {originInstances !== null && originInstances.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm text-zinc-400">Vyber vojska k půjčení</legend>
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto p-2 [scrollbar-gutter:stable] sm:grid-cols-4">
                {originInstances.map((instance) => {
                  const unitTemplate = instance.card_templates ? toUnitTemplate(instance.card_templates) : null
                  if (!unitTemplate) return null
                  const checked = selectedInstanceIds.includes(instance.instance_id)
                  const stats = applyRank(unitTemplate.baseStats, unitTemplate.rank)
                  return (
                    <div key={instance.instance_id} className="relative flex flex-col items-center gap-1">
                      <button
                        type="button"
                        data-testid={`lend-card-select-${instance.instance_id}`}
                        aria-label={`Vybrat kartu ${unitTemplate.name}`}
                        aria-pressed={checked}
                        onClick={() => toggleInstance(instance.instance_id)}
                        className={`block w-full rounded-xl text-left transition hover:scale-[1.02] ${checked ? 'ring-4 ring-sky-500' : ''}`}
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

          {submitError ? <p className="text-sm text-red-400">{submitError}</p> : null}

          <button
            type="button"
            disabled={submitting || !originTerritoryId || selectedInstanceIds.length === 0 || !durationHours.trim()}
            onClick={() => void handleSubmit()}
            className="rounded bg-sky-700 px-3 py-2 font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Půjčuji vojska…' : `Půjčit vojska (${selectedInstanceIds.length})`}
          </button>
        </div>
        <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
      </div>
    </div>
  )
}
