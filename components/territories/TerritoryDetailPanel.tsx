'use client'

import { useState } from 'react'
import { Territory } from '@/lib/territories/api'
import { UnitCardTemplate, StructureCardTemplate, isUnitTemplate } from '@/lib/cards/types'

export interface CardInstanceOption {
  instanceId: string
  template: UnitCardTemplate | StructureCardTemplate
}

export interface TerritoryDetailPanelProps {
  territory: Territory
  myPlayerId: string | null
  /** Card instances currently stationed at the caller's chosen origin territory. */
  originInstances: CardInstanceOption[]
  garrisonSize?: number
  onClaim: (originTerritoryId: number, cardInstanceIds: string[]) => Promise<void>
  onTransfer: (originTerritoryId: number, cardInstanceIds: string[]) => Promise<void>
  onCancelClaim: (territoryId: number) => Promise<void>
  onBuildStructure: (territoryId: number, cardInstanceId: string) => Promise<void>
}

type TileState =
  | 'empty-lockable'
  | 'claim-in-progress-mine'
  | 'claim-in-progress-other'
  | 'owned-by-me'
  | 'owned-by-other'
  | 'npc-garrisoned'

function tileState(territory: Territory, myPlayerId: string | null): TileState {
  if (territory.claim_locked_by) {
    return territory.claim_locked_by === myPlayerId ? 'claim-in-progress-mine' : 'claim-in-progress-other'
  }
  if (territory.owner_id) {
    return territory.owner_id === myPlayerId ? 'owned-by-me' : 'owned-by-other'
  }
  if (territory.castle_rank || territory.village_rank || territory.wall_rank) return 'npc-garrisoned'
  return 'empty-lockable'
}

/**
 * Territory detail panel (design spec §10): shows owner/difficulty/
 * structures/garrison size, and only the action buttons applicable to the
 * tile's current state. Troop-selection checkboxes are filtered to unit
 * cards (`isUnitTemplate`) so structure cards never appear in the claim/
 * transfer picker; a separate list drives `build_structure`.
 */
export default function TerritoryDetailPanel({
  territory,
  myPlayerId,
  originInstances,
  garrisonSize,
  onClaim,
  onTransfer,
  onCancelClaim,
  onBuildStructure,
}: TerritoryDetailPanelProps) {
  const [originTerritoryId, setOriginTerritoryId] = useState('')
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>([])
  const [selectedStructureInstanceId, setSelectedStructureInstanceId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const state = tileState(territory, myPlayerId)
  const unitOptions = originInstances.filter((o) => isUnitTemplate(o.template))
  const structureOptions = originInstances.filter((o) => !isUnitTemplate(o.template))

  function toggleInstance(id: string) {
    setSelectedInstanceIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  async function run(action: () => Promise<void>) {
    setError(null)
    setSubmitting(true)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div data-testid="territory-detail-panel" className="flex flex-col gap-3 rounded border border-zinc-800 p-4">
      <h2 className="font-bold">
        Území ({territory.x}, {territory.y})
      </h2>
      <p className="text-sm text-zinc-400">Obtížnost: {territory.difficulty}</p>
      {territory.castle_rank && <p className="text-sm text-zinc-400">Hrad: {territory.castle_rank}</p>}
      {territory.village_rank && <p className="text-sm text-zinc-400">Vesnice: {territory.village_rank}</p>}
      {territory.wall_rank && <p className="text-sm text-zinc-400">Hradby: {territory.wall_rank}</p>}
      {typeof garrisonSize === 'number' && (
        <p className="text-sm text-zinc-400">Posádka: {garrisonSize}</p>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {(state === 'empty-lockable') && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col text-sm text-zinc-400">
            Původní území (ID)
            <input
              aria-label="Původní území"
              value={originTerritoryId}
              onChange={(e) => setOriginTerritoryId(e.target.value)}
              className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
            />
          </label>
          <TroopChecklist options={unitOptions} selected={selectedInstanceIds} onToggle={toggleInstance} />
          <button
            type="button"
            disabled={submitting || !originTerritoryId || selectedInstanceIds.length === 0}
            onClick={() =>
              run(() => onClaim(Number(originTerritoryId), selectedInstanceIds))
            }
            className="rounded bg-zinc-100 text-zinc-900 px-3 py-1 font-semibold disabled:opacity-50"
          >
            Zabrat území
          </button>
        </div>
      )}

      {state === 'claim-in-progress-mine' && (
        <button
          type="button"
          disabled={submitting}
          onClick={() => run(() => onCancelClaim(territory.id))}
          className="rounded bg-zinc-100 text-zinc-900 px-3 py-1 font-semibold disabled:opacity-50"
        >
          Zrušit zábor
        </button>
      )}

      {state === 'claim-in-progress-other' && (
        <p className="text-sm text-zinc-400">Toto území právě zabírá jiný hráč.</p>
      )}

      {state === 'owned-by-me' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="flex flex-col text-sm text-zinc-400">
              Původní území (ID)
              <input
                aria-label="Původní území"
                value={originTerritoryId}
                onChange={(e) => setOriginTerritoryId(e.target.value)}
                className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
              />
            </label>
            <TroopChecklist options={unitOptions} selected={selectedInstanceIds} onToggle={toggleInstance} />
            <button
              type="button"
              disabled={submitting || !originTerritoryId || selectedInstanceIds.length === 0}
              onClick={() => run(() => onTransfer(Number(originTerritoryId), selectedInstanceIds))}
              className="rounded bg-zinc-100 text-zinc-900 px-3 py-1 font-semibold disabled:opacity-50"
            >
              Poslat vojska
            </button>
          </div>

          {structureOptions.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col text-sm text-zinc-400">
                Postavit stavbu
                <select
                  aria-label="Vyber stavební kartu"
                  value={selectedStructureInstanceId}
                  onChange={(e) => setSelectedStructureInstanceId(e.target.value)}
                  className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
                >
                  <option value="">— vyber kartu —</option>
                  {structureOptions.map((o) => (
                    <option key={o.instanceId} value={o.instanceId}>
                      {o.template.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={submitting || !selectedStructureInstanceId}
                onClick={() => run(() => onBuildStructure(territory.id, selectedStructureInstanceId))}
                className="rounded bg-zinc-100 text-zinc-900 px-3 py-1 font-semibold disabled:opacity-50"
              >
                Postavit
              </button>
            </div>
          )}
        </div>
      )}

      {state === 'owned-by-other' && (
        <p className="text-sm text-zinc-400">Toto území vlastní jiný hráč.</p>
      )}

      {state === 'npc-garrisoned' && (
        <p className="text-sm text-zinc-400">Toto území hlídá posádka NPC.</p>
      )}
    </div>
  )
}

function TroopChecklist({
  options,
  selected,
  onToggle,
}: {
  options: CardInstanceOption[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm text-zinc-400">Vyber vojska</legend>
      {options.map((o) => (
        <label key={o.instanceId} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(o.instanceId)}
            onChange={() => onToggle(o.instanceId)}
          />
          {o.template.name}
        </label>
      ))}
    </fieldset>
  )
}
