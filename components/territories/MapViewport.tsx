'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import { Territory } from '@/lib/territories/api'
import type { Rank } from '@/lib/cards/types'
import { RANK_FRAME } from '@/components/cards/TradingCard'
import {
  CASTLE_VARIANTS,
  CastleIcon,
  HomeIcon,
  pickVariant,
  VillageIcon,
  VILLAGE_VARIANTS,
  WallIcon,
} from '@/components/territories/icons/StructureIcons'

// Each difficulty level has 3 texture variants (base + "-b"/"-c", added
// alongside the original terrain-N.jpg) so a large contiguous terrain
// cluster (forest, water, etc. — see the map-level-clustering feature)
// doesn't read as an obviously tiled, repeating single image. The variant
// is picked deterministically from the tile's own x/y coordinates via
// `hashCoordToIndex` (see below — NOT the simpler string-hash `pickVariant`
// pattern used for castle/village icons, which visibly striped here since
// tile ids increment sequentially), so a given tile always shows the same
// texture across re-renders/pans instead of flickering between variants.
const DIFFICULTY_TERRAIN_VARIANTS: Record<1 | 2 | 3 | 4 | 5, readonly string[]> = {
  1: ['terrain-difficulty-1', 'terrain-difficulty-1-b', 'terrain-difficulty-1-c'],
  2: ['terrain-difficulty-2', 'terrain-difficulty-2-b', 'terrain-difficulty-2-c'],
  3: ['terrain-difficulty-3', 'terrain-difficulty-3-b', 'terrain-difficulty-3-c'],
  4: ['terrain-difficulty-4', 'terrain-difficulty-4-b', 'terrain-difficulty-4-c'],
  5: ['terrain-difficulty-5', 'terrain-difficulty-5-b', 'terrain-difficulty-5-c'],
}

const MAP_MIN = 0
const MAP_MAX = 255
const GARRISON_PIP_RANK_ORDER: Rank[] = ['common', 'uncommon', 'rare', 'epic', 'legend']

type HighlightColor = 'sky' | 'red' | 'foreign' | 'npc'

// Perimeter highlight edges are drawn as absolutely-positioned 1px overlay
// bars, not a CSS border or box-shadow. box-shadow paints *underneath* the
// tile's own border, so the thin grid border ended up covering it; a plain
// colored border, meanwhile, mitres together with the adjacent (thinner,
// differently colored) border at each corner and eats a pixel off the end
// of the line. A child element painted at the exact edge position sits on
// top of the parent's own border by normal stacking order, is independent
// per side (no mitring with the other three sides), and is sized to
// exactly 1px so it just replaces the grid line's color at that spot.
const HIGHLIGHT_BAR_COLOR: Record<Exclude<HighlightColor, 'foreign'> | 'yellow', string> = {
  sky: 'bg-sky-400',
  red: 'bg-red-500',
  npc: 'bg-fuchsia-400',
  yellow: 'bg-yellow-400',
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

// Terrain variants used to be picked via `pickVariant('terrain:' + tile.id, ...)`,
// but `tile.id` is a DB row id assigned in scanline (roughly x-major or
// y-major) order, so neighboring tiles have consecutive ids. The simple
// polynomial `hashStringToIndex` above doesn't avalanche well on strings
// that only differ by their trailing digits (e.g. "terrain:1041" vs
// "terrain:1042"), so consecutive ids mod 3 drifted in long visible runs —
// reading as diagonal/horizontal stripes of the same texture variant once
// zoomed out enough to see many tiles at once. This 2D integer hash mixes
// the tile's actual x/y coordinates (not a sequential id) through a
// multiply-xor-shift avalanche (same family as Murmur3's finalizer), so
// adjacent tiles get uncorrelated variant picks with no visible pattern,
// while still being fully deterministic for a given coordinate.
function hashCoordToIndex(x: number, y: number, modulo: number) {
  let h = (x * 0x1f1f1f1f) ^ y
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = (h ^ (h >>> 16)) >>> 0
  return h % modulo
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
  blinkTarget?: { x: number; y: number; nonce: number } | null
  viewSize?: number
  currentUserId?: string | null
  /** Player ids of the viewer's coalition allies, used to flag ally-owned tiles in the hover tooltip. */
  allyPlayerIds?: ReadonlySet<string>
  /** Whether to show the per-tile garrison-size pip dots at close zoom (viewSize <= 15). Defaults to true. */
  showGarrisonPips?: boolean
  toolbarContent?: ReactNode
  overlay?: ReactNode
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
  if (tile.owner_is_npc) {
    return tile.owner_display_name ? `Vlastník: ${tile.owner_display_name} (NPC)` : 'NPC říše'
  }
  return tile.owner_display_name ? `Vlastník: ${tile.owner_display_name}` : 'Cizí hráč'
}

// A tile's highlight "group": tiles that share the same group key merge
// their shared edge (no colored line drawn between them), while the
// outline is drawn wherever the group key changes. Battle takes priority
// (ownership only — battle status is drawn as a separate overlaid pulsing
// bar via getBattleHighlightInfo, so a tile that's both "mine" and "under
// attack" still shows its ownership color underneath the pulsing red).
function getHighlightInfo(
  t: Territory | undefined,
  currentUserId?: string | null
): { key: string; color: HighlightColor; colorClass: string } | null {
  if (!t) return null
  if (currentUserId && t.owner_id === currentUserId) {
    return { key: 'me', color: 'sky', colorClass: HIGHLIGHT_BAR_COLOR.sky }
  }
  if (t.owner_id && t.owner_is_npc) {
    return { key: `npc:${t.owner_id}`, color: 'npc', colorClass: HIGHLIGHT_BAR_COLOR.npc }
  }
  if (t.owner_id) {
    return { key: `owner:${t.owner_id}`, color: 'foreign', colorClass: getForeignOwnerColorClass(t.owner_id) }
  }
  return null
}

// Battle status is its own highlight layer, drawn on top of (not instead
// of) the ownership bars above: a pulsing red bar whose opacity oscillates
// between 1 and 0.5 (Tailwind's `animate-pulse`), letting the ownership
// color underneath show through as it dims — so a player's own territory
// under attack reads as "red/mine blinking", not plain red fading to the
// bare grid border.
function getBattleHighlightInfo(t: Territory | undefined): { key: string; colorClass: string } | null {
  if (!t?.battle_locked_by) return null
  return { key: `battle:${t.battle_locked_by}`, colorClass: HIGHLIGHT_BAR_COLOR.red }
}

// Same pulsing-bar treatment as battle, but yellow, for a territory
// currently being claimed (empty-land occupation in progress) — mirrors
// getBattleHighlightInfo exactly. Mutually exclusive with battleHighlight
// in practice (a tile can't be both mid-claim and mid-battle), so sharing
// the same z-layer/animation is safe.
function getClaimHighlightInfo(t: Territory | undefined): { key: string; colorClass: string } | null {
  if (!t?.claim_locked_by) return null
  return { key: `claim:${t.claim_locked_by}`, colorClass: HIGHLIGHT_BAR_COLOR.yellow }
}

function clamp(value: number) {
  return Math.max(MAP_MIN, Math.min(MAP_MAX, value))
}

function clampVisualDragOffset(value: number, cellPx: number | null) {
  const maxVisualOffset = Math.max(1, Math.round((cellPx ?? 24) * 0.45))
  return Math.max(-maxVisualOffset, Math.min(maxVisualOffset, value))
}

function isWithinBounds(x: number, y: number) {
  return x >= MAP_MIN && x <= MAP_MAX && y >= MAP_MIN && y <= MAP_MAX
}

function getGarrisonPipCount(count: number) {
  if (count <= 0) return 0
  if (count <= 5) return 1
  if (count <= 10) return 2
  return 3
}

function getVisibleGarrisonPipStacks(tile: Territory | undefined) {
  if (!tile?.garrison_ranks) return []
  return GARRISON_PIP_RANK_ORDER.flatMap((rank) => {
    const count = tile.garrison_ranks?.[rank] ?? 0
    const pipCount = getGarrisonPipCount(count)
    return pipCount > 0 ? [{ rank, pipCount }] : []
  })
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

// Structure icons (home/castle/village) are the map's main visual read at a
// glance, so they intentionally fill most of the tile — much larger than the
// small lock/battle emoji overlays sized by `getIconFontSize` above. Sized
// directly off the measured cell (falls back to a viewSize-derived estimate
// before the ResizeObserver has measured anything, same pattern as above).
function getStructureIconSize(viewSize: number, cellPx: number | null) {
  if (cellPx && cellPx > 0) {
    return Math.max(14, Math.min(96, Math.round(cellPx * 0.82)))
  }
  return Math.max(16, Math.round(52 - viewSize * 1.1))
}

// The grid line between tiles used to be a fixed Tailwind `border` (always
// exactly 1px, full-opacity zinc-800) regardless of zoom. At the most
// zoomed-out level (49x49 tiles, tiny cells) that reads as a comparatively
// thick, distracting grid; at the most zoomed-in level (5x5, large cells)
// it's barely noticeable and fine as-is. Two bugs found and fixed here:
// 1) A first attempt scaled the border-*width* down toward 0.5px, but
//    browsers commonly snap/round sub-1px border widths back up to a full
//    device pixel, so it visually rendered identically to a plain 1px.
// 2) Each tile drew a border on ALL FOUR sides, so every internal seam
//    between two tiles was actually two overlapping/adjacent hairlines
//    (one from each tile), not one — this is what made the grid look
//    randomly 1-2px thick from spot to spot (subpixel rounding differs
//    tile to tile). Fixed by having each tile draw only its right+bottom
//    border, with a matching left+top border added once on the outer grid
//    container — every internal seam is now drawn by exactly one element.
// Color is faded via alpha (not lightened/changed hue) so it reads as the
// same black line at every zoom level, just fainter when zoomed out; alpha
// isn't snapped to device pixels the way border-width is, so this reliably
// changes what's rendered.
function getGridBorderAlpha(viewSize: number, cellPx: number | null) {
  if (cellPx && cellPx > 0) {
    return Math.max(0.35, Math.min(1, cellPx / 24))
  }
  return Math.max(0.35, Math.min(1, 1.25 - viewSize * 0.018))
}

// Garrison pip dots used to be a fixed `h-2 w-2` (8px) regardless of the
// actual rendered cell size. That looked fine on desktop, where the first
// zoom level that shows pips (viewSize <= 15) still renders fairly large
// cells, but on narrow mobile screens the same 15x15 viewport squeezes into
// a much smaller cell, so the fixed 8px dots ate up most (or all) of the
// tile — a 2x2 grid of pips barely fit and a 3rd column had no room left.
// Scaling off the measured `cellPx` (same pattern as the icon/border helpers
// above) keeps the pips a small, consistent fraction of the tile at every
// screen size. Falls back to a small fixed size before the ResizeObserver
// has measured anything.
function getGarrisonPipSize(cellPx: number | null) {
  if (cellPx && cellPx > 0) {
    return Math.max(3, Math.min(8, Math.round(cellPx * 0.16)))
  }
  return 5
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
  blinkTarget = null,
  viewSize = 15,
  currentUserId,
  allyPlayerIds,
  showGarrisonPips = true,
  toolbarContent,
  overlay,
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
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
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
    const el = frameRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const width = el.getBoundingClientRect().width
      // Floored to a whole CSS pixel (not left fractional): with `1fr`
      // grid columns, a container width that doesn't divide evenly by
      // viewSize forces the browser to give a handful of columns 1 extra
      // device pixel so the total still adds up exactly — those columns'
      // borders then render visibly thicker/doubled compared to the rest,
      // periodically, even at exactly 100% browser zoom (confirmed: only
      // showed up at specific map zoom levels, i.e. specific viewSize/
      // container-width combinations, not tied to browser zoom at all).
      // Snapping the grid to `cellPx * viewSize` whole pixels (below) and
      // sizing columns with a fixed `${cellPx}px` instead of `1fr` makes
      // every column exactly the same integer width, eliminating the
      // rounding remainder entirely — at the cost of up to viewSize-1px of
      // unused space at the right/bottom edge of the frame, invisible
      // against the page background.
      if (width > 0) setCellPx(Math.floor(width / viewSize))
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

  /** Converts a pixel drag distance to tile-space delta for onPan. */
  function pxToTileDelta(dxPx: number, dyPx: number): { tileDx: number; tileDy: number } {
    // Negative because dragging right reveals tiles to the left.
    return {
      tileDx: -Math.round(dxPx / 24),
      tileDy: -Math.round(dyPx / 24),
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    dragStart.current = { x: e.clientX, y: e.clientY }
    setDragOffset(null)
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragStart.current) return
    setDragOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (!dragStart.current) return
    const dxPx = e.clientX - dragStart.current.x
    const dyPx = e.clientY - dragStart.current.y
    dragStart.current = null
    setDragOffset(null)
    const { tileDx, tileDy } = pxToTileDelta(dxPx, dyPx)
    if (tileDx !== 0 || tileDy !== 0) {
      onPan(tileDx, tileDy)
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) return
    dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    setDragOffset(null)
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!dragStart.current || e.touches.length !== 1) return
    setDragOffset({ x: e.touches[0].clientX - dragStart.current.x, y: e.touches[0].clientY - dragStart.current.y })
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!dragStart.current) return
    const touch = e.changedTouches[0]
    const dxPx = touch.clientX - dragStart.current.x
    const dyPx = touch.clientY - dragStart.current.y
    dragStart.current = null
    setDragOffset(null)
    const { tileDx, tileDy } = pxToTileDelta(dxPx, dyPx)
    if (tileDx !== 0 || tileDy !== 0) {
      onPan(tileDx, tileDy)
    }
  }

  const iconStyle = { fontSize: getIconFontSize(viewSize, cellPx) }
  const structureIconBaseSize = getStructureIconSize(viewSize, cellPx)
  const garrisonPipSizePx = getGarrisonPipSize(cellPx)
  const gridBorderStyle = { borderColor: `rgba(0, 0, 0, ${getGridBorderAlpha(viewSize, cellPx)})` }
  const visualDragOffset = dragOffset
    ? {
        x: clampVisualDragOffset(dragOffset.x, cellPx),
        y: clampVisualDragOffset(dragOffset.y, cellPx),
      }
    : null
  const isDragging = dragStart.current !== null || dragOffset !== null

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

        {toolbarContent}
      </div>

      <div
        ref={frameRef}
        data-testid="map-frame"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`w-full ${isDragging ? 'overflow-hidden' : 'overflow-visible'}`}
      >
        <div
          className="relative inline-block max-w-full align-top"
          style={{ width: cellPx ? `${cellPx * viewSize}px` : '100%' }}
        >
          <div
            data-testid="map-grid"
            className={`grid select-none cursor-grab active:cursor-grabbing overflow-visible border-l border-t ${cellPx ? '' : 'w-full'}`}
            style={{
              gridTemplateColumns: cellPx ? `repeat(${viewSize}, ${cellPx}px)` : `repeat(${viewSize}, minmax(0, 1fr))`,
              width: cellPx ? `${cellPx * viewSize}px` : undefined,
              transform: visualDragOffset ? `translate(${visualDragOffset.x}px,${visualDragOffset.y}px)` : undefined,
              transition: visualDragOffset ? 'none' : 'transform 0.1s ease-out',
              ...gridBorderStyle,
            }}
          >
            {Array.from({ length: viewSize }).map((_, row) =>
              Array.from({ length: viewSize }).map((_, col) => {
            const x = x1 + col
            const y = y1 + row
            const isVoid = !isWithinBounds(x, y)
            const tile = byCoord.get(`${x},${y}`)
            const terrainVariants = tile ? DIFFICULTY_TERRAIN_VARIANTS[tile.difficulty] : null
            const terrainClass = tile && terrainVariants
              ? terrainVariants[hashCoordToIndex(x, y, terrainVariants.length)]
              : 'bg-zinc-900'
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
            const battleHighlight = getBattleHighlightInfo(tile)
            const claimHighlight = getClaimHighlightInfo(tile)
            const garrisonPipStacks = showGarrisonPips && viewSize <= 15 ? getVisibleGarrisonPipStacks(tile) : []
            const isBlinkTarget = blinkTarget?.x === x && blinkTarget?.y === y

            const matchingHighlight = (neighbor?: Territory) => {
              if (!tileHighlight) return false
              const neighborHighlight = getHighlightInfo(neighbor, currentUserId)
              return neighborHighlight?.key === tileHighlight.key
            }

            const matchingBattleHighlight = (neighbor?: Territory) => {
              if (!battleHighlight) return false
              const neighborBattleHighlight = getBattleHighlightInfo(neighbor)
              return neighborBattleHighlight?.key === battleHighlight.key
            }

            const matchingClaimHighlight = (neighbor?: Territory) => {
              if (!claimHighlight) return false
              const neighborClaimHighlight = getClaimHighlightInfo(neighbor)
              return neighborClaimHighlight?.key === claimHighlight.key
            }

            const perimeterEdges = tileHighlight
              ? (['top', 'right', 'bottom', 'left'] as const).filter(
                  (edge) => !matchingHighlight(neighbors[edge])
                )
              : []

            const battlePerimeterEdges = battleHighlight
              ? (['top', 'right', 'bottom', 'left'] as const).filter(
                  (edge) => !matchingBattleHighlight(neighbors[edge])
                )
              : []

            const claimPerimeterEdges = claimHighlight
              ? (['top', 'right', 'bottom', 'left'] as const).filter(
                  (edge) => !matchingClaimHighlight(neighbors[edge])
                )
              : []

            // Castle/village share one compact row instead of stacking
            // vertically — with a home marker too, three full-size icons
            // stacked in one small tile used to overflow it. Shown side by
            // side and shrunk when there's more than one, this reads as a
            // single "these structures are here" unit sized to fit the tile.
            const structureIcons: Array<{ key: string; node: ReactNode }> = []
            const structureCount = [
              tile?.is_home,
              tile?.castle_rank,
              tile?.village_rank,
              tile?.wall_rank,
            ].filter(Boolean).length
            const structureIconSize =
              structureCount > 1
                ? Math.max(12, Math.round(structureIconBaseSize * 0.72))
                : structureIconBaseSize
            const structureIconStyle = {
              width: `${structureIconSize}px`,
              height: `${structureIconSize}px`,
            }
            if (tile?.is_home) {
              structureIcons.push({
                key: 'home',
                node: (
                  <HomeIcon
                    title="Domov"
                    className="text-amber-200 drop-shadow"
                    style={structureIconStyle}
                  />
                ),
              })
            }
            if (tile?.castle_rank) {
              structureIcons.push({
                key: 'castle',
                node: (
                  <CastleIcon
                    variant={pickVariant(String(tile.id), CASTLE_VARIANTS)}
                    title="Hrad"
                    className="text-stone-200 drop-shadow"
                    style={structureIconStyle}
                  />
                ),
              })
            }
            if (tile?.village_rank) {
              structureIcons.push({
                key: 'village',
                node: (
                  <VillageIcon
                    variant={pickVariant(`${tile.id}-village`, VILLAGE_VARIANTS)}
                    title="Vesnice"
                    className="text-stone-300 drop-shadow"
                    style={structureIconStyle}
                  />
                ),
              })
            }
            if (tile?.wall_rank) {
              structureIcons.push({
                key: 'wall',
                node: (
                  <WallIcon
                    title="Hradby"
                    className="text-stone-300 drop-shadow"
                    style={structureIconStyle}
                  />
                ),
              })
            }

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
                style={gridBorderStyle}
                className={`relative terrain-tile aspect-square min-w-0 min-h-0 border-r border-b flex flex-col items-center justify-center gap-0.5 overflow-visible ${terrainClass}`}
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
                {battleHighlight &&
                  battlePerimeterEdges.map((edge) => (
                    <span
                      key={`battle-${edge}`}
                      aria-hidden="true"
                      data-testid={`highlight-battle-${edge}-${x},${y}`}
                      className={`pointer-events-none absolute z-20 animate-battle-blink ${HIGHLIGHT_BAR_POSITION[edge]} ${battleHighlight.colorClass}`}
                    />
                  ))}
                {claimHighlight &&
                  claimPerimeterEdges.map((edge) => (
                    <span
                      key={`claim-${edge}`}
                      aria-hidden="true"
                      data-testid={`highlight-claim-${edge}-${x},${y}`}
                      className={`pointer-events-none absolute z-20 animate-battle-blink ${HIGHLIGHT_BAR_POSITION[edge]} ${claimHighlight.colorClass}`}
                    />
                  ))}
                {isBlinkTarget && blinkTarget && (
                  <span
                    key={`blink-${blinkTarget.nonce}`}
                    aria-hidden="true"
                    data-testid={`blink-${x},${y}`}
                    className="pointer-events-none absolute inset-0 z-20 bg-amber-400/60 animate-map-jump-blink"
                  />
                )}
                {structureIcons.length > 0 && (
                  <div
                    className={`relative z-10 flex flex-row items-center justify-center gap-0.5 ${
                      isUnderAttack ? 'opacity-40' : ''
                    }`}
                  >
                    {structureIcons.map((s) => (
                      <span key={s.key} className="leading-none">
                        {s.node}
                      </span>
                    ))}
                  </div>
                )}
                {garrisonPipStacks.length > 0 && (
                  <div
                    data-testid={`garrison-pips-${x},${y}`}
                    className="pointer-events-none absolute bottom-0.5 left-0.5 z-10 flex items-end gap-0.5 opacity-90"
                  >
                    {garrisonPipStacks.map(({ rank, pipCount }) => (
                      <div
                        key={rank}
                        data-testid={`garrison-pip-${rank}-${x},${y}`}
                        className="flex flex-col-reverse items-center"
                      >
                        {Array.from({ length: pipCount }).map((_, index) => (
                          <span
                            key={`${rank}-${index}`}
                            data-testid={`garrison-pip-dot-${rank}-${index}-${x},${y}`}
                            className={`block shrink-0 rounded-full border border-black/30 ${RANK_FRAME[rank].badgeBg}`}
                            style={{ width: garrisonPipSizePx, height: garrisonPipSizePx }}
                          />
                        ))}
                      </div>
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
                {tile?.owner_id && tile.owner_is_npc && !isOwnedByMe && (
                  <span
                    data-testid={`npc-badge-${x},${y}`}
                    title="NPC říše"
                    className="pointer-events-none absolute right-0.5 top-0.5 z-20 rounded bg-fuchsia-500/90 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white"
                  >
                    NPC
                  </span>
                )}
                {isHovered && (
                  <div className="pointer-events-none absolute left-1/2 top-0 z-30 w-40 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-left text-xs text-zinc-100 shadow-lg">
                    <p className="font-semibold">
                      ({x}, {y})
                    </p>
                    {tile ? (
                      <>
                        {tile.name && <p className="font-semibold text-zinc-50">{tile.name}</p>}
                        <p>{getOwnerLabel(tile, currentUserId)}</p>
                        {tile.owner_id && !tile.owner_is_npc && allyPlayerIds?.has(tile.owner_id) && (
                          <p className="text-emerald-400">🤝 Spojenec</p>
                        )}
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
            {overlay && (
              <div
                className="pointer-events-none absolute inset-0 overflow-visible"
                style={{
                  transform: visualDragOffset ? `translate(${visualDragOffset.x}px,${visualDragOffset.y}px)` : undefined,
                  transition: visualDragOffset ? 'none' : 'transform 0.1s ease-out',
                }}
              >
                {overlay}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
