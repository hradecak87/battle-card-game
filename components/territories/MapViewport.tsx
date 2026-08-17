'use client'

import { useEffect, useRef, useState } from 'react'
import { Territory } from '@/lib/territories/api'

const DIFFICULTY_COLOR: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'bg-green-900',
  2: 'bg-lime-900',
  3: 'bg-yellow-900',
  4: 'bg-orange-900',
  5: 'bg-red-950',
}

const MAP_MIN = 0
const MAP_MAX = 255

type HighlightColor = 'sky' | 'red' | 'transparent'

// 'inner' = shared edge between two tiles of the same highlighted group:
// keep the normal thin grid line instead of erasing it, so only the
// *outer* perimeter of a connected owned/attacked region gets the thick
// colored outline.
const BORDER_CLASSES: Record<
  'top' | 'right' | 'bottom' | 'left',
  Record<HighlightColor | 'inner', string>
> = {
  top: {
    sky: 'border-t-2 border-t-sky-400',
    red: 'border-t-2 border-t-red-500',
    transparent: 'border-t-2 border-t-transparent',
    inner: 'border-t border-t-zinc-800',
  },
  right: {
    sky: 'border-r-2 border-r-sky-400',
    red: 'border-r-2 border-r-red-500',
    transparent: 'border-r-2 border-r-transparent',
    inner: 'border-r border-r-zinc-800',
  },
  bottom: {
    sky: 'border-b-2 border-b-sky-400',
    red: 'border-b-2 border-b-red-500',
    transparent: 'border-b-2 border-b-transparent',
    inner: 'border-b border-b-zinc-800',
  },
  left: {
    sky: 'border-l-2 border-l-sky-400',
    red: 'border-l-2 border-l-red-500',
    transparent: 'border-l-2 border-l-transparent',
    inner: 'border-l border-l-zinc-800',
  },
}

export interface MapViewportProps {
  territories: Territory[]
  centerX: number
  centerY: number
  viewSize?: number
  currentUserId?: string | null
  onPan: (dx: number, dy: number) => void
  onJump: (x: number, y: number) => void
  onSelectTile?: (territory: Territory) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  canZoomIn?: boolean
  canZoomOut?: boolean
}

function getOwnerLabel(tile: Territory, currentUserId?: string | null) {
  if (!tile.owner_id) return 'Neobsazeno'
  if (currentUserId && tile.owner_id === currentUserId) return 'Tvé území'
  return 'Cizí hráč'
}

function clamp(value: number) {
  return Math.max(MAP_MIN, Math.min(MAP_MAX, value))
}

function isWithinBounds(x: number, y: number) {
  return x >= MAP_MIN && x <= MAP_MAX && y >= MAP_MIN && y <= MAP_MAX
}

function getIconFontSize(viewSize: number) {
  return `${Math.max(12, Math.round(34 - viewSize * 0.7))}px`
}

/**
 * Pannable grid viewport (design spec §10): arrow buttons AND click-drag
 * panning, plus a coordinate-jump input. Renders whichever `territories`
 * window the parent page fetched via `getViewport`; this component itself
 * has no network dependency.
 */
export default function MapViewport({
  territories,
  centerX,
  centerY,
  viewSize = 15,
  currentUserId,
  onPan,
  onJump,
  onSelectTile,
  onZoomIn,
  onZoomOut,
  canZoomIn = true,
  canZoomOut = true,
}: MapViewportProps) {
  const [jumpX, setJumpX] = useState(String(centerX))
  const [jumpY, setJumpY] = useState(String(centerY))
  const [hoveredTile, setHoveredTile] = useState<{ x: number; y: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const half = Math.floor(viewSize / 2)
  const x1 = centerX - half
  const y1 = centerY - half

  const byCoord = new Map<string, Territory>()
  for (const t of territories) {
    byCoord.set(`${t.x},${t.y}`, t)
  }

  useEffect(() => {
    setJumpX(String(centerX))
    setJumpY(String(centerY))
  }, [centerX, centerY])

  function handleJumpSubmit(e: React.FormEvent) {
    e.preventDefault()
    const x = Number(jumpX)
    const y = Number(jumpY)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const clampedX = clamp(x)
      const clampedY = clamp(y)
      setJumpX(String(clampedX))
      setJumpY(String(clampedY))
      onJump(clampedX, clampedY)
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    dragStart.current = { x: e.clientX, y: e.clientY }
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (!dragStart.current) return
    const dxPx = e.clientX - dragStart.current.x
    const dyPx = e.clientY - dragStart.current.y
    dragStart.current = null
    // Roughly one tile per 24px of drag; negative because dragging right
    // should reveal tiles to the left (pan the view, not the content).
    const tileDx = -Math.round(dxPx / 24)
    const tileDy = -Math.round(dyPx / 24)
    if (tileDx !== 0 || tileDy !== 0) {
      onPan(tileDx, tileDy)
    }
  }

  const iconStyle = { fontSize: getIconFontSize(viewSize) }

  return (
    <div className="flex flex-col gap-3" data-testid="map-viewport">
      <div
        className="flex flex-row flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-between"
        data-testid="map-toolbar"
      >
        <div className="grid grid-cols-3 gap-0.5 w-[4.5rem] shrink-0">
          <span />
          <button aria-label="Posunout nahoru" onClick={() => onPan(0, -1)} className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm leading-none">
            ↑
          </button>
          <span />
          <button aria-label="Posunout doleva" onClick={() => onPan(-1, 0)} className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm leading-none">
            ←
          </button>
          <span />
          <button aria-label="Posunout doprava" onClick={() => onPan(1, 0)} className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm leading-none">
            →
          </button>
          <span />
          <button aria-label="Posunout dolů" onClick={() => onPan(0, 1)} className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm leading-none">
            ↓
          </button>
          <span />
        </div>

        {(onZoomIn || onZoomOut) && (
          <div className="flex flex-row gap-1 shrink-0">
            <button
              type="button"
              aria-label="Přiblížit"
              onClick={onZoomIn}
              disabled={!canZoomIn}
              className="rounded bg-zinc-800 px-2 py-1 text-sm disabled:opacity-40"
            >
              🔍+
            </button>
            <button
              type="button"
              aria-label="Oddálit"
              onClick={onZoomOut}
              disabled={!canZoomOut}
              className="rounded bg-zinc-800 px-2 py-1 text-sm disabled:opacity-40"
            >
              🔍−
            </button>
          </div>
        )}

        <form onSubmit={handleJumpSubmit} className="flex flex-row items-center gap-1.5 shrink-0">
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            X
            <input
              aria-label="Souřadnice X"
              type="number"
              value={jumpX}
              onChange={(e) => setJumpX(e.target.value)}
              className="w-11 rounded bg-zinc-900 border border-zinc-700 px-1.5 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            Y
            <input
              aria-label="Souřadnice Y"
              type="number"
              value={jumpY}
              onChange={(e) => setJumpY(e.target.value)}
              className="w-11 rounded bg-zinc-900 border border-zinc-700 px-1.5 py-1 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-zinc-100 text-zinc-900 px-3 py-1 text-sm font-semibold"
          >
            Přejít
          </button>
        </form>
      </div>

      <div
        data-testid="map-grid"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        className="grid select-none cursor-grab active:cursor-grabbing"
        style={{ gridTemplateColumns: `repeat(${viewSize}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: viewSize }).map((_, row) =>
          Array.from({ length: viewSize }).map((_, col) => {
            const x = x1 + col
            const y = y1 + row
            const isVoid = !isWithinBounds(x, y)
            const tile = byCoord.get(`${x},${y}`)
            const color = tile ? DIFFICULTY_COLOR[tile.difficulty] : 'bg-zinc-900'
            const isHovered = hoveredTile?.x === x && hoveredTile?.y === y
            const isOwnedByMe = Boolean(tile?.owner_id && currentUserId && tile.owner_id === currentUserId)
            const isUnderAttack = Boolean(tile?.battle_locked_by)
            const highlightColor: HighlightColor | null = isUnderAttack ? 'red' : isOwnedByMe ? 'sky' : null

            if (isVoid) {
              return (
                <div
                  key={`${x},${y}`}
                  data-testid={`void-tile-${x},${y}`}
                  aria-hidden="true"
                  className="aspect-square min-w-0 min-h-0 border border-dashed border-zinc-900 bg-black/20"
                />
              )
            }

            const neighbors = {
              top: byCoord.get(`${x},${y - 1}`),
              right: byCoord.get(`${x + 1},${y}`),
              bottom: byCoord.get(`${x},${y + 1}`),
              left: byCoord.get(`${x - 1},${y}`),
            }

            const matchingHighlight = (neighbor?: Territory) => {
              if (!tile || !neighbor || !highlightColor) return false
              if (highlightColor === 'red') {
                return Boolean(tile.battle_locked_by && neighbor.battle_locked_by === tile.battle_locked_by)
              }
              return Boolean(
                currentUserId &&
                  tile.owner_id === currentUserId &&
                  neighbor.owner_id === tile.owner_id
              )
            }

            const borderClasses = highlightColor
              ? [
                  BORDER_CLASSES.top[matchingHighlight(neighbors.top) ? 'inner' : highlightColor],
                  BORDER_CLASSES.right[matchingHighlight(neighbors.right) ? 'inner' : highlightColor],
                  BORDER_CLASSES.bottom[matchingHighlight(neighbors.bottom) ? 'inner' : highlightColor],
                  BORDER_CLASSES.left[matchingHighlight(neighbors.left) ? 'inner' : highlightColor],
                ].join(' ')
              : 'border-zinc-800'

            return (
              <button
                key={`${x},${y}`}
                type="button"
                aria-label={`Území ${x},${y}`}
                onClick={() => tile && onSelectTile?.(tile)}
                onMouseEnter={() => setHoveredTile({ x, y })}
                onMouseLeave={() => setHoveredTile((current) => (current?.x === x && current?.y === y ? null : current))}
                data-owned-by-me={isOwnedByMe ? 'true' : 'false'}
                data-under-attack={isUnderAttack ? 'true' : 'false'}
                className={`relative aspect-square min-w-0 min-h-0 border flex flex-col items-center justify-center gap-0.5 overflow-visible ${color} ${borderClasses} ${
                  isUnderAttack ? 'animate-pulse' : ''
                }`}
              >
                {tile?.is_home && (
                  <span title="Domov" className="leading-none drop-shadow" style={iconStyle}>
                    🏠
                  </span>
                )}
                {tile?.castle_rank && (
                  <span title="Hrad" className="leading-none drop-shadow" style={iconStyle}>
                    🏰
                  </span>
                )}
                {tile?.village_rank && (
                  <span title="Vesnice" className="leading-none drop-shadow" style={iconStyle}>
                    🏘️
                  </span>
                )}
                {tile?.owner_id && !tile?.is_home && (
                  <span title="Vlastník" className="leading-none drop-shadow" style={iconStyle}>
                    🚩
                  </span>
                )}
                {tile?.claim_locked_by && (
                  <span title="Probíhá zábor" className="leading-none drop-shadow" style={iconStyle}>
                    ⏳
                  </span>
                )}
                {tile?.battle_locked_by && (
                  <span title="Probíhá boj" className="leading-none drop-shadow" style={iconStyle}>
                    ⚔️
                  </span>
                )}
                {isHovered && (
                  <div className="pointer-events-none absolute left-1/2 top-0 z-20 w-40 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-left text-xs text-zinc-100 shadow-lg">
                    <p className="font-semibold">
                      ({x}, {y})
                    </p>
                    {tile ? (
                      <>
                        <p>{getOwnerLabel(tile, currentUserId)}</p>
                        <p>{`Obtížnost: ${tile.difficulty}/5`}</p>
                        {tile.castle_rank && <p>{`Hrad: ${tile.castle_rank}`}</p>}
                        {tile.village_rank && <p>{`Vesnice: ${tile.village_rank}`}</p>}
                        {tile.claim_locked_by && <p>Probíhá zábor</p>}
                        {tile.battle_locked_by && <p className="text-red-400">Probíhá boj — klikni pro zobrazení</p>}
                      </>
                    ) : null}
                  </div>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
