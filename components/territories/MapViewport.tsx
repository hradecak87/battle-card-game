'use client'

import { useRef, useState } from 'react'
import { Territory } from '@/lib/territories/api'

const DIFFICULTY_COLOR: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'bg-green-900',
  2: 'bg-lime-900',
  3: 'bg-yellow-900',
  4: 'bg-orange-900',
  5: 'bg-red-950',
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

  function handleJumpSubmit(e: React.FormEvent) {
    e.preventDefault()
    const x = Number(jumpX)
    const y = Number(jumpY)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      onJump(x, y)
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

  return (
    <div className="flex flex-col gap-3" data-testid="map-viewport">
      <div className="flex items-center gap-4">
        <div className="grid grid-cols-3 gap-1 w-24">
          <span />
          <button aria-label="Posunout nahoru" onClick={() => onPan(0, -1)} className="rounded bg-zinc-800 px-2 py-1">
            ↑
          </button>
          <span />
          <button aria-label="Posunout doleva" onClick={() => onPan(-1, 0)} className="rounded bg-zinc-800 px-2 py-1">
            ←
          </button>
          <span />
          <button aria-label="Posunout doprava" onClick={() => onPan(1, 0)} className="rounded bg-zinc-800 px-2 py-1">
            →
          </button>
          <span />
          <button aria-label="Posunout dolů" onClick={() => onPan(0, 1)} className="rounded bg-zinc-800 px-2 py-1">
            ↓
          </button>
          <span />
        </div>

        {(onZoomIn || onZoomOut) && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              aria-label="Přiblížit"
              onClick={onZoomIn}
              disabled={!canZoomIn}
              className="rounded bg-zinc-800 px-2 py-1 disabled:opacity-40"
            >
              🔍+
            </button>
            <button
              type="button"
              aria-label="Oddálit"
              onClick={onZoomOut}
              disabled={!canZoomOut}
              className="rounded bg-zinc-800 px-2 py-1 disabled:opacity-40"
            >
              🔍−
            </button>
          </div>
        )}

        <form onSubmit={handleJumpSubmit} className="flex items-end gap-2">
          <label className="flex flex-col text-sm text-zinc-400">
            X
            <input
              aria-label="Souřadnice X"
              type="number"
              value={jumpX}
              onChange={(e) => setJumpX(e.target.value)}
              className="w-20 rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-sm text-zinc-400">
            Y
            <input
              aria-label="Souřadnice Y"
              type="number"
              value={jumpY}
              onChange={(e) => setJumpY(e.target.value)}
              className="w-20 rounded bg-zinc-900 border border-zinc-700 px-2 py-1"
            />
          </label>
          <button type="submit" className="rounded bg-zinc-100 text-zinc-900 px-3 py-1 font-semibold">
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
            const tile = byCoord.get(`${x},${y}`)
            const color = tile ? DIFFICULTY_COLOR[tile.difficulty] : 'bg-zinc-900'
            const isHovered = hoveredTile?.x === x && hoveredTile?.y === y
            const isOwnedByMe = Boolean(tile?.owner_id && currentUserId && tile.owner_id === currentUserId)
            const isUnderAttack = Boolean(tile?.battle_locked_by)
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
                className={`relative aspect-square min-w-0 min-h-0 border flex flex-col items-center justify-center gap-0.5 overflow-visible ${color} ${
                  isUnderAttack
                    ? 'border-red-500 ring-2 ring-red-500 ring-inset animate-pulse'
                    : isOwnedByMe
                    ? 'border-sky-200 ring-2 ring-sky-400 ring-inset'
                    : 'border-zinc-800'
                }`}
              >
                {tile?.is_home && (
                  <span title="Domov" className="text-lg leading-none drop-shadow">
                    🏠
                  </span>
                )}
                {tile?.castle_rank && (
                  <span title="Hrad" className="text-xl leading-none drop-shadow">
                    🏰
                  </span>
                )}
                {tile?.village_rank && (
                  <span title="Vesnice" className="text-xl leading-none drop-shadow">
                    🏘️
                  </span>
                )}
                {tile?.owner_id && !tile?.is_home && (
                  <span title="Vlastník" className="text-lg leading-none drop-shadow">
                    🚩
                  </span>
                )}
                {tile?.claim_locked_by && (
                  <span title="Probíhá zábor" className="text-lg leading-none drop-shadow">
                    ⏳
                  </span>
                )}
                {tile?.battle_locked_by && (
                  <span title="Probíhá boj" className="text-lg leading-none drop-shadow">
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
