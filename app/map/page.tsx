'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { getMinimapOverview, getViewport, getCardInstancesAtTerritory, CardInstanceWithTemplate, Territory } from '@/lib/territories/api'
import MapViewport from '@/components/territories/MapViewport'
import { useSession } from '@/lib/supabase/useSession'

// Capped below Supabase/PostgREST's default 1000-row response limit
// (viewSize² must stay under that, confirmed live: a 35×35=1225 request
// silently truncated to 1000 rows, dropping the last several columns).
const ZOOM_LEVELS = [7, 11, 15, 19, 23, 27]
const DEFAULT_ZOOM_INDEX = 2 // 15 tiles per side, same as the previous fixed size
const MAP_MIN = 0
const MAP_MAX = 255

function clamp(value: number) {
  return Math.max(MAP_MIN, Math.min(MAP_MAX, value))
}

export default function MapPage() {
  const { user } = useSession()
  const [centerX, setCenterX] = useState(128)
  const [centerY, setCenterY] = useState(128)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [territories, setTerritories] = useState<Territory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedTile, setSelectedTile] = useState<Territory | null>(null)
  const [garrison, setGarrison] = useState<CardInstanceWithTemplate[] | null>(null)
  const [garrisonError, setGarrisonError] = useState<string | null>(null)
  const [homeStatus, setHomeStatus] = useState<'idle' | 'searching' | 'not-found'>('idle')

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

  async function handleFindHome() {
    if (!user) return
    setHomeStatus('searching')
    const { data, error: rpcError } = await getMinimapOverview()
    if (rpcError || !data) {
      setHomeStatus('not-found')
      return
    }
    const home = data.find((tile) => tile.owner_id === user.id)
    if (!home) {
      setHomeStatus('not-found')
      return
    }
    setHomeStatus('idle')
    handleJump(home.x, home.y)
  }

  async function handleSelectTile(tile: Territory) {
    setSelectedTile(tile)
    setGarrison(null)
    setGarrisonError(null)
    const { data, error: rpcError } = await getCardInstancesAtTerritory(tile.id)
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
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={handleFindHome}
              disabled={homeStatus === 'searching'}
              className="rounded-full border border-zinc-600 hover:border-zinc-400 px-6 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {homeStatus === 'searching' ? 'Hledám…' : '🏠 Moje domovské území'}
            </button>
            {homeStatus === 'not-found' && (
              <p className="text-xs text-red-400">
                Domovské území nenalezeno (možná ještě nemáš dokončený onboarding).
              </p>
            )}
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
          />
        )}

        {selectedTile && (
          <div data-testid="selected-tile" className="flex flex-col gap-2 text-sm text-zinc-400">
            <p>
              Vybráno území ({selectedTile.x}, {selectedTile.y})
            </p>
            {garrisonError && <p className="text-red-400">{garrisonError}</p>}
            {garrison === null && !garrisonError && <p>Načítám posádku…</p>}
            {garrison !== null && garrison.length === 0 && <p>Žádná vojska na tomto území.</p>}
            {garrison !== null && garrison.length > 0 && (
              <ul className="flex flex-col gap-1">
                {garrison.map((instance) => (
                  <li key={instance.instance_id}>
                    {instance.card_templates?.name ?? instance.template_id}
                    {instance.card_templates?.rank ? ` (${instance.card_templates.rank})` : ''}
                    {instance.status === 'in_transit' ? ' — na cestě' : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
