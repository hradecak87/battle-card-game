'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'

/**
 * Battle-screen realtime subscription (Task 15): pushes `battles` row
 * updates (status/current_round/round_deadline/winner_side transitions)
 * and new `battle_rounds` inserts for one battle, so the screen updates
 * live during the 120s per-round decision window without polling.
 * `onChange` is expected to re-run `getBattle(battleId)` and update state
 * — this hook intentionally carries no data itself, matching how the
 * rest of this project's read-then-refetch pattern works (see
 * `lib/territories/api.ts`'s callers).
 */
export function useBattleChannel(battleId: string | null, onChange: () => void) {
  useEffect(() => {
    if (!battleId) return

    const channel = supabase
      .channel(`battle-${battleId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'battles', filter: `id=eq.${battleId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'battle_rounds', filter: `battle_id=eq.${battleId}` },
        onChange
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'battle_rounds', filter: `battle_id=eq.${battleId}` },
        onChange
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId])
}
