'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Keeps `players.last_seen_at` fresh for the currently logged-in user so
 * the online/offline badge (spec §2) and the RTS battle "both online"
 * check (`mark_ready`'s 2-minute freshness window) stay accurate.
 *
 * Deliberately does NOT gate on `useSession()`'s derived React state —
 * live debugging (2026-08-17) confirmed the `heartbeat()` RPC itself
 * works fine end-to-end when actually called (verified directly against
 * the DB), yet `last_seen_at` stayed frozen for hours for two actively
 * playing accounts. The most likely culprit was this component's old
 * `if (!user) return` gate never (re-)firing after certain navigations/
 * tab-visibility changes. Firing unconditionally removes that failure
 * mode entirely: `heartbeat()` is a harmless no-op while logged out
 * (its `where id = auth.uid()` then matches zero rows).
 *
 * Also fires immediately whenever the tab becomes visible again, since
 * browsers throttle or fully suspend background-tab timers — without
 * this, a backgrounded/sleeping laptop could leave `last_seen_at` stale
 * for hours after the user actually returns to the tab.
 */
export function HeartbeatBeacon() {
  useEffect(() => {
    function ping() {
      supabase.rpc('heartbeat').then(({ error }) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.error('heartbeat RPC failed:', error.message)
        }
      })
    }

    ping()
    const interval = setInterval(ping, HEARTBEAT_INTERVAL_MS)

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        ping()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return null
}
