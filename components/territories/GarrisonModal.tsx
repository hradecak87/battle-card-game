'use client'

import { useState } from 'react'
import { CardInstanceWithTemplate, Territory } from '@/lib/territories/api'
import { TradingCard } from '@/components/cards/TradingCard'
import { CastleIcon, VillageIcon } from '@/components/territories/icons/StructureIcons'
import { CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'
import { NATIONS } from '@/lib/players/nations'
import { formatEta } from '@/lib/time/formatEta'

export interface GarrisonModalOwnerInfo {
  id: string
  display_name: string
  nation: string
  kingdom_name: string | null
  xp: number
  level: number
}

export interface GarrisonModalProps {
  territory: Territory
  instances: CardInstanceWithTemplate[] | null
  error: string | null
  onClose: () => void
  myPlayerId?: string | null
  onAttack?: () => void
  onTransfer?: () => void
  ownerInfo?: GarrisonModalOwnerInfo | null
  ownerInfoLoading?: boolean
  ownerInfoError?: string | null
  /**
   * Arrival time of the in-transit attack currently converging on this
   * territory, if any (fetched separately since `battle_locked_by` is
   * set at declare-attack time, before the battle itself exists — see
   * `getIncomingAttackArrival`). Only relevant when `territory.battle_locked_by`
   * is set and `territory.battle_id` isn't (once a battle exists, selecting
   * this tile navigates straight to the battle screen instead).
   */
  incomingAttackArrivesAt?: string | null
  /** Called when the owner saves a new name (or an empty string to clear). */
  onRename: (territoryId: number, newName: string) => Promise<void>
  /**
   * The viewer's own castle/village card instances (pre-filtered by caller).
   * When the viewer owns this territory and it's missing a castle/village,
   * a "Postavit hrad/vesnici" build action is shown.
   */
  structureCardOptions?: CardInstanceWithTemplate[]
  /** Called when the owner confirms building a structure on this territory. */
  onBuildStructure?: (territoryId: number, cardInstanceId: string) => Promise<void>
}

/** Rebuilds the `UnitCardTemplate` shape `TradingCard` expects from the flat DB row. */
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

function formatNation(nationId: string) {
  return NATIONS.find((nation) => nation.id === nationId)?.name ?? nationId
}

/**
 * Popup shown when a map tile is selected (design follow-up to Task 12):
 * renders the garrison stationed there as actual `TradingCard` visuals
 * instead of a plain text list, reusing subsystem #1's card art/frame.
 */
export default function GarrisonModal({
  territory,
  instances,
  error,
  onClose,
  myPlayerId,
  onAttack,
  onTransfer,
  ownerInfo,
  ownerInfoLoading,
  ownerInfoError,
  incomingAttackArrivesAt,
  onRename,
  structureCardOptions,
  onBuildStructure,
}: GarrisonModalProps) {
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(territory.name ?? '')
  const [renameLoading, setRenameLoading] = useState(false)
  const [buildCastleInstanceId, setBuildCastleInstanceId] = useState('')
  const [buildVillageInstanceId, setBuildVillageInstanceId] = useState('')
  const [buildLoading, setBuildLoading] = useState(false)

  const canAttack =
    Boolean(myPlayerId) &&
    territory.owner_id !== myPlayerId &&
    territory.claim_locked_by !== myPlayerId &&
    !territory.battle_locked_by
  const canTransfer = Boolean(myPlayerId) && territory.owner_id === myPlayerId
  const showsOtherOwnerInfo = Boolean(territory.owner_id && territory.owner_id !== myPlayerId)

  async function handleRenameSave() {
    setRenameLoading(true)
    await onRename(territory.id, renameValue)
    setRenameLoading(false)
    setRenaming(false)
  }

  async function handleBuild(category: 'castle' | 'village') {
    if (!onBuildStructure) return
    const instanceId = category === 'castle' ? buildCastleInstanceId : buildVillageInstanceId
    if (!instanceId) return
    setBuildLoading(true)
    await onBuildStructure(territory.id, instanceId)
    setBuildLoading(false)
  }

  const buildLabelIconStyle = { width: '28px', height: '28px' }
  const structureCardIconStyle = { width: '32px', height: '32px' }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        data-testid="garrison-modal"
        className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            {territory.name && (
              <h2 className="text-lg font-bold" data-testid="territory-name">{territory.name}</h2>
            )}
            <p className={territory.name ? 'text-sm text-zinc-400' : 'text-lg font-bold'}>
              Posádka — území ({territory.x}, {territory.y})
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canTransfer && onTransfer && (
              <button
                type="button"
                onClick={onTransfer}
                className="rounded bg-emerald-700 hover:bg-emerald-600 px-3 py-1 text-sm font-semibold text-white"
              >
                Přesunout vojska
              </button>
            )}
            {canTransfer && !renaming && (
              <button
                type="button"
                aria-label="Přejmenovat území"
                onClick={() => { setRenameValue(territory.name ?? ''); setRenaming(true) }}
                className="rounded bg-zinc-700 hover:bg-zinc-600 px-3 py-1 text-sm font-semibold text-white"
                title="Přejmenovat území"
              >
                ✏️
              </button>
            )}
            {canAttack && onAttack && (
              <button
                type="button"
                onClick={onAttack}
                className="rounded bg-red-700 hover:bg-red-600 px-3 py-1 text-sm font-semibold text-white"
              >
                ⚔️ Zaútočit
              </button>
            )}
            {territory.battle_locked_by && (
              <span className="text-xs text-red-400">
                {incomingAttackArrivesAt
                  ? `Útok na cestě — vojska dorazí ${formatEta(incomingAttackArrivesAt)}`
                  : 'Toto území je právě v boji'}
              </span>
            )}
            <button
              type="button"
              aria-label="Zavřít"
              onClick={onClose}
              className="rounded-full px-3 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              ✕
            </button>
          </div>
        </div>

        {canTransfer && renaming && (
          <div className="mb-4 flex items-center gap-2" data-testid="rename-form">
            <input
              aria-label="Nové jméno území"
              type="text"
              value={renameValue}
              maxLength={40}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Jméno hradu nebo vesnice (max 40 znaků)"
              className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-100"
              disabled={renameLoading}
            />
            <button
              type="button"
              onClick={handleRenameSave}
              disabled={renameLoading}
              className="rounded bg-sky-700 hover:bg-sky-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50"
            >
              {renameLoading ? '…' : 'Uložit'}
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              disabled={renameLoading}
              className="rounded bg-zinc-700 hover:bg-zinc-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Zrušit
            </button>
          </div>
        )}

        {canTransfer && (!territory.castle_rank || !territory.village_rank) && (
          <div className="mb-4 rounded-xl border border-zinc-700 bg-zinc-900/60 p-3 flex flex-col gap-2" data-testid="build-structure-section">
            {!territory.castle_rank && (() => {
              const castleCards = (structureCardOptions ?? []).filter(
                (c) => c.card_templates?.category === 'castle'
              )
              return (
                <div className="flex items-center gap-2 flex-wrap" data-testid="build-castle-row">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <CastleIcon
                      variant="castle-2"
                      title="Hrad"
                      className="text-stone-300 drop-shadow"
                      style={buildLabelIconStyle}
                    />
                    Postavit hrad
                  </span>
                  {castleCards.length === 0 ? (
                    <span className="text-xs text-zinc-500" data-testid="no-castle-cards">
                      Nemáš žádnou kartu hradu
                    </span>
                  ) : (
                    <>
                      <select
                        aria-label="Vyber kartu hradu"
                        value={buildCastleInstanceId}
                        onChange={(e) => setBuildCastleInstanceId(e.target.value)}
                        className="rounded bg-zinc-800 border border-zinc-600 px-2 py-1 text-xs text-zinc-100"
                        disabled={buildLoading}
                      >
                        <option value="">Vyber kartu…</option>
                        {castleCards.map((c) => (
                          <option key={c.instance_id} value={c.instance_id}>
                            {c.card_templates?.name ?? c.template_id} ({c.card_templates?.rank})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleBuild('castle')}
                        disabled={buildLoading || !buildCastleInstanceId}
                        className="rounded bg-amber-700 hover:bg-amber-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {buildLoading ? '…' : 'Postavit'}
                      </button>
                    </>
                  )}
                </div>
              )
            })()}
            {!territory.village_rank && (() => {
              const villageCards = (structureCardOptions ?? []).filter(
                (c) => c.card_templates?.category === 'village'
              )
              return (
                <div className="flex items-center gap-2 flex-wrap" data-testid="build-village-row">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <VillageIcon
                      variant="village-2"
                      title="Vesnice"
                      className="text-stone-300 drop-shadow"
                      style={buildLabelIconStyle}
                    />
                    Postavit vesnici
                  </span>
                  {villageCards.length === 0 ? (
                    <span className="text-xs text-zinc-500" data-testid="no-village-cards">
                      Nemáš žádnou kartu vesnice
                    </span>
                  ) : (
                    <>
                      <select
                        aria-label="Vyber kartu vesnice"
                        value={buildVillageInstanceId}
                        onChange={(e) => setBuildVillageInstanceId(e.target.value)}
                        className="rounded bg-zinc-800 border border-zinc-600 px-2 py-1 text-xs text-zinc-100"
                        disabled={buildLoading}
                      >
                        <option value="">Vyber kartu…</option>
                        {villageCards.map((c) => (
                          <option key={c.instance_id} value={c.instance_id}>
                            {c.card_templates?.name ?? c.template_id} ({c.card_templates?.rank})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleBuild('village')}
                        disabled={buildLoading || !buildVillageInstanceId}
                        className="rounded bg-green-700 hover:bg-green-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {buildLoading ? '…' : 'Postavit'}
                      </button>
                    </>
                  )}
                </div>
              )
            })()}
          </div>
        )}
        <div className="mb-4 grid gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300 sm:grid-cols-2">
          <p>Obtížnost: {territory.difficulty}</p>
          <p>Souřadnice: ({territory.x}, {territory.y})</p>
          {territory.castle_rank && <p>Hrad: {territory.castle_rank}</p>}
          {territory.village_rank && <p>Vesnice: {territory.village_rank}</p>}
          {showsOtherOwnerInfo && (
            <div className="sm:col-span-2">
              <p className="mb-1 font-semibold text-zinc-100">Vlastník území</p>
              {ownerInfoLoading && <p className="text-zinc-400">Načítám informace o vlastníkovi…</p>}
              {!ownerInfoLoading && ownerInfoError && (
                <p className="text-amber-400">Nepodařilo se načíst informace o vlastníkovi.</p>
              )}
              {!ownerInfoLoading && !ownerInfoError && ownerInfo && (
                <div className="grid gap-1 sm:grid-cols-2">
                  <p>Jméno: {ownerInfo.display_name}</p>
                  <p>Národ: {formatNation(ownerInfo.nation)}</p>
                  {ownerInfo.kingdom_name && <p>Království: {ownerInfo.kingdom_name}</p>}
                  <p>Úroveň: {ownerInfo.level}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {territory.claim_locked_by && territory.claim_occupation_completes_at && (
          <p className="mb-3 text-sm text-amber-400">
            🚩 Probíhá zábor tohoto území — dokončí se {formatEta(territory.claim_occupation_completes_at)}
          </p>
        )}

        {!error && instances === null && <p className="text-zinc-400 text-sm">Načítám…</p>}

        {!error && instances !== null && instances.length === 0 && (
          <p className="text-zinc-400 text-sm">Žádná vojska na tomto území.</p>
        )}

        {!error && instances !== null && instances.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {instances.map((instance) => {
              const row = instance.card_templates
              const unitTemplate = row ? toUnitTemplate(row) : null
              return (
                <div key={instance.instance_id} className="flex flex-col items-center gap-1">
                  {unitTemplate ? (
                    <button
                      type="button"
                      aria-label={`Zvětšit kartu ${unitTemplate.name}`}
                      onClick={() => openZoom(unitTemplate, applyRank(unitTemplate.baseStats, unitTemplate.rank))}
                      className="group relative block w-full cursor-pointer rounded-xl text-left transition hover:scale-[1.02]"
                    >
                      <TradingCard
                        template={unitTemplate}
                        stats={applyRank(unitTemplate.baseStats, unitTemplate.rank)}
                      />
                      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white shadow-sm">
                        🔍
                      </span>
                    </button>
                  ) : (
                    <div className="flex aspect-[5/7] w-full flex-col items-center justify-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-center">
                      {row?.category === 'castle' ? (
                        <CastleIcon
                          variant="castle-2"
                          title="Hrad"
                          className="text-stone-300 drop-shadow"
                          style={structureCardIconStyle}
                        />
                      ) : (
                        <VillageIcon
                          variant="village-2"
                          title="Vesnice"
                          className="text-stone-300 drop-shadow"
                          style={structureCardIconStyle}
                        />
                      )}
                      <span className="text-xs font-semibold">{row?.name ?? instance.template_id}</span>
                      <span className="text-[10px] text-zinc-500">{row?.rank}</span>
                    </div>
                  )}
                  {instance.status === 'in_transit' && (
                    <span className="text-[10px] text-zinc-500">na cestě</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
      </div>
    </div>
  )
}
