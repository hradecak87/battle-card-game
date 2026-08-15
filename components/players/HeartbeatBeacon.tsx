'use client'

import { useEffect } from 'react'
import { useSession } from '@/lib/supabase/useSession'
import { supabase } from '@/lib/supabase/client'

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Keeps `players.last_seen_at` fresh for the currently logged-in user so
 * the online/offline badge (spec §2) stays accurate. Renders nothing;
 * mounted once in the root layout.
 */
export function HeartbeatBeacon() {
  const { user } = useSession()

  useEffect(() => {
    if (!user) return
    supabase.rpc('heartbeat')
    const interval = setInterval(() => {
      supabase.rpc('heartbeat')
    }, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [user])

  return null
}
