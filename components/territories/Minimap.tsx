'use client'

import { MinimapTile } from '@/lib/territories/api'

export interface MinimapProps {
  tiles: MinimapTile[]
  myPlayerId?: string | null
  onRecenter: (x: number, y: number) => void
}

const MAP_SIZE = 256

function dotColor(tile: MinimapTile, myPlayerId?: string | null): string {
  if (tile.claim_locked_by) return 'bg-yellow-400 animate-pulse'
  if (tile.owner_id && tile.owner_id === myPlayerId) return 'bg-blue-400'
  if (tile.owner_id) return 'bg-red-400'
  if (tile.castle_rank || tile.village_rank) return 'bg-zinc-400'
  return 'bg-transparent'
}

/**
 * Small whole-map overview grid (design spec §10) rendered from
 * `getMinimapOverview`'s sparse result set — only "interesting" tiles are
 * ever passed in, everything else renders as empty background. Clicking a
 * dot (or its background cell) recenters the parent viewport.
 */
export default function Minimap({ tiles, myPlayerId, onRecenter }: MinimapProps) {
  const byCoord = new Map<string, MinimapTile>()
  for (const t of tiles) {
    byCoord.set(`${t.x},${t.y}`, t)
  }

  return (
    <div
      data-testid="minimap"
      className="relative aspect-square w-full max-w-xs bg-zinc-950 border border-zinc-800"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${MAP_SIZE}, 1fr)`,
        gridTemplateRows: `repeat(${MAP_SIZE}, 1fr)`,
      }}
    >
      {tiles.map((tile) => (
        <button
          key={`${tile.x},${tile.y}`}
          type="button"
          aria-label={`Přejít na (${tile.x}, ${tile.y})`}
          onClick={() => onRecenter(tile.x, tile.y)}
          className={`${dotColor(tile, myPlayerId)}`}
          style={{ gridColumn: tile.x + 1, gridRow: tile.y + 1 }}
        />
      ))}
    </div>
  )
}
