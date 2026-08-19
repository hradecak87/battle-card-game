'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './client'
import type { NationId } from '@/lib/players/nations'

export interface PlayerRow {
  id: string
  display_name: string
  nation: NationId
  kingdom_name: string | null
  coat_of_arms_id: string | null
  onboarding_completed: boolean
  is_npc?: boolean
  npc_next_action_at?: string | null
  xp: number
  king_relocation_used_at: string | null
  daily_reward_streak: number
  last_daily_reward_at: string | null
  created_at: string
  last_seen_at: string
  total_playtime_seconds: number
}

export interface SessionState {
  user: User | null
  player: PlayerRow | null
  loading: boolean
}

/**
 * Tracks the current Supabase auth user and their matching `players` row.
 * `loading` is true until the initial session + (if any) player row fetch
 * both resolve. Used by every page that needs to know "who is logged in
 * and what's their onboarding/profile state" (spec §7).
 */
export function useSession(): SessionState {
  const [user, setUser] = useState<User | null>(null)
  const [player, setPlayer] = useState<PlayerRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadPlayer(currentUser: User | null) {
      if (!currentUser) {
        if (!cancelled) setPlayer(null)
        return
      }
      const { data } = await supabase
        .from('players')
        .select('*')
        .eq('id', currentUser.id)
        .single()
      if (!cancelled) setPlayer((data as PlayerRow) ?? null)
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setUser(data.session?.user ?? null)
      loadPlayer(data.session?.user ?? null).finally(() => {
        if (!cancelled) setLoading(false)
      })
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      loadPlayer(session?.user ?? null)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  return { user, player, loading }
}
