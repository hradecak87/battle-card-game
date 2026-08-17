'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { MyTerritory } from '@/lib/territories/api'
import { supabase } from '@/lib/supabase/client'

export interface IncomingOwnedTerritoryBattle {
  territoryId: number
  battleLockedBy: string
}

type OwnedTerritoryBattleTarget = Pick<MyTerritory, 'id' | 'battle_locked_by'>

/**
 * Player-scoped map subscription: watches all territories the current
 * player owns, regardless of viewport, so an off-screen incoming attack
 * can still surface a local alert. We intentionally track the previous
 * `battle_locked_by` state from the already-loaded owned-territories list
 * instead of relying on `payload.old`, because this codebase's existing
 * realtime hooks don't assume REPLICA IDENTITY FULL is enabled.
 */
export function useMyTerritoriesBattleChannel(
  ownedTerritories: OwnedTerritoryBattleTarget[] | null,
  onIncomingBattle: (battle: IncomingOwnedTerritoryBattle) => void
) {
  const territoryIds = useMemo(
    () => (ownedTerritories ?? []).map((territory) => territory.id).sort((a, b) => a - b),
    [ownedTerritories]
  )
  const filterKey = territoryIds.join(',')
  const knownLocksRef = useRef<Record<number, string | null>>({})

  useEffect(() => {
    knownLocksRef.current = Object.fromEntries(
      (ownedTerritories ?? []).map((territory) => [territory.id, territory.battle_locked_by ?? null])
    )
  }, [ownedTerritories])

  useEffect(() => {
    if (territoryIds.length === 0) return

    const channel = supabase
      .channel(`my-territory-battles-${filterKey}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'territories',
          filter: `id=in.(${filterKey})`,
        },
        (payload) => {
          const nextRow = payload.new as { id?: number; battle_locked_by?: string | null } | undefined
          if (typeof nextRow?.id !== 'number') return

          const territoryId = nextRow.id
          const previousLockedBy = knownLocksRef.current[territoryId] ?? null
          const nextLockedBy = nextRow.battle_locked_by ?? null

          knownLocksRef.current[territoryId] = nextLockedBy

          if (!previousLockedBy && nextLockedBy) {
            onIncomingBattle({
              territoryId,
              battleLockedBy: nextLockedBy,
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [filterKey, onIncomingBattle, territoryIds.length])
}
