'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Territory,
  CardInstanceWithTemplate,
  MyTerritory,
  getCardInstancesAtTerritory,
  getMyTerritories,
  getPlayerPublicInfo,
  getTerritoryNeighborOwners,
} from '@/lib/territories/api'
import { isTerritoryAttackable } from '@/lib/territories/attackReachability'
import { declareAttack } from '@/lib/battles/api'
import { TradingCard } from '@/components/cards/TradingCard'
import { CardZoomIconButton, CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import { applyRank } from '@/lib/cards/combat'
import { Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'
import { castleAttackBonusPct, combinedDefenseBonusPct } from '@/lib/territories/structureBonus'
import { chebyshevDistance, transferHours } from '@/lib/territories/formulas'
import { formatEta } from '@/lib/time/formatEta'
import { compareArmyStrength, ArmyStrengthLabel } from '@/lib/battles/armyStrength'
import { NationId } from '@/lib/players/nations'

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
  const [success, setSuccess] = useState(false)
  const [attackerNation, setAttackerNation] = useState<NationId | null>(null)
  const [defenderNation, setDefenderNation] = useState<NationId | null>(null)
  const [defenderInstances, setDefenderInstances] = useState<CardInstanceWithTemplate[] | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const loadRequestIdRef = useRef(0)
  const castleRank = territory.castle_rank as Rank | null
  const villageRank = territory.village_rank as Rank | null
  const castleDefenseBonus = castleRank ? combinedDefenseBonusPct(castleRank, null) : 0
  const castleAttackBonus = castleAttackBonusPct(castleRank)
  const villageDefenseBonus = villageRank ? combinedDefenseBonusPct(null, villageRank) : 0
  const totalDefenseBonus = combinedDefenseBonusPct(castleRank, villageRank)
  const showStructureBonuses = Boolean(castleRank || villageRank)

  // ETA/probability preview (backlog #3, #21): the attacker's own nation
  // (transfer-time perk) and the defender's nation (combat perk) plus the
  // target's currently-stationed unit cards, so the preview can run the
  // same battle simulation the server ultimately resolves.
  useEffect(() => {
    if (!myPlayerId) return
    getPlayerPublicInfo(myPlayerId).then(({ data }) => {
      setAttackerNation((data?.nation as NationId) ?? null)
    })
  }, [myPlayerId])

  useEffect(() => {
    if (territory.owner_id) {
      getPlayerPublicInfo(territory.owner_id).then(({ data }) => {
        setDefenderNation((data?.nation as NationId) ?? null)
      })
    } else {
      setDefenderNation(null)
    }
    getCardInstancesAtTerritory(territory.id).then(({ data }) => {
      setDefenderInstances(data ?? [])
    })
  }, [territory.id, territory.owner_id])

  // Attack-adjacency pre-check (backlog #10): territories owned by a player
  // can only be attacked if at least one of their 4 orthogonal neighbors is
  // not owned by that same player, mirroring declare_attack()'s server-side
  // check (0017_attack_adjacency.sql). Empty/NPC targets (owner_id null) are
  // always reachable, so skip the lookup entirely for those.
  useEffect(() => {
    if (!territory.owner_id) {
      setReachable(true)
      return
    }
    let cancelled = false
    getTerritoryNeighborOwners(territory.x, territory.y).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) {
        // Fail open: don't block the attacker on a lookup error, the
        // authoritative check still runs server-side in declare_attack.
        setReachable(true)
        return
      }
      setReachable(isTerritoryAttackable(territory.owner_id, data))
    })
    return () => {
      cancelled = true
    }
  }, [territory.id, territory.owner_id, territory.x, territory.y])

  // Task: replaces manual "type the origin territory id" with a
  // dropdown of the caller's own territories (max 32, so no pagination
  // concern) — picking one auto-loads its garrison immediately.
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
    const eligible = (data ?? []).filter(
      (ci) => ci.owner_id === myPlayerId && ci.status === 'stationed' && ci.card_templates?.category === 'unit'
    )
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

  // Simple, deterministic army-strength comparison (not a battle-outcome
  // simulation): tells the attacker whether their selected cards roughly
  // match the defender's garrison in strength and number. A prior Monte
  // Carlo multi-round simulation was replaced here because the real
  // capture-based battle mechanic amplifies even small per-duel
  // disadvantages into near-certain routs, making a simulated win-percent
  // swing wildly for small changes in the selection.
  const armyStrength = useMemo(() => {
    if (!originInstances || selectedInstanceIds.length === 0 || defenderInstances === null) return null
    const attackerCards = originInstances
      .filter((ci) => selectedInstanceIds.includes(ci.instance_id))
      .map((ci) => toUnitTemplate(ci.card_templates!))
      .filter((t): t is UnitCardTemplate => t !== null)
      .map((t) => ({ baseStats: t.baseStats, rank: t.rank }))
    const defenderCards = defenderInstances
      .filter((ci) => ci.status === 'stationed' && ci.card_templates?.category === 'unit')
      .map((ci) => toUnitTemplate(ci.card_templates!))
      .filter((t): t is UnitCardTemplate => t !== null)
      .map((t) => ({ baseStats: t.baseStats, rank: t.rank }))
    if (attackerCards.length === 0) return null
    return compareArmyStrength({
      attackerCards,
      defenderCards,
      attackerNation,
      defenderNation,
      castleRank,
      villageRank,
    })
  }, [originInstances, selectedInstanceIds, defenderInstances, attackerNation, defenderNation, castleRank, villageRank])

  const armyStrengthCopy: Record<ArmyStrengthLabel, { text: string; className: string }> = {
    'strong-advantage': { text: 'Silná výhoda', className: 'text-emerald-400' },
    even: { text: 'Vyrovnané síly', className: 'text-amber-300' },
    risky: { text: 'Riskantní', className: 'text-orange-400' },
    disadvantage: { text: 'Nevýhoda', className: 'text-red-400' },
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
        ) : reachable === false ? (
          <p data-testid="declare-attack-unreachable" className="text-sm text-amber-400">
            Toto území je obklíčeno nepřátelským územím – nejprve dobyj okrajová území.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {showStructureBonuses && (
              <div
                data-testid="declare-attack-structure-bonuses"
                className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-3 text-sm text-amber-100"
              >
                <p className="font-semibold text-amber-200">Bonusy obránce na tomto území</p>
                <div className="mt-2 flex flex-col gap-1 text-xs sm:text-sm">
                  {castleRank && (
                    <p>{`Hrad (${castleRank}): +${castleDefenseBonus} % obrana, +${castleAttackBonus} % útok zblízka i na dálku`}</p>
                  )}
                  {villageRank && (
                    <p>{`Vesnice (${villageRank}): +${villageDefenseBonus} % obrana`}</p>
                  )}
                  <p className="text-amber-300">{`Celkem pro obránce: +${totalDefenseBonus} % obrana, +${castleAttackBonus} % útok zblízka i na dálku`}</p>
                </div>
              </div>
            )}

            <label className="flex flex-col gap-1 text-sm text-zinc-400">
              Odkud útočíš
              <select
                aria-label="Odkud útočíš"
                value={originTerritoryId}
                onChange={(e) => handleSelectOrigin(e.target.value)}
                disabled={myTerritories === null}
                className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
              >
                <option value="">
                  {myTerritories === null ? 'Načítám tvá území…' : '— vyber území —'}
                </option>
                {myTerritories?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.is_home ? 'Domov' : 'Území'} ({t.x}, {t.y})
                  </option>
                ))}
              </select>
            </label>

            {etaText && (
              <p data-testid="declare-attack-eta" className="text-sm text-zinc-300">
                Vojska dorazí na cíl: <span className="font-semibold">{etaText}</span>
              </p>
            )}

            {armyStrength && (
              <p data-testid="declare-attack-army-strength" className="text-sm text-zinc-300">
                Poměr sil vůči obránci:{' '}
                <span className={`font-semibold ${armyStrengthCopy[armyStrength.label].className}`}>
                  {armyStrengthCopy[armyStrength.label].text}
                </span>
              </p>
            )}

            {loading && <p className="text-sm text-zinc-400">Načítám vojska…</p>}
            {territoriesError && <p className="text-red-400 text-sm">{territoriesError}</p>}
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
                    const stats = applyRank(unitTemplate.baseStats, unitTemplate.rank)
                    return (
                      <div
                        key={instance.instance_id}
                        className={`relative flex flex-col items-center gap-1 rounded p-1 ${
                          checked ? 'ring-2 ring-red-500' : ''
                        }`}
                      >
                        <button
                          type="button"
                          data-testid={`declare-attack-card-select-${instance.instance_id}`}
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

            {submitError && <p className="text-red-400 text-sm">{submitError}</p>}

            <button
              type="button"
              disabled={submitting || !originTerritoryId || selectedInstanceIds.length === 0}
              onClick={handleSubmit}
              className="rounded bg-red-700 px-3 py-2 font-semibold text-white disabled:opacity-50"
            >
              {submitting ? 'Vyhlašuji útok…' : `Zaútočit (${selectedInstanceIds.length} vojsk)`}
            </button>
            <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
          </div>
        )}
      </div>
    </div>
  )
}
