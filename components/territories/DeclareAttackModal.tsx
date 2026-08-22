'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AttackOriginGroup,
  Territory,
  CardInstanceWithTemplate,
  MyTerritory,
  declareAttack,
  getCardInstancesAtTerritory,
  getMyCardInstances,
  getScoutTerritoryReport,
  getMyTerritories,
  getPlayerPublicInfo,
  sendScout,
  getTerritoryNeighborOwners,
} from '@/lib/territories/api'
import { isTerritoryAttackable } from '@/lib/territories/attackReachability'
import { TradingCard } from '@/components/cards/TradingCard'
import { CardZoomIconButton, CardZoomOverlay, useCardZoom } from '@/components/cards/CardZoomOverlay'
import { applyRank } from '@/lib/cards/combat'
import { BoostCardTemplate, Rank, UnitType, UnitCardTemplate } from '@/lib/cards/types'
import { castleAttackBonusPct, combinedDefenseBonusPct, wallRangedBonusPct } from '@/lib/territories/structureBonus'
import { nationCombatPerkLabel } from '@/lib/battles/nationCombatPerk'
import { multiOriginAttackHours, occupationHours, armyPower, Difficulty } from '@/lib/territories/formulas'
import { formatEta } from '@/lib/time/formatEta'
import { compareArmyStrength, compareArmyStrengthLightweight, ArmyStrengthLabel } from '@/lib/battles/armyStrength'
import { NationId } from '@/lib/players/nations'
import { MaskedBoostSummaryTile, VisibleBoostCardTile } from '@/components/cards/BoostCardTile'
import { maskedUnitBucketCounts, summarizeMaskedUnitBuckets } from '@/lib/territories/garrisonBuckets'

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
    name: row.name ?? 'Neznámá karta',
    flavorText: row.flavor_text ?? '',
    baseStats: row.base_stats,
    totalSupply: row.total_supply,
  }
}

function territoryLabel(territory: MyTerritory) {
  return `${territory.is_home ? 'Domov' : 'Území'} (${territory.x}, ${territory.y})`
}

function toBoostTemplate(row: NonNullable<CardInstanceWithTemplate['card_templates']>): BoostCardTemplate | null {
  if (row.category !== 'boost' || !row.name || !row.flavor_text || !row.boost_type || !row.effect_kind) return null
  return {
    id: row.id,
    category: 'boost',
    rank: row.rank as Rank,
    name: row.name,
    flavorText: row.flavor_text,
    boostType: row.boost_type,
    effectKind: row.effect_kind,
    instantEffectKind: row.instant_effect_kind ?? null,
    pctStr: row.pct_str ?? null,
    pctLng: row.pct_lng ?? null,
    pctDef: row.pct_def ?? null,
    pctHp: row.pct_hp ?? null,
    totalSupply: row.total_supply,
  }
}

export default function DeclareAttackModal({ territory, myPlayerId, onClose, onDeclared }: DeclareAttackModalProps) {
  const { zoomedCard, openZoom, closeZoom } = useCardZoom()
  const [myTerritories, setMyTerritories] = useState<MyTerritory[] | null>(null)
  const [territoriesError, setTerritoriesError] = useState<string | null>(null)
  const [selectedOriginTerritoryIds, setSelectedOriginTerritoryIds] = useState<number[]>([])
  const [originInstancesById, setOriginInstancesById] = useState<Record<number, CardInstanceWithTemplate[] | null>>({})
  const [selectedInstanceIdsByOrigin, setSelectedInstanceIdsByOrigin] = useState<Record<number, string[]>>({})
  const [loadingOriginIds, setLoadingOriginIds] = useState<number[]>([])
  const [originPickerOpen, setOriginPickerOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [selectedBoostInstanceId, setSelectedBoostInstanceId] = useState<string | null>(null)
  const [attackerNation, setAttackerNation] = useState<NationId | null>(null)
  const [defenderNation, setDefenderNation] = useState<NationId | null>(null)
  const [defenderInstances, setDefenderInstances] = useState<CardInstanceWithTemplate[] | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [availableScoutIds, setAvailableScoutIds] = useState<string[]>([])
  const [scoutSending, setScoutSending] = useState(false)
  const [scoutError, setScoutError] = useState<string | null>(null)
  const [scoutReportMeta, setScoutReportMeta] = useState<{ captured_at: string; expires_at: string } | null>(null)
  const castleRank = territory.castle_rank as Rank | null
  const villageRank = territory.village_rank as Rank | null
  const wallRank = territory.wall_rank as Rank | null
  const castleDefenseBonus = castleRank ? combinedDefenseBonusPct(castleRank, null) : 0
  const castleAttackBonus = castleAttackBonusPct(castleRank)
  const villageDefenseBonus = villageRank ? combinedDefenseBonusPct(null, villageRank) : 0
  const wallDefenseBonus = wallRank ? combinedDefenseBonusPct(null, null, wallRank) : 0
  const wallRangedBonus = wallRangedBonusPct(wallRank)
  const totalDefenseBonus = combinedDefenseBonusPct(castleRank, villageRank, wallRank)
  const defenderNationPerkLabel = nationCombatPerkLabel(defenderNation)
  const showStructureBonuses = Boolean(castleRank || villageRank || wallRank || defenderNationPerkLabel)
  const maskedDefenderSummary = useMemo(() => summarizeMaskedUnitBuckets(defenderInstances ?? []), [defenderInstances])
  const defenderBucketSummary = useMemo(() => maskedUnitBucketCounts(defenderInstances ?? []), [defenderInstances])
  useEffect(() => {
    if (!myPlayerId) return
    getPlayerPublicInfo(myPlayerId).then(({ data }) => {
      setAttackerNation((data?.nation as NationId) ?? null)
    })
  }, [myPlayerId])

  useEffect(() => {
    if (!myPlayerId) {
      setAvailableScoutIds([])
      return
    }
    let cancelled = false
    getMyCardInstances(myPlayerId).then(({ data }) => {
      if (cancelled) return
      setAvailableScoutIds(
        (data ?? [])
          .filter((instance) => instance.status === 'stationed' && instance.card_templates?.category === 'scout')
          .map((instance) => instance.instance_id)
      )
    })
    return () => {
      cancelled = true
    }
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

  useEffect(() => {
    if (!myPlayerId || territory.owner_id === myPlayerId) {
      setScoutReportMeta(null)
      return
    }
    let cancelled = false
    getScoutTerritoryReport(territory.id).then(({ data }) => {
      if (cancelled) return
      setScoutReportMeta(data ? { captured_at: data.captured_at, expires_at: data.expires_at } : null)
    })
    return () => {
      cancelled = true
    }
  }, [myPlayerId, territory.id, territory.owner_id])

  useEffect(() => {
    if (!territory.owner_id) {
      setReachable(true)
      return
    }
    let cancelled = false
    getTerritoryNeighborOwners(territory.x, territory.y).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) {
        setReachable(true)
        return
      }
      setReachable(isTerritoryAttackable(territory.owner_id, data))
    })
    return () => {
      cancelled = true
    }
  }, [territory.id, territory.owner_id, territory.x, territory.y])

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

  const selectedOrigins = useMemo(
    () => (myTerritories ?? []).filter((origin) => selectedOriginTerritoryIds.includes(origin.id)),
    [myTerritories, selectedOriginTerritoryIds]
  )

  const selectedOriginGroups = useMemo<AttackOriginGroup[]>(() => {
    return selectedOrigins
      .map((origin) => ({
        originTerritoryId: origin.id,
        cardInstanceIds: selectedInstanceIdsByOrigin[origin.id] ?? [],
      }))
      .filter((group) => group.cardInstanceIds.length > 0)
  }, [selectedOrigins, selectedInstanceIdsByOrigin])

  const totalSelectedCount = useMemo(
    () => selectedOriginGroups.reduce((sum, group) => sum + group.cardInstanceIds.length, 0),
    [selectedOriginGroups]
  )

  const attackerCards = useMemo(() => {
    return selectedOriginGroups.flatMap((group) => {
      const originInstances = originInstancesById[group.originTerritoryId] ?? []
      return (originInstances ?? [])
        .filter((instance) => group.cardInstanceIds.includes(instance.instance_id))
        .map((instance) => (instance.card_templates ? toUnitTemplate(instance.card_templates) : null))
        .filter((template): template is UnitCardTemplate => template !== null)
    })
  }, [originInstancesById, selectedOriginGroups])

  const etaText = useMemo(() => {
    const arrivalHours = multiOriginAttackHours(
      selectedOrigins.map((origin) => {
        const originInstances = originInstancesById[origin.id] ?? []
        const selectedIds = selectedInstanceIdsByOrigin[origin.id] ?? []
        const speeds = (originInstances ?? [])
          .filter((instance) => selectedIds.includes(instance.instance_id))
          .map((instance) => instance.card_templates?.base_stats?.speed)
          .filter((speed): speed is number => typeof speed === 'number')
        return {
          origin,
          groupSpeed: speeds.length > 0 ? Math.min(...speeds) : undefined,
        }
      }),
      territory,
      attackerNation ?? undefined
    )
    if (arrivalHours === null) return null
    return formatEta(new Date(Date.now() + arrivalHours * 3600000).toISOString())
  }, [attackerNation, originInstancesById, selectedInstanceIdsByOrigin, selectedOrigins, territory])

  const isEmptyTarget = !territory.owner_id && !territory.claim_locked_by
  const occupationEtaText = useMemo(() => {
    if (!isEmptyTarget || attackerCards.length === 0) return null
    const power = armyPower(attackerCards.map((template) => applyRank(template.baseStats, template.rank)))
    const hours = occupationHours(power, territory.difficulty as Difficulty, attackerNation ?? undefined)
    return `${Math.round(hours)} hodin`
  }, [attackerCards, isEmptyTarget, territory.difficulty, attackerNation])

  const armyStrength = useMemo(() => {
    if (attackerCards.length === 0 || defenderInstances === null) return null
    if (maskedDefenderSummary) {
      return compareArmyStrengthLightweight({
        attackerCards: attackerCards.map((template) => ({ baseStats: template.baseStats, rank: template.rank })),
        defenderBuckets: defenderBucketSummary,
      })
    }
    const defenderCards = defenderInstances
      .filter((instance) => instance.status === 'stationed' && instance.card_templates?.category === 'unit')
      .map((instance) => toUnitTemplate(instance.card_templates!))
      .filter((template): template is UnitCardTemplate => template !== null)
      .map((template) => ({ baseStats: template.baseStats, rank: template.rank }))
    return compareArmyStrength({
      attackerCards: attackerCards.map((template) => ({ baseStats: template.baseStats, rank: template.rank })),
      defenderCards,
      attackerNation,
      defenderNation,
      castleRank,
      villageRank,
      wallRank,
    })
  }, [
    attackerCards,
    defenderInstances,
    attackerNation,
    defenderNation,
    castleRank,
    villageRank,
    wallRank,
    maskedDefenderSummary,
    defenderBucketSummary,
  ])

  const armyStrengthCopy: Record<ArmyStrengthLabel, { text: string; className: string }> = {
    'strong-advantage': { text: 'Silná výhoda', className: 'text-emerald-400' },
    even: { text: 'Vyrovnané síly', className: 'text-amber-300' },
    risky: { text: 'Riskantní', className: 'text-orange-400' },
    disadvantage: { text: 'Nevýhoda', className: 'text-red-400' },
  }

  async function loadOrigin(originId: number) {
    if (loadingOriginIds.includes(originId) || originInstancesById[originId] !== undefined) return
    setLoadingOriginIds((prev) => [...prev, originId])
    setLoadError(null)
    const { data, error } = await getCardInstancesAtTerritory(originId)
    setLoadingOriginIds((prev) => prev.filter((id) => id !== originId))
    if (error) {
      setLoadError(error.message)
      return
    }
    const eligible = (data ?? []).filter(
      (instance) =>
        instance.owner_id === myPlayerId &&
        instance.status === 'stationed' &&
        ['unit', 'boost'].includes(instance.card_templates?.category ?? '')
    )
    setOriginInstancesById((prev) => ({ ...prev, [originId]: eligible }))
  }

  function toggleOrigin(originId: number) {
    const isSelected = selectedOriginTerritoryIds.includes(originId)
    if (isSelected) {
      setSelectedOriginTerritoryIds((prev) => prev.filter((id) => id !== originId))
      setSelectedInstanceIdsByOrigin((prev) => {
        const next = { ...prev }
        delete next[originId]
        return next
      })
      setLoadingOriginIds((prev) => prev.filter((id) => id !== originId))
      return
    }

    setSelectedOriginTerritoryIds((prev) => [...prev, originId])
    loadOrigin(originId)
  }

  function toggleInstance(originId: number, instanceId: string) {
    setSelectedInstanceIdsByOrigin((prev) => {
      const current = prev[originId] ?? []
      return {
        ...prev,
        [originId]: current.includes(instanceId)
          ? current.filter((id) => id !== instanceId)
          : [...current, instanceId],
      }
    })
  }

  async function handleSubmit() {
    if (selectedOriginGroups.length === 0) return
    setSubmitting(true)
    setSubmitError(null)
    const { error } = await declareAttack(territory.id, selectedOriginGroups, selectedBoostInstanceId)
    setSubmitting(false)
    if (error) {
      setSubmitError(error.message)
      return
    }
    setSuccess(true)
    onDeclared?.()
  }

  async function handleSendScout() {
    if (availableScoutIds.length === 0) return
    setScoutSending(true)
    setScoutError(null)
    const { error } = await sendScout(territory.id, availableScoutIds[0])
    setScoutSending(false)
    if (error) {
      setScoutError(error.message)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-2 sm:p-6" onClick={onClose}>
      <div
        data-testid="declare-attack-modal"
        className="flex w-full max-w-3xl min-h-[85vh] max-h-[97vh] flex-col overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {isEmptyTarget ? 'Obsadit území' : 'Vyhlásit útok'} — území ({territory.x}, {territory.y})
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
            {isEmptyTarget
              ? 'Vojska vyslána! Po příjezdu začnou území pokojně obsazovat.'
              : 'Útok vyslán! Vojska dorazí na cíl po uplynutí doby přesunu, poté začne bitva.'}
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
                  {villageRank && <p>{`Vesnice (${villageRank}): +${villageDefenseBonus} % obrana`}</p>}
                  {wallRank && <p>{`Hradby (${wallRank}): +${wallDefenseBonus} % obrana, +${wallRangedBonus} % dálkový útok`}</p>}
                  {defenderNationPerkLabel && <p>{defenderNationPerkLabel}</p>}
                  <p className="text-amber-300">{`Celkem pro obránce: +${totalDefenseBonus} % obrana, +${castleAttackBonus} % útok zblízka i na dálku`}</p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1 text-sm text-zinc-400">
              <span>Odkud útočíš</span>
              <div className="relative">
                <button
                  type="button"
                  aria-label="Odkud útočíš"
                  data-testid="declare-attack-origin-toggle"
                  onClick={() => setOriginPickerOpen((prev) => !prev)}
                  disabled={myTerritories === null}
                  className="flex w-full items-center justify-between rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-zinc-200 disabled:opacity-50"
                >
                  <span>
                    {selectedOrigins.length === 0
                      ? myTerritories === null
                        ? 'Načítám tvá území…'
                        : '— vyber území —'
                      : `Vybraná území (${selectedOrigins.length})`}
                  </span>
                  <span className="text-xs text-zinc-400">▼</span>
                </button>
                {originPickerOpen && myTerritories && (
                  <div className="absolute z-10 mt-2 max-h-96 w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-2 shadow-2xl">
                    <div className="flex flex-col gap-1">
                      {myTerritories.map((origin) => {
                        const checked = selectedOriginTerritoryIds.includes(origin.id)
                        return (
                          <label
                            key={origin.id}
                            data-testid={`declare-attack-origin-option-${origin.id}`}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-zinc-900"
                          >
                            <input
                              type="checkbox"
                              data-testid={`declare-attack-origin-check-${origin.id}`}
                              checked={checked}
                              onChange={() => toggleOrigin(origin.id)}
                              className="h-4 w-4"
                            />
                            <span className="text-sm text-zinc-200">{territoryLabel(origin)}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {etaText && (
              <p data-testid="declare-attack-eta" className="text-sm text-zinc-300">
                Společný příjezd útoku: <span className="font-semibold">{etaText}</span>
              </p>
            )}

            {(() => {
              const maskedBoostCounts = (defenderInstances ?? []).reduce<Record<string, number>>((acc, instance) => {
                const row = instance.card_templates
                if (row?.category !== 'boost' || row.name) return acc
                acc[row.rank] = (acc[row.rank] ?? 0) + 1
                return acc
              }, {})
              const entries = Object.entries(maskedBoostCounts)
              if (entries.length === 0) return null
              return (
                <div>
                  <p className="mb-2 text-sm text-zinc-300">Soupeřovy skryté boost karty</p>
                  <div data-testid="declare-attack-defender-boost-summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {entries.map(([rank, count]) => (
                      <MaskedBoostSummaryTile key={rank} rank={rank as Rank} count={count} />
                    ))}
                  </div>
                </div>
              )
            })()}

            {maskedDefenderSummary && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">Odhad posádky podle ranku</p>
                    <p>{maskedDefenderSummary}</p>
                    <p className="text-xs text-amber-300">⚠ Odhad — neznáš přesná vojska nepřítele</p>
                  </div>
                  <button
                    type="button"
                    disabled={scoutSending || availableScoutIds.length === 0}
                    onClick={handleSendScout}
                    className="rounded bg-amber-700 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {scoutSending ? 'Vysílám…' : `Vyslat zvěda (${availableScoutIds.length} ks)`}
                  </button>
                </div>
                {scoutReportMeta && (
                  <p data-testid="declare-attack-scout-report-meta" className="mt-2 text-xs text-zinc-400">
                    Zvěd hlásí od {new Date(scoutReportMeta.captured_at).toLocaleString('cs-CZ')} · platí do{' '}
                    {new Date(scoutReportMeta.expires_at).toLocaleString('cs-CZ')}
                  </p>
                )}
              </div>
            )}

            {occupationEtaText && (
              <p data-testid="declare-attack-occupation-eta" className="text-sm text-zinc-300">
                Toto území je prázdné — po příjezdu bude obsazování trvat:{' '}
                <span className="font-semibold">{occupationEtaText}</span>
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

            {loadingOriginIds.length > 0 && <p className="text-sm text-zinc-400">Načítám vojska…</p>}
            {territoriesError && <p className="text-sm text-red-400">{territoriesError}</p>}
            {loadError && <p className="text-sm text-red-400">{loadError}</p>}
            {scoutError && <p className="text-sm text-red-400">{scoutError}</p>}

            {selectedOrigins.map((origin) => {
              const originInstances = originInstancesById[origin.id]
              const selectedIds = selectedInstanceIdsByOrigin[origin.id] ?? []
              return (
                <div key={origin.id} className="rounded-xl border border-zinc-800 p-3">
                  <p className="mb-2 text-sm font-semibold text-zinc-200">{territoryLabel(origin)}</p>

                  {originInstances !== null && originInstances !== undefined && originInstances.length === 0 && (
                    <p className="text-sm text-zinc-400">Na tomto území nemáš žádná dostupná vojska.</p>
                  )}

                  {originInstances !== null && originInstances !== undefined && originInstances.length > 0 && (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="text-sm text-zinc-400">Vyber vojska k útoku</legend>
                      <div className="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto p-2 [scrollbar-gutter:stable] sm:grid-cols-4">
                        {originInstances.map((instance) => {
                          const unitTemplate = instance.card_templates ? toUnitTemplate(instance.card_templates) : null
                          if (!unitTemplate) return null
                          const checked = selectedIds.includes(instance.instance_id)
                          const stats = applyRank(unitTemplate.baseStats, unitTemplate.rank)
                          return (
                            <div key={instance.instance_id} className="relative flex flex-col items-center gap-1">
                              <button
                                type="button"
                                data-testid={`declare-attack-card-select-${instance.instance_id}`}
                                aria-label={`Vybrat kartu ${unitTemplate.name}`}
                                aria-pressed={checked}
                                onClick={() => toggleInstance(origin.id, instance.instance_id)}
                                className={`block w-full cursor-pointer rounded-xl text-left transition hover:scale-[1.02] ${
                                  checked ? 'ring-4 ring-red-500' : ''
                                }`}
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

                  {originInstances !== null &&
                    originInstances !== undefined &&
                    originInstances.some((instance) => instance.card_templates?.category === 'boost') && (
                      <div className="mt-3 flex flex-col gap-2">
                        <p className="text-sm text-zinc-400">Volitelná útočná boost karta</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {originInstances.map((instance) => {
                            const boostTemplate = instance.card_templates ? toBoostTemplate(instance.card_templates) : null
                            if (!boostTemplate || boostTemplate.boostType !== 'offensive') return null
                            const selected = selectedBoostInstanceId === instance.instance_id
                            return (
                              <button
                                key={instance.instance_id}
                                type="button"
                                data-testid={`declare-attack-boost-select-${instance.instance_id}`}
                                onClick={() =>
                                  setSelectedBoostInstanceId((current) =>
                                    current === instance.instance_id ? null : instance.instance_id
                                  )
                                }
                                className={`rounded-xl text-left ${selected ? 'ring-2 ring-red-500' : ''}`}
                              >
                                <VisibleBoostCardTile template={boostTemplate} compact />
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                </div>
              )
            })}

            {submitError && <p className="text-sm text-red-400">{submitError}</p>}

            <button
              type="button"
              disabled={submitting || totalSelectedCount === 0}
              onClick={handleSubmit}
              className={`rounded px-3 py-2 font-semibold text-white disabled:opacity-50 ${isEmptyTarget ? 'bg-emerald-700' : 'bg-red-700'}`}
            >
              {submitting
                ? isEmptyTarget
                  ? 'Vysílám vojsko…'
                  : 'Vyhlašuji útok…'
                : isEmptyTarget
                  ? `Obsadit (${totalSelectedCount} vojsk)`
                  : `Zaútočit (${totalSelectedCount} vojsk)`}
            </button>
            <CardZoomOverlay card={zoomedCard} onClose={closeZoom} />
          </div>
        )}
      </div>
    </div>
  )
}
