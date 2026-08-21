'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getUnreadCount, listNotifications } from './api'
import type { NotificationRow } from './types'
import { supabase } from '@/lib/supabase/client'
import { useSession } from '@/lib/supabase/useSession'
import { useVisiblePolling } from '@/components/chat/useVisiblePolling'

const NOTIFICATIONS_PAGE_SIZE = 20
// Realtime websockets can silently drop (e.g. sleeping/backgrounded tabs) without
// reconnecting, leaving the bell stuck showing stale data. Poll as a fallback so it
// self-heals, matching the pattern used elsewhere in the app (chat, MyMovementsPanel).
const NOTIFICATIONS_POLL_INTERVAL_MS = 30000

export function useNotificationsChannel() {
  const { user } = useSession()
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const refreshQueuedRef = useRef(false)
  // Always holds the latest user id, updated synchronously on every render (not in
  // an effect) so `refresh` never has to close over a stale `user` value.
  const userIdRef = useRef<string | null>(null)
  userIdRef.current = user?.id ?? null

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true
      await refreshInFlightRef.current
      return
    }

    // Mark in-flight synchronously *before* any async work starts (including
    // work that completes without ever hitting an `await`, e.g. the "no user
    // yet" branch). Previously this was set via `refreshInFlightRef.current =
    // (async () => {...})()`, but when the IIFE's body has no `await` it runs
    // to completion (including its `finally`) synchronously, *before* the
    // outer assignment of the ref ever executes - so the `finally`'s
    // `= null` got immediately clobbered back to a stale, already-settled
    // promise, and the ref was never cleared again. That permanently wedged
    // every later call into the "queued" branch, so notifications never
    // actually fetched.
    let resolveInFlight: () => void = () => undefined
    const inFlightPromise = new Promise<void>((resolve) => {
      resolveInFlight = resolve
    })
    refreshInFlightRef.current = inFlightPromise

    try {
      const userId = userIdRef.current
      if (!userId) {
        setNotifications([])
        setUnreadCount(0)
        return
      }

      const [notificationsResult, unreadCountResult] = await Promise.all([
        listNotifications(null, NOTIFICATIONS_PAGE_SIZE),
        getUnreadCount(),
      ])

      if (!notificationsResult.error) {
        setNotifications(notificationsResult.data ?? [])
      }

      if (!unreadCountResult.error) {
        setUnreadCount(unreadCountResult.data ?? 0)
      }
    } finally {
      refreshInFlightRef.current = null
      resolveInFlight()
    }

    if (refreshQueuedRef.current) {
      refreshQueuedRef.current = false
      await refresh()
    }
    // `refresh` reads userIdRef.current at call time instead of closing over `user`,
    // so it's stable across renders and never races a concurrent stale-closure retry
    // (a previous bug: a queued retry from a call made before login resolved would
    // permanently re-run with `user = null` and silently never fetch anything).
  }, [])

  // Fires once on mount, then again on each poll interval and whenever the tab
  // regains visibility, so the bell self-heals if the realtime socket drops.
  useVisiblePolling(refresh, NOTIFICATIONS_POLL_INTERVAL_MS, true)

  useEffect(() => {
    void refresh()
  }, [user?.id, refresh])

  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `player_id=eq.${user.id}`,
        },
        () => {
          void refresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `player_id=eq.${user.id}`,
        },
        () => {
          void refresh()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [refresh, user?.id])

  return {
    unreadCount,
    notifications,
    refresh,
  }
}
