'use client'

import { useEffect, useMemo, useState } from 'react'
import { TradingCard } from '@/components/cards/TradingCard'
import { CardZoomIconButton, CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import { getMyCoalition } from '@/lib/diplomacy/api'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'
import { NationId } from '@/lib/players/nations'
import { formatEta } from '@/lib/time/formatEta'
import { chebyshevDistance, transferHours } from '@/lib/territories/formulas'
import type { CardInstanceWithTemplate, Territory } from '@/lib/territories/api'
import { getMyTerritories, getPlayerPublicInfo, lendTroops } from '@/lib/territories/api'

interface DestinationOption {
  id: number
  x: number
  y: number
  name?: string | null
  ownerId: string
  ownerDisplayName: string
}

export interface LendModalProps {
  originTerritory: Territory
  myPlayerId: string | null
  instances: CardInstanceWithTemplate[] | null
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

export default function LendModal({ originTerritory, myPlayerId, instances, onClose, onLent }: LendModalProps) {
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()
  const [destinationTerritories, setDestinationTerritories] = useState<DestinationOption[]>([])
  const [destinationTerritoryId, setDestinationTerritoryId] = useState('')
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>([])
  const [durationHours, setDurationHours] = useState('24')
  const [loadingDestinations, setLoadingDestinations] = useState(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [playerNation, setPlayerNation] = useState<NationId | null>(null)

  useEffect(() => {
    if (!myPlayerId) return
    getPlayerPublicInfo(myPlayerId).then(({ data }) => {
      setPlayerNation((data?.nation as NationId) ?? null)
    })
  }, [myPlayerId])

  useEffect(() => {
    if (!myPlayerId) return
    let ignore = false

    async function load() {
      setLoadingDestinations(true)
      setLoadingError(null)

      const { data: coalitionRows, error: coalitionError } = await getMyCoalition()
      if (ignore) return
      if (coalitionError) {
        setLoadingError(coalitionError.message)
        setLoadingDestinations(false)
        return
      }

      const coalition = coalitionRows?.[0]
      const members = coalition?.members.filter((member) => member.player_id !== myPlayerId) ?? []
      const territoryResults = await Promise.all(
        members.map(async (member) => {
          const { data, error } = await getMyTerritories(member.player_id)
          if (error) throw new Error(error.message)
          return (data ?? []).map((territory) => ({
            id: territory.id,
            x: territory.x,
            y: territory.y,
            name: territory.name ?? null,
            ownerId: member.player_id,
            ownerDisplayName: member.display_name,
          }))
        }),
      ).catch((error: Error) => {
        if (!ignore) setLoadingError(error.message)
        return []
      })

      if (ignore) return
      setDestinationTerritories(territoryResults.flat())
      setLoadingDestinations(false)
    }

    void load()
    return () => {
      ignore = true
    }
  }, [myPlayerId])

  const eligibleInstances = useMemo(
    () =>
      (instances ?? []).filter((instance) => {
        if (instance.owner_id !== myPlayerId || instance.status !== 'stationed' || instance.loaned_from_id) return false
        return Boolean(instance.card_templates && toUnitTemplate(instance.card_templates))
      }),
    [instances, myPlayerId],
  )

  const destination = destinationTerritories.find((territory) => territory.id === Number(destinationTerritoryId)) ?? null

  const etaText = useMemo(() => {
    if (!destination) return null
    const distance = chebyshevDistance(originTerritory, destination)
    const selectedSpeeds = eligibleInstances
      .filter((instance) => selectedInstanceIds.includes(instance.instance_id))
      .map((instance) => instance.card_templates?.base_stats?.speed)
      .filter((speed): speed is number => typeof speed === 'number')
    const groupSpeed = selectedSpeeds.length > 0 ? Math.min(...selectedSpeeds) : undefined
    const hours = transferHours(distance, playerNation ?? undefined, groupSpeed)
    return formatEta(new Date(Date.now() + hours * 3600000).toISOString())
  }, [destination, eligibleInstances, originTerritory, playerNation, selectedInstanceIds])

  function toggleInstance(instanceId: string) {
    setSelectedInstanceIds((current) =>
      current.includes(instanceId) ? current.filter((id) => id !== instanceId) : [...current, instanceId],
    )
  }

  async function handleSubmit() {
    const parsedDestinationId = Number(destinationTerritoryId)
    const parsedDuration = Number(durationHours)
    if (!Number.isFinite(parsedDestinationId) || selectedInstanceIds.length === 0 || !Number.isFinite(parsedDuration)) {
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    const { error } = await lendTroops(parsedDestinationId, selectedInstanceIds, parsedDuration)
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
            Půjčit vojska — {originTerritory.name ? `${originTerritory.name} ` : ''}({originTerritory.x}, {originTerritory.y})
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
            Kam půjčuješ
            <select
              aria-label="Kam půjčuješ"
              value={destinationTerritoryId}
              onChange={(event) => setDestinationTerritoryId(event.target.value)}
              disabled={loadingDestinations}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
            >
              <option value="">{loadingDestinations ? 'Načítám cíle…' : '— vyber cílové území —'}</option>
              {destinationTerritories.map((territory) => (
                <option key={territory.id} value={territory.id}>
                  {territory.ownerDisplayName} — {territory.name ? `${territory.name} ` : ''}({territory.x}, {territory.y})
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

          {loadingError ? <p className="text-sm text-red-400">{loadingError}</p> : null}
          {!loadingDestinations && destinationTerritories.length === 0 ? (
            <p className="text-sm text-zinc-400">V koalici teď není žádné spojenecké území pro půjčku.</p>
          ) : null}

          {eligibleInstances.length === 0 ? (
            <p className="text-sm text-zinc-400">Na tomto území nemáš žádná vlastní dostupná vojska k půjčení.</p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm text-zinc-400">Vyber vojska k půjčení</legend>
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {eligibleInstances.map((instance) => {
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
            disabled={
              submitting ||
              !destinationTerritoryId ||
              selectedInstanceIds.length === 0 ||
              !durationHours.trim() ||
              destinationTerritories.length === 0
            }
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
