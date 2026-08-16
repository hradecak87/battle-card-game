'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'

/**
 * Map-side realtime subscription (Task 15): watches `battle_locked_by`
 * transitions on `territories` for the currently-visible viewport, so
 * the "under attack" indicator appears/disappears live as battles are
 * declared/resolved without requiring the user to pan/zoom to trigger a
 * refetch. Separate hook from `useBattleChannel` since its scope is many
 * territories at once, not one battle.
 *
 * `territoryIds` should be the ids currently on screen (the map page
 * already fetches these via `getViewport`); `onChange` is expected to
 * re-run `getViewport` and update state, same refetch-driven pattern as
 * `useBattleChannel`.
 */
export function useTerritoryBattleChannel(territoryIds: number[], onChange: () => void) {
  const filterKey = territoryIds.slice().sort((a, b) => a - b).join(',')

  useEffect(() => {
    if (territoryIds.length === 0) return

    const channel = supabase
      .channel(`territory-battles-${filterKey}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'territories',
          filter: `id=in.(${filterKey})`,
        },
        onChange
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])
}
