'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  getViewport,
  getCardInstancesAtTerritory,
  getMyHomeTerritory,
  getIncomingAttackArrival,
  getPlayerPublicInfo,
  getMyTerritories,
  renameTerritory,
  buildStructure,
  getMyStructureCardInstances,
  CardInstanceWithTemplate,
  PlayerPublicInfo,
  MyTerritory,
  Territory,
} from '@/lib/territories/api'
import MapViewport from '@/components/territories/MapViewport'
import GarrisonModal from '@/components/territories/GarrisonModal'
import DeclareAttackModal from '@/components/territories/DeclareAttackModal'
import TransferModal from '@/components/territories/TransferModal'
import MyMovementsPanel from '@/components/territories/MyMovementsPanel'
import { useTerritoryBattleChannel } from '@/lib/battles/useTerritoryBattleChannel'
import { levelForXp } from '@/lib/players/leveling'
import { useSession } from '@/lib/supabase/useSession'

// Capped below Supabase/PostgREST's default 1000-row response limit
// (viewSize² must stay under that, confirmed live: a 35×35=1225 request
// silently truncated to 1000 rows, dropping the last several columns).
const ZOOM_LEVELS = [7, 11, 15, 19, 23, 27]
const DEFAULT_ZOOM_INDEX = 2 // 15 tiles per side, same as the previous fixed size
const MAP_MIN = 0
const MAP_MAX = 255

type SelectedOwnerInfo = PlayerPublicInfo & {
  level: number
}

function clamp(value: number) {
  return Math.max(MAP_MIN, Math.min(MAP_MAX, value))
}

export default function MapPage() {
  const router = useRouter()
  const { user } = useSession()
  const [centerX, setCenterX] = useState(128)
  const [centerY, setCenterY] = useState(128)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [territories, setTerritories] = useState<Territory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedTile, setSelectedTile] = useState<Territory | null>(null)
  const [garrison, setGarrison] = useState<CardInstanceWithTemplate[] | null>(null)
  const [garrisonError, setGarrisonError] = useState<string | null>(null)
  const [ownerInfo, setOwnerInfo] = useState<SelectedOwnerInfo | null>(null)
  const [ownerInfoLoading, setOwnerInfoLoading] = useState(false)
  const [ownerInfoError, setOwnerInfoError] = useState<string | null>(null)
  const [incomingAttackArrivesAt, setIncomingAttackArrivesAt] = useState<string | null>(null)
  const [homeStatus, setHomeStatus] = useState<'idle' | 'searching' | 'not-found'>('idle')
  const [ownedTerritories, setOwnedTerritories] = useState<MyTerritory[] | null>(null)
  const [structureCardInstances, setStructureCardInstances] = useState<CardInstanceWithTemplate[] | null>(null)
  const [showAttackModal, setShowAttackModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [movementsRefreshKey, setMovementsRefreshKey] = useState(0)
  const selectionRequestIdRef = useRef(0)
  const autoCenteredUserId = useRef<string | null>(null)

  const viewSize = ZOOM_LEVELS[zoomIndex]

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

  useEffect(() => {
    loadViewport(centerX, centerY, viewSize)
  }, [centerX, centerY, viewSize, loadViewport])

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
      handleFindHome()
    }

    return () => {
      ignore = true
    }
  }, [handleFindHome, user?.id])

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
    setIncomingAttackArrivesAt(null)
    setShowAttackModal(false)
    setShowTransferModal(false)
    const shouldLoadOwnerInfo = Boolean(tile.owner_id && tile.owner_id !== user?.id)
    setOwnerInfoLoading(shouldLoadOwnerInfo)
    if (shouldLoadOwnerInfo && tile.owner_id) {
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
      getIncomingAttackArrival(tile.id).then(({ data }) => {
        if (selectionRequestIdRef.current !== requestId) return
        setIncomingAttackArrivesAt(data?.transfer_arrives_at ?? null)
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
                      {`${getTerritoryMarker(territory)} (${territory.x}, ${territory.y})`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        <MyMovementsPanel myPlayerId={user?.id ?? null} refreshKey={movementsRefreshKey} />

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
            incomingAttackArrivesAt={incomingAttackArrivesAt}
            onRename={async (territoryId, newName) => {
              await renameTerritory(territoryId, newName)
              loadViewport(centerX, centerY, viewSize)
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
