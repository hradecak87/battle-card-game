'use client'

import { useEffect, useMemo, useState } from 'react'
import MovementDetailModal from '@/components/territories/MovementDetailModal'
import { formatEta } from '@/lib/time/formatEta'
import { type MapMovementArrow, useMapMovementArrows } from '@/lib/territories/useMapMovementArrows'

export type { MapMovementArrow } from '@/lib/territories/useMapMovementArrows'

const COLOR_BY_CATEGORY = {
  transfer: '#f59e0b',
  offensive: '#ef4444',
  incoming: '#d946ef',
  'ally-transfer': '#22c55e',
  'ally-offensive': '#14b8a6',
  'ally-incoming': '#3b82f6',
} as const

type ClippedArrow = {
  startX: number
  startY: number
  endX: number
  endY: number
  clipStartT: number
  clipEndT: number
}

export interface MapMovementArrowsProps {
  centerX: number
  centerY: number
  viewSize: number
  visible?: boolean
  myPlayerId?: string | null
  refreshKey?: number
  arrows?: MapMovementArrow[]
  onNavigateToTerritory?: (x: number, y: number) => void
  onSelectArrow?: (arrow: MapMovementArrow) => void
}

function clipLineToRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  min: number,
  max: number
): ClippedArrow | null {
  const dx = endX - startX
  const dy = endY - startY
  let t0 = 0
  let t1 = 1

  const checks: Array<[number, number]> = [
    [-dx, startX - min],
    [dx, max - startX],
    [-dy, startY - min],
    [dy, max - startY],
  ]

  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }

  return {
    startX: startX + dx * t0,
    startY: startY + dy * t0,
    endX: startX + dx * t1,
    endY: startY + dy * t1,
    clipStartT: t0,
    clipEndT: t1,
  }
}

function describeArrow(arrow: MapMovementArrow) {
  if (arrow.category === 'incoming' || arrow.category === 'ally-incoming') {
    return `Příchozí útok na ${arrow.destinationName ?? `${arrow.destX}, ${arrow.destY}`}`
  }
  return `${arrow.movementKind === 'transfer' ? 'Přesun' : 'Útok'} ${arrow.originName ?? `${arrow.originX}, ${arrow.originY}`} → ${arrow.destinationName ?? `${arrow.destX}, ${arrow.destY}`}`
}

function arrowKindLabel(arrow: MapMovementArrow) {
  if (arrow.category === 'incoming') return 'Příchozí útok'
  if (arrow.category === 'ally-incoming') return 'Příchozí útok na spojence'
  return arrow.movementKind === 'transfer' ? 'Přesun' : 'Útok'
}

function arrowOriginLabel(arrow: MapMovementArrow) {
  return arrow.originName ?? `(${arrow.originX}, ${arrow.originY})`
}

function arrowDestinationLabel(arrow: MapMovementArrow) {
  return arrow.destinationName ?? `(${arrow.destX}, ${arrow.destY})`
}

function allyIdentityLabel(arrow: MapMovementArrow) {
  if (!('allyPlayerId' in arrow)) return null
  const name = arrow.allyIsNpc ? 'NPC spojenec' : arrow.allyDisplayName ?? 'Neznámý spojenec'
  return arrow.allyKingdomName ? `Spojenec: ${name} (${arrow.allyKingdomName})` : `Spojenec: ${name}`
}

export default function MapMovementArrows({
  centerX,
  centerY,
  viewSize,
  visible = true,
  myPlayerId = null,
  refreshKey = 0,
  arrows: arrowsOverride,
  onNavigateToTerritory = () => {},
  onSelectArrow,
}: MapMovementArrowsProps) {
  const { arrows: loadedArrows } = useMapMovementArrows({
    myPlayerId,
    refreshKey,
    enabled: visible && arrowsOverride === undefined,
  })
  const arrows = arrowsOverride ?? loadedArrows
  const [selectedArrow, setSelectedArrow] = useState<MapMovementArrow | null>(null)
  const [focusedArrowId, setFocusedArrowId] = useState<string | null>(null)
  const [hoveredArrowId, setHoveredArrowId] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!visible) {
      setSelectedArrow(null)
      setHoveredArrowId(null)
      return
    }
    const interval = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(interval)
  }, [visible])

  const half = Math.floor(viewSize / 2)
  const x1 = centerX - half
  const y1 = centerY - half
  const x2 = x1 + viewSize - 1
  const y2 = y1 + viewSize - 1

  const renderableArrows = useMemo(() => {
    return arrows
      .map((arrow) => {
        const localStartX = arrow.originX - x1 + 0.5
        const localStartY = arrow.originY - y1 + 0.5
        const localEndX = arrow.destX - x1 + 0.5
        const localEndY = arrow.destY - y1 + 0.5
        const clipped = clipLineToRect(localStartX, localStartY, localEndX, localEndY, 0, viewSize)
        if (!clipped) return null
        return { arrow, clipped }
      })
      .filter((entry): entry is { arrow: MapMovementArrow; clipped: ClippedArrow } => entry !== null)
  }, [arrows, viewSize, x1, x2, y1, y2])

  if (!visible) return null

  const hoveredEntry = hoveredArrowId
    ? renderableArrows.find((entry) => entry.arrow.id === hoveredArrowId)
    : undefined

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        <svg viewBox={`0 0 ${viewSize} ${viewSize}`} className="h-full w-full overflow-visible">
          {renderableArrows.map(({ arrow, clipped }) => {
            const color = COLOR_BY_CATEGORY[arrow.category]
            const dx = clipped.endX - clipped.startX
            const dy = clipped.endY - clipped.startY
            const length = Math.hypot(dx, dy)
            if (length === 0) return null

            const progress =
              (nowMs - new Date(arrow.startedAt).getTime()) /
              Math.max(1, new Date(arrow.arrivesAt).getTime() - new Date(arrow.startedAt).getTime())
            const clampedProgress = Math.max(clipped.clipStartT, Math.min(clipped.clipEndT, progress))
            const fullStartX = arrow.originX - x1 + 0.5
            const fullStartY = arrow.originY - y1 + 0.5
            const fullDx = arrow.destX - arrow.originX
            const fullDy = arrow.destY - arrow.originY
            const dotX = fullStartX + fullDx * clampedProgress
            const dotY = fullStartY + fullDy * clampedProgress

            const ux = dx / length
            const uy = dy / length
            const arrowLength = 0.32
            const arrowWidth = 0.16
            const arrowBaseX = clipped.endX - ux * arrowLength
            const arrowBaseY = clipped.endY - uy * arrowLength
            const leftX = arrowBaseX + -uy * arrowWidth
            const leftY = arrowBaseY + ux * arrowWidth
            const rightX = arrowBaseX - -uy * arrowWidth
            const rightY = arrowBaseY - ux * arrowWidth

            return (
              <g
                key={arrow.id}
                role="button"
                tabIndex={0}
                aria-label={describeArrow(arrow)}
                // The browser's default focus outline follows this <g>'s
                // bounding box, which spans the whole diagonal line (often
                // most of the viewport) — that reads as a huge, oddly
                // rounded frame around the map, not a focus ring on the
                // arrow. Suppress it and use a thicker visible line instead,
                // which stays scoped to the arrow itself and keeps keyboard
                // focus visible.
                className="pointer-events-auto cursor-pointer outline-none"
                onClick={() => {
                  setSelectedArrow(arrow)
                  onSelectArrow?.(arrow)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedArrow(arrow)
                    onSelectArrow?.(arrow)
                  }
                }}
                onFocus={() => setFocusedArrowId(arrow.id)}
                onBlur={() => setFocusedArrowId((current) => (current === arrow.id ? null : current))}
                onMouseEnter={() => setHoveredArrowId(arrow.id)}
                onMouseLeave={() => setHoveredArrowId((current) => (current === arrow.id ? null : current))}
              >
                <line
                  x1={clipped.startX}
                  y1={clipped.startY}
                  x2={clipped.endX}
                  y2={clipped.endY}
                  stroke="transparent"
                  strokeWidth={0.45}
                />
                <line
                  data-testid={`movement-arrow-line-${arrow.id}`}
                  x1={clipped.startX}
                  y1={clipped.startY}
                  x2={clipped.endX}
                  y2={clipped.endY}
                  stroke={color}
                  strokeWidth={focusedArrowId === arrow.id ? 0.16 : 0.08}
                  strokeLinecap="round"
                  opacity={0.9}
                />
                <polygon
                  points={`${clipped.endX},${clipped.endY} ${leftX},${leftY} ${rightX},${rightY}`}
                  fill={color}
                  opacity={0.95}
                />
                <circle cx={dotX} cy={dotY} r={0.14} fill={color} opacity={0.95} />
              </g>
            )
          })}
        </svg>
      </div>
      {hoveredEntry && (
        <div
          className="pointer-events-none absolute z-30 w-44 -translate-x-1/2 -translate-y-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-left text-xs text-zinc-100 shadow-lg"
          style={{
            left: `${((hoveredEntry.clipped.startX + hoveredEntry.clipped.endX) / 2 / viewSize) * 100}%`,
            top: `${((hoveredEntry.clipped.startY + hoveredEntry.clipped.endY) / 2 / viewSize) * 100}%`,
            marginTop: '-6px',
          }}
        >
          <p className="font-semibold text-zinc-50">{arrowKindLabel(hoveredEntry.arrow)}</p>
          <p>
            {arrowOriginLabel(hoveredEntry.arrow)} → {arrowDestinationLabel(hoveredEntry.arrow)}
          </p>
          {allyIdentityLabel(hoveredEntry.arrow) && <p>{allyIdentityLabel(hoveredEntry.arrow)}</p>}
          <p>{formatEta(hoveredEntry.arrow.arrivesAt)}</p>
        </div>
      )}
      {selectedArrow && (
        <MovementDetailModal
          arrow={selectedArrow}
          onClose={() => setSelectedArrow(null)}
          onNavigateToTerritory={onNavigateToTerritory}
        />
      )}
    </>
  )
}
