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

type HighlightColor = 'sky' | 'red' | 'foreign'

// Perimeter highlight edges are drawn as absolutely-positioned 1px overlay
// bars, not a CSS border or box-shadow. box-shadow paints *underneath* the
// tile's own border, so the thin grid border ended up covering it; a plain
// colored border, meanwhile, mitres together with the adjacent (thinner,
// differently colored) border at each corner and eats a pixel off the end
// of the line. A child element painted at the exact edge position sits on
// top of the parent's own border by normal stacking order, is independent
// per side (no mitring with the other three sides), and is sized to
// exactly 1px so it just replaces the grid line's color at that spot.
const HIGHLIGHT_BAR_COLOR: Record<Exclude<HighlightColor, 'foreign'>, string> = {
  sky: 'bg-sky-400',
  red: 'bg-red-500',
}

// Distinct, easily-told-apart colors for other players' territory outlines
// (never sky — reserved for "mine" — or red — reserved for "under attack").
// The color for a given owner is picked deterministically from their id (a
// stable hash, not truly random) so the same foreign player always shows
// the same color and a contiguous block of their territory reads as one
// connected outline rather than a a flag per tile.
const FOREIGN_OWNER_COLORS = [
  'bg-amber-400',
  'bg-violet-400',
  'bg-pink-400',
  'bg-emerald-400',
  'bg-orange-400',
  'bg-fuchsia-400',
  'bg-teal-400',
  'bg-rose-400',
  'bg-cyan-400',
  'bg-lime-400',
]

function hashStringToIndex(value: string, modulo: number) {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % modulo
}

function getForeignOwnerColorClass(ownerId: string) {
  return FOREIGN_OWNER_COLORS[hashStringToIndex(ownerId, FOREIGN_OWNER_COLORS.length)]
}

// Each tile draws its own border, so the boundary between two tiles is
// actually TWO adjacent 1px lines (one contributed by each tile), not a
// single shared 1px line. Covering only "our" tile's 1px left a thin sliver
// of the neighbor's plain border pixel still visible, which read as a gap.
// The bar below is 2px wide, straddling the seam from -1px to +1px, so it
// covers both tiles' contributing pixels.
// Confirmed via a rendered reproduction (headless screenshot, zoomed to
// pixel level): with bars sized exactly to the tile's own width/height
// (inset-x-0 / inset-y-0), the two perpendicular bars meeting at a corner
// (e.g. the top bar and the left bar of the same tile) each stop exactly
// at that corner point and leave a 1px notch uncovered there. Extending
// each bar 1px past both of its own ends makes the two bars overlap in
// the corner square instead of just touching, closing that notch.
const HIGHLIGHT_BAR_POSITION: Record<'top' | 'right' | 'bottom' | 'left', string> = {
  top: '-left-px -right-px -top-px h-0.5',
  right: '-top-px -bottom-px -right-px w-0.5',
  bottom: '-left-px -right-px -bottom-px h-0.5',
  left: '-top-px -bottom-px -left-px w-0.5',
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

// A tile's highlight "group": tiles that share the same group key merge
// their shared edge (no colored line drawn between them), while the
// outline is drawn wherever the group key changes. Battle takes priority
// (a defended tile still reads as "in battle" first), then ownership by
// the current player, then any other owner (each getting their own stable
// color via getForeignOwnerColorClass).
function getHighlightInfo(
  t: Territory | undefined,
  currentUserId?: string | null
): { key: string; color: HighlightColor; colorClass: string } | null {
  if (!t) return null
  if (t.battle_locked_by) {
    return { key: `battle:${t.battle_locked_by}`, color: 'red', colorClass: HIGHLIGHT_BAR_COLOR.red }
  }
  if (currentUserId && t.owner_id === currentUserId) {
    return { key: 'me', color: 'sky', colorClass: HIGHLIGHT_BAR_COLOR.sky }
  }
  if (t.owner_id) {
    return { key: `owner:${t.owner_id}`, color: 'foreign', colorClass: getForeignOwnerColorClass(t.owner_id) }
  }
  return null
}

function clamp(value: number) {
  return Math.max(MAP_MIN, Math.min(MAP_MAX, value))
}

function isWithinBounds(x: number, y: number) {
  return x >= MAP_MIN && x <= MAP_MAX && y >= MAP_MIN && y <= MAP_MAX
}

// Prefers the actual measured cell size (`cellPx`, from a ResizeObserver on
// the grid element) so icons always scale in lockstep with how big tiles
// really render — the previous viewSize-only formula assumed a fixed
// container width, which silently broke (icons stopped shrinking, or grew
// larger than the tile) whenever the actual rendered width differed, e.g.
// at some zoom steps on narrower screens. Falls back to the viewSize-based
// formula when no measurement is available yet (e.g. server-side render,
// first paint, or in tests where ResizeObserver doesn't exist).
function getIconFontSize(viewSize: number, cellPx: number | null) {
  if (cellPx && cellPx > 0) {
    return `${Math.max(10, Math.min(34, Math.round(cellPx * 0.55)))}px`
  }
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
  const gridRef = useRef<HTMLDivElement>(null)
  const [cellPx, setCellPx] = useState<number | null>(null)

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

  // Measures the grid's real rendered width so icon sizing (getIconFontSize)
  // can scale exactly with the actual tile size instead of guessing from
  // viewSize alone (see getIconFontSize for why that broke at some zoom
  // steps). Guarded for environments without ResizeObserver (e.g. jsdom).
  useEffect(() => {
    const el = gridRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) setCellPx(width / viewSize)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [viewSize])

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

  const iconStyle = { fontSize: getIconFontSize(viewSize, cellPx) }

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
        ref={gridRef}
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

            const tileHighlight = getHighlightInfo(tile, currentUserId)

            const matchingHighlight = (neighbor?: Territory) => {
              if (!tileHighlight) return false
              const neighborHighlight = getHighlightInfo(neighbor, currentUserId)
              return neighborHighlight?.key === tileHighlight.key
            }

            const perimeterEdges = tileHighlight
              ? (['top', 'right', 'bottom', 'left'] as const).filter(
                  (edge) => !matchingHighlight(neighbors[edge])
                )
              : []

            // Castle/village share one compact row instead of stacking
            // vertically — with a home marker too, three full-size icons
            // stacked in one small tile used to overflow it. Shown side by
            // side and shrunk when there's more than one, this reads as a
            // single "these structures are here" unit sized to fit the tile.
            const structureIcons: Array<{ key: string; icon: string; title: string }> = []
            if (tile?.is_home) structureIcons.push({ key: 'home', icon: '🏠', title: 'Domov' })
            if (tile?.castle_rank) structureIcons.push({ key: 'castle', icon: '🏰', title: 'Hrad' })
            if (tile?.village_rank) structureIcons.push({ key: 'village', icon: '🏘️', title: 'Vesnice' })
            const structureFontSize =
              structureIcons.length > 1
                ? `${Math.max(8, Math.round(parseInt(iconStyle.fontSize, 10) * 0.62))}px`
                : iconStyle.fontSize

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
                className={`relative aspect-square min-w-0 min-h-0 border border-zinc-800 flex flex-col items-center justify-center gap-0.5 overflow-visible ${color} ${
                  isUnderAttack ? 'animate-pulse' : ''
                }`}
              >
                {tileHighlight &&
                  perimeterEdges.map((edge) => (
                    <span
                      key={edge}
                      aria-hidden="true"
                      data-testid={`highlight-${edge}-${x},${y}`}
                      className={`pointer-events-none absolute z-10 ${HIGHLIGHT_BAR_POSITION[edge]} ${tileHighlight.colorClass}`}
                    />
                  ))}
                {structureIcons.length > 0 && (
                  <div className={`flex flex-row items-center justify-center gap-0.5 ${isUnderAttack ? 'opacity-40' : ''}`}>
                    {structureIcons.map((s) => (
                      <span key={s.key} title={s.title} className="leading-none drop-shadow" style={{ fontSize: structureFontSize }}>
                        {s.icon}
                      </span>
                    ))}
                  </div>
                )}
                {tile?.claim_locked_by && (
                  <span title="Probíhá zábor" className="leading-none drop-shadow" style={iconStyle}>
                    ⏳
                  </span>
                )}
                {tile?.battle_locked_by && (
                  <span
                    title="Probíhá boj"
                    className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center leading-none drop-shadow animate-pulse"
                    style={iconStyle}
                  >
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
