'use client'

import { CardInstanceWithTemplate, Territory } from '@/lib/territories/api'
import { TradingCard } from '@/components/cards/TradingCard'
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
}: GarrisonModalProps) {
  const canAttack =
    Boolean(myPlayerId) &&
    territory.owner_id !== myPlayerId &&
    territory.claim_locked_by !== myPlayerId &&
    !territory.battle_locked_by
  const canTransfer = Boolean(myPlayerId) && territory.owner_id === myPlayerId
  const showsOtherOwnerInfo = Boolean(territory.owner_id && territory.owner_id !== myPlayerId)
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
          <h2 className="text-lg font-bold">
            Posádka — území ({territory.x}, {territory.y})
          </h2>
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
                    <TradingCard
                      template={unitTemplate}
                      stats={applyRank(unitTemplate.baseStats, unitTemplate.rank)}
                    />
                  ) : (
                    <div className="flex aspect-[5/7] w-full flex-col items-center justify-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-center">
                      <span className="text-2xl">{row?.category === 'castle' ? '🏰' : '🏘️'}</span>
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
      </div>
    </div>
  )
}
