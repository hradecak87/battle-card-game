'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  getViewport,
  getCardInstancesAtTerritory,
  getMyHomeTerritory,
  getIncomingAttackInfo,
  getClaimInfo,
  getPlayerPublicInfo,
  getMyTerritories,
  getActiveBattleForTerritory,
  renameTerritory,
  buildStructure,
  getMyStructureCardInstances,
  abandonTerritory,
  relocateHome,
  CardInstanceWithTemplate,
  PlayerPublicInfo,
  MyTerritory,
  Territory,
  IncomingAttackInfo,
  ClaimInfo,
} from '@/lib/territories/api'
import MapViewport from '@/components/territories/MapViewport'
import GarrisonModal from '@/components/territories/GarrisonModal'
import DeclareAttackModal from '@/components/territories/DeclareAttackModal'
import TransferModal from '@/components/territories/TransferModal'
import MyMovementsPanel from '@/components/territories/MyMovementsPanel'
import MapMovementArrows from '@/components/territories/MapMovementArrows'
import { useTerritoryBattleChannel } from '@/lib/battles/useTerritoryBattleChannel'
import {
  IncomingOwnedTerritoryBattle,
  useMyTerritoriesBattleChannel,
} from '@/lib/battles/useMyTerritoriesBattleChannel'
import { canUseKingRelocation } from '@/lib/players/king'
import { levelForXp } from '@/lib/players/leveling'
import { useSession } from '@/lib/supabase/useSession'
import { getRelation } from '@/lib/diplomacy/api'
import type { DiplomacyRelationState } from '@/lib/diplomacy/types'

// `get_viewport` (migration 0049) now returns one aggregated jsonb row
// instead of one row per territory, so it's no longer subject to
// Supabase/PostgREST's default 1000-row response cap that used to limit
// viewSize to well under 32 (a 35x35=1225-tile request used to silently
// truncate to 1000 rows, dropping the last several columns).
// Kept odd so `half = floor(viewSize / 2)` centers the viewport exactly on
// the requested (centerX, centerY) tile at every zoom step, same as before.
const ZOOM_LEVELS = [5, 9, 15, 21, 29, 37, 49]
const DEFAULT_ZOOM_INDEX = 2 // 15 tiles per side, same as the previous fixed size
const MAP_MIN = 0
const MAP_MAX = 255

type SelectedOwnerInfo = PlayerPublicInfo & {
  level: number
}

type IncomingBattleAlert = {
  territoryId: number
  territoryLabel: string
  battleId: string | null
}

function clamp(value: number) {
  return Math.max(MAP_MIN, Math.min(MAP_MAX, value))
}

function getInitialCenter(searchParams: ReturnType<typeof useSearchParams>, key: 'x' | 'y') {
  const raw = searchParams.get(key)
  if (raw === null) return null

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < MAP_MIN || parsed > MAP_MAX) {
    return null
  }

  return parsed
}

function MapPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, player } = useSession()
  const initialX = getInitialCenter(searchParams, 'x')
  const initialY = getInitialCenter(searchParams, 'y')
  const hasExplicitCenter = initialX !== null && initialY !== null
  const [centerX, setCenterX] = useState(hasExplicitCenter ? initialX : 128)
  const [centerY, setCenterY] = useState(hasExplicitCenter ? initialY : 128)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [territories, setTerritories] = useState<Territory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedTile, setSelectedTile] = useState<Territory | null>(null)
  const [garrison, setGarrison] = useState<CardInstanceWithTemplate[] | null>(null)
  const [garrisonError, setGarrisonError] = useState<string | null>(null)
  const [ownerInfo, setOwnerInfo] = useState<SelectedOwnerInfo | null>(null)
  const [ownerInfoLoading, setOwnerInfoLoading] = useState(false)
  const [ownerInfoError, setOwnerInfoError] = useState<string | null>(null)
  const [incomingAttackInfo, setIncomingAttackInfo] = useState<IncomingAttackInfo | null>(null)
  const [claimInfo, setClaimInfo] = useState<ClaimInfo | null>(null)
  const [relationState, setRelationState] = useState<DiplomacyRelationState | null>(null)
  const [homeStatus, setHomeStatus] = useState<'idle' | 'searching' | 'not-found'>('idle')
  const [ownedTerritories, setOwnedTerritories] = useState<MyTerritory[] | null>(null)
  const [structureCardInstances, setStructureCardInstances] = useState<CardInstanceWithTemplate[] | null>(null)
  const [showAttackModal, setShowAttackModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showMovementArrows, setShowMovementArrows] = useState(false)
  const [movementsRefreshKey, setMovementsRefreshKey] = useState(0)
  const [incomingBattleAlerts, setIncomingBattleAlerts] = useState<IncomingBattleAlert[]>([])
  const [kingRelocationUsedAt, setKingRelocationUsedAt] = useState<string | null>(null)
  const selectionRequestIdRef = useRef(0)
  const autoCenteredUserId = useRef<string | null>(null)

  const viewSize = ZOOM_LEVELS[zoomIndex]
  const kingRelocationAvailable = Boolean(
    player && canUseKingRelocation(player.xp, kingRelocationUsedAt)
  )

  useEffect(() => {
    setKingRelocationUsedAt(player?.king_relocation_used_at ?? null)
  }, [player?.king_relocation_used_at])

  const loadViewport = useCallback((x: number, y: number, size: number) => {
    const tileHalf = Math.floor(size / 2)
    const x1 = clamp(x - tileHalf)
    const x2 = clamp(x + tileHalf)
    const y1 = clamp(y - tileHalf)
    const y2 = clamp(y + tileHalf)
    getViewport(x1, y1, x2, y2).then(({ data, error: rpcError }) => {
      if (rpcError) {
        setError(rpcError.message)
        return
      }
      setError(null)
      setTerritories(data ?? [])
    })
  }, [])

  // Task 15/20: push live battle_locked_by/battle_id changes for the
  // currently-visible viewport, so "under attack" flags appear/disappear
  // without requiring a pan/zoom to trigger a refetch.
  useTerritoryBattleChannel(
    (territories ?? []).map((t) => t.id),
    () => loadViewport(centerX, centerY, viewSize)
  )

  const resolveActiveBattleId = useCallback(async (territoryId: number) => {
    const { data, error: battleError } = await getActiveBattleForTerritory(territoryId)
    if (battleError) return null
    return data?.id ?? null
  }, [])

  const handleIncomingBattle = useCallback(
    async ({ territoryId }: IncomingOwnedTerritoryBattle) => {
      const territory = ownedTerritories?.find((candidate) => candidate.id === territoryId)
      if (!territory) return

      const battleId = await resolveActiveBattleId(territoryId)
      const territoryLabel = territory.name
        ? `${territory.name} (${territory.x}, ${territory.y})`
        : `(${territory.x}, ${territory.y})`

      setIncomingBattleAlerts((current) => {
        const existing = current.find((alert) => alert.territoryId === territoryId)
        if (existing) {
          return current.map((alert) =>
            alert.territoryId === territoryId ? { ...alert, battleId: alert.battleId ?? battleId } : alert
          )
        }
        return [
          ...current,
          {
            territoryId,
            territoryLabel,
            battleId,
          },
        ]
      })
    },
    [ownedTerritories, resolveActiveBattleId]
  )

  useMyTerritoriesBattleChannel(ownedTerritories, handleIncomingBattle)

  useEffect(() => {
    loadViewport(centerX, centerY, viewSize)
  }, [centerX, centerY, viewSize, loadViewport])

  // `centerX`/`centerY` are only seeded from the URL's `x`/`y` query params
  // once, via the useState initializer above. Next.js's App Router doesn't
  // remount this component on a same-route navigation that only changes the
  // search params (e.g. clicking a `/map?x=&y=` link while already on
  // `/map`), so without this effect those subsequent link clicks silently
  // did nothing — the center state never picked up the new coordinates.
  const rawSearchX = searchParams.get('x')
  const rawSearchY = searchParams.get('y')
  useEffect(() => {
    if (rawSearchX === null || rawSearchY === null) return
    const x = Number.parseInt(rawSearchX, 10)
    const y = Number.parseInt(rawSearchY, 10)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < MAP_MIN || x > MAP_MAX || y < MAP_MIN || y > MAP_MAX) {
      return
    }
    handleJump(x, y)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSearchX, rawSearchY])

  useEffect(() => {
    if (!user?.id) {
      setIncomingBattleAlerts([])
    }
  }, [user?.id])

  function handlePan(dx: number, dy: number) {
    setCenterX((x) => clamp(x + dx))
    setCenterY((y) => clamp(y + dy))
  }

  function handleJump(x: number, y: number) {
    setCenterX(clamp(x))
    setCenterY(clamp(y))
  }

  function handleZoomIn() {
    setZoomIndex((i) => Math.max(0, i - 1))
  }

  function handleZoomOut() {
    setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))
  }

  async function handleOpenIncomingBattle(territoryId: number, knownBattleId: string | null) {
    const battleId = knownBattleId ?? (await resolveActiveBattleId(territoryId))
    if (!battleId) return

    if (!knownBattleId) {
      setIncomingBattleAlerts((current) =>
        current.map((alert) => (alert.territoryId === territoryId ? { ...alert, battleId } : alert))
      )
    }

    router.push(`/battles/${battleId}`)
  }

  function handleDismissIncomingBattle(territoryId: number) {
    setIncomingBattleAlerts((current) => current.filter((alert) => alert.territoryId !== territoryId))
  }

  const handleFindHome = useCallback(async () => {
    if (!user) return
    setHomeStatus('searching')
    const { data, error: rpcError } = await getMyHomeTerritory()
    if (rpcError || !data || data.length === 0) {
      setHomeStatus('not-found')
      return
    }
    const home = data[0]
    setHomeStatus('idle')
    handleJump(home.x, home.y)
  }, [user])

  const refreshOwnedTerritories = useCallback(async () => {
    if (!user?.id) return
    const { data, error: rpcError } = await getMyTerritories(user.id)
    if (rpcError) {
      setOwnedTerritories([])
      return
    }
    setOwnedTerritories(data ?? [])
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) {
      setOwnedTerritories(null)
      setStructureCardInstances(null)
      autoCenteredUserId.current = null
      return
    }

    let ignore = false

    getMyTerritories(user.id).then(({ data, error: rpcError }) => {
      if (ignore) return
      if (rpcError) {
        setOwnedTerritories([])
        return
      }
      setOwnedTerritories(data ?? [])
    })

    getMyStructureCardInstances(user.id).then(({ data }) => {
      if (ignore) return
      setStructureCardInstances(data ?? [])
    })

    if (autoCenteredUserId.current !== user.id) {
      autoCenteredUserId.current = user.id
      // Skip auto-centering on the player's home territory when the URL
      // already requested a specific tile (e.g. a deep link from /world).
      if (!hasExplicitCenter) {
        handleFindHome()
      }
    }

    return () => {
      ignore = true
    }
  }, [handleFindHome, hasExplicitCenter, user?.id])

  function getTerritoryMarker(territory: MyTerritory) {
    if (territory.is_home) return '🏠'
    if (territory.castle_rank) return '🏰'
    if (territory.village_rank) return '🏘️'
    return '🚩'
  }

  async function handleSelectTile(tile: Territory) {
    // Task 20: any battle-locked tile click-throughs straight to the
    // battle screen, for any viewer (spectating is allowed — only acting
    // in someone else's battle isn't, and that's enforced at the RPC
    // layer, not here).
    if (tile.battle_id) {
      router.push(`/battles/${tile.battle_id}`)
      return
    }
    const requestId = selectionRequestIdRef.current + 1
    selectionRequestIdRef.current = requestId
    setSelectedTile(tile)
    setGarrison(null)
    setGarrisonError(null)
    setOwnerInfo(null)
    setOwnerInfoError(null)
    setIncomingAttackInfo(null)
    setClaimInfo(null)
    setRelationState(null)
    setShowAttackModal(false)
    setShowTransferModal(false)
    const shouldLoadOwnerInfo = Boolean(tile.owner_id && tile.owner_id !== user?.id)
    setOwnerInfoLoading(shouldLoadOwnerInfo)
    if (shouldLoadOwnerInfo && tile.owner_id) {
      getRelation(tile.owner_id).then(({ data }) => {
        if (selectionRequestIdRef.current !== requestId) return
        setRelationState(data ?? null)
      })
      getPlayerPublicInfo(tile.owner_id).then(({ data, error: playerError }) => {
        if (selectionRequestIdRef.current !== requestId) return
        setOwnerInfoLoading(false)
        if (playerError) {
          setOwnerInfoError(playerError.message)
          return
        }
        if (!data) return
        setOwnerInfo({
          ...data,
          level: levelForXp(data.xp),
        })
      })
    } else {
      setOwnerInfoLoading(false)
    }
    if (tile.battle_locked_by) {
      // battle_locked_by is set the instant declare_attack is called,
      // well before the attacking army physically arrives and a battle
      // row exists — fetch that arrival ETA separately so the modal can
      // show "vojska dorazí za X" instead of just "v boji" with no info.
      getIncomingAttackInfo(tile.id).then(({ data }) => {
        if (selectionRequestIdRef.current !== requestId) return
        setIncomingAttackInfo(data ?? null)
      })
    }
    if (tile.claim_locked_by) {
      // claim_locked_by only holds the raw claimant player id — fetch
      // their identity + home coords separately (mirrors the
      // battle_locked_by/getIncomingAttackInfo case just above) so the
      // modal can show *who* is claiming and link through to their home.
      getClaimInfo(tile.id).then(({ data }) => {
        if (selectionRequestIdRef.current !== requestId) return
        setClaimInfo(data ?? null)
      })
    }
    const { data, error: rpcError } = await getCardInstancesAtTerritory(tile.id)
    if (selectionRequestIdRef.current !== requestId) return
    if (rpcError) {
      setGarrisonError(rpcError.message)
      return
    }
    setGarrison(data ?? [])
  }

  return (
    <main className="min-h-screen p-8 flex flex-col items-center gap-6">
      <div className="w-full max-w-4xl flex flex-col gap-4">
        <Link href="/" className="underline text-sm text-zinc-400 hover:text-zinc-200">
          ← Domů
        </Link>
        <h1 className="text-2xl font-bold text-center">Mapa království</h1>

        {user && (
          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <button
              onClick={handleFindHome}
              disabled={homeStatus === 'searching'}
              className="self-center rounded-full border border-zinc-600 hover:border-zinc-400 px-6 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {homeStatus === 'searching' ? 'Hledám…' : '🏠 Moje domovské území'}
            </button>
            {homeStatus === 'not-found' && (
              <p className="text-center text-xs text-red-400">
                Domovské území nenalezeno (možná ještě nemáš dokončený onboarding).
              </p>
            )}
            <div className="flex items-center gap-2">
              <label htmlFor="owned-territory-select" className="text-sm font-semibold text-zinc-200 shrink-0">
                Tvoje území
              </label>
              {ownedTerritories === null ? (
                <p className="text-xs text-zinc-500">Načítám tvá území…</p>
              ) : ownedTerritories.length === 0 ? (
                <p className="text-xs text-zinc-500">Zatím nevlastníš žádné území.</p>
              ) : (
                <select
                  id="owned-territory-select"
                  aria-label="Zaostřit na vlastní území"
                  defaultValue=""
                  onChange={(e) => {
                    const territory = ownedTerritories.find((t) => String(t.id) === e.target.value)
                    if (territory) handleJump(territory.x, territory.y)
                    e.target.value = ''
                  }}
                  className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-xs text-zinc-100"
                >
                  <option value="" disabled>
                    Vyber území k zaostření…
                  </option>
                  {ownedTerritories.map((territory) => (
                    <option key={territory.id} value={territory.id}>
                      {`${getTerritoryMarker(territory)} ${territory.name ? `${territory.name} ` : ''}(${territory.x}, ${territory.y})`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        <MyMovementsPanel
          myPlayerId={user?.id ?? null}
          refreshKey={movementsRefreshKey}
          onNavigateToTerritory={handleJump}
        />

        {incomingBattleAlerts.length > 0 && (
          <div className="flex flex-col gap-3">
            {incomingBattleAlerts.map((alert) => (
              <div
                key={alert.territoryId}
                className="flex flex-col gap-3 rounded-2xl border border-red-800 bg-red-950/70 p-4 text-sm text-red-50 md:flex-row md:items-start md:justify-between"
              >
                <div className="flex-1">
                  <p className="font-semibold">Vaše území {alert.territoryLabel} bylo napadeno!</p>
                  {!alert.battleId && (
                    <p className="mt-1 text-xs text-red-200">
                      Útočící vojska jsou na cestě — tlačítko začne fungovat hned, jakmile bitva vznikne.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 self-start">
                  <button
                    onClick={() => handleOpenIncomingBattle(alert.territoryId, alert.battleId)}
                    className="rounded-full border border-red-500/60 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-50 transition-colors hover:border-red-400 hover:bg-red-500/20"
                  >
                    Přejít do bitvy
                  </button>
                  <button
                    type="button"
                    aria-label={`Zavřít upozornění na útok na území ${alert.territoryLabel}`}
                    onClick={() => handleDismissIncomingBattle(alert.territoryId)}
                    className="rounded-full border border-red-900 px-3 py-2 text-xs font-semibold text-red-200 transition-colors hover:border-red-700 hover:text-red-50"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {territories === null ? (
          <p className="text-zinc-400 text-center">Načítám…</p>
        ) : (
          <MapViewport
            territories={territories}
            centerX={centerX}
            centerY={centerY}
            viewSize={viewSize}
            currentUserId={user?.id ?? null}
            onPan={handlePan}
            onJump={handleJump}
            onSelectTile={handleSelectTile}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            canZoomIn={zoomIndex > 0}
            canZoomOut={zoomIndex < ZOOM_LEVELS.length - 1}
            toolbarContent={
              <button
                type="button"
                aria-pressed={showMovementArrows}
                onClick={() => setShowMovementArrows((current) => !current)}
                className={`shrink-0 rounded border px-3 py-1 text-sm font-semibold transition-colors ${
                  showMovementArrows
                    ? 'border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500'
                }`}
              >
                Zobrazit pohyby
              </button>
            }
            overlay={
              <MapMovementArrows
                visible={showMovementArrows}
                myPlayerId={user?.id ?? null}
                refreshKey={movementsRefreshKey}
                centerX={centerX}
                centerY={centerY}
                viewSize={viewSize}
                onNavigateToTerritory={handleJump}
              />
            }
          />
        )}

        {selectedTile && (
          <GarrisonModal
            territory={selectedTile}
            instances={garrison}
            error={garrisonError}
            onClose={() => setSelectedTile(null)}
            myPlayerId={user?.id ?? null}
            onAttack={() => setShowAttackModal(true)}
            onTransfer={() => setShowTransferModal(true)}
            ownerInfo={ownerInfo}
            ownerInfoLoading={ownerInfoLoading}
            ownerInfoError={ownerInfoError}
            relationState={relationState}
            incomingAttackInfo={incomingAttackInfo}
            claimInfo={claimInfo}
            onNavigateToTerritory={(x, y) => {
              handleJump(x, y)
              setSelectedTile(null)
            }}
            onRename={async (territoryId, newName) => {
              await renameTerritory(territoryId, newName)
              const trimmed = newName.trim()
              setSelectedTile((current) =>
                current && current.id === territoryId ? { ...current, name: trimmed || null } : current
              )
              loadViewport(centerX, centerY, viewSize)
              refreshOwnedTerritories()
            }}
            structureCardOptions={structureCardInstances ?? undefined}
            onBuildStructure={async (territoryId, cardInstanceId) => {
              await buildStructure(territoryId, cardInstanceId)
              loadViewport(centerX, centerY, viewSize)
              if (user?.id) {
                getMyStructureCardInstances(user.id).then(({ data }) => {
                  setStructureCardInstances(data ?? [])
                })
              }
            }}
            onAbandon={async (territoryId) => {
              const { error: abandonErr } = await abandonTerritory(territoryId)
              if (abandonErr) throw new Error(abandonErr.message)
              setSelectedTile(null)
              loadViewport(centerX, centerY, viewSize)
              refreshOwnedTerritories()
            }}
            kingRelocationAvailable={kingRelocationAvailable}
            onRelocateHome={async (territoryId) => {
              const { error: relocateErr } = await relocateHome(territoryId)
              if (relocateErr) throw new Error(relocateErr.message)
              setKingRelocationUsedAt(new Date().toISOString())
              setSelectedTile(null)
              loadViewport(centerX, centerY, viewSize)
              refreshOwnedTerritories()
            }}
          />
        )}

        {selectedTile && showAttackModal && (
          <DeclareAttackModal
            territory={selectedTile}
            myPlayerId={user?.id ?? null}
            onClose={() => setShowAttackModal(false)}
            onDeclared={() => {
              loadViewport(centerX, centerY, viewSize)
              setMovementsRefreshKey((k) => k + 1)
            }}
          />
        )}

        {selectedTile && showTransferModal && (
          <TransferModal
            territory={selectedTile}
            myPlayerId={user?.id ?? null}
            onClose={() => setShowTransferModal(false)}
            onTransferred={() => {
              setShowTransferModal(false)
              loadViewport(centerX, centerY, viewSize)
              setMovementsRefreshKey((k) => k + 1)
            }}
          />
        )}
      </div>
    </main>
  )
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen p-6 sm:p-10">
          <p className="text-sm text-zinc-400">Načítám mapu…</p>
        </main>
      }
    >
      <MapPageContent />
    </Suspense>
  )
}
