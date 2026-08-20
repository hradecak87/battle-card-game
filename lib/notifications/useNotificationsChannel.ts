'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getUnreadCount, listNotifications } from './api'
import type { NotificationRow } from './types'
import { supabase } from '@/lib/supabase/client'
import { useSession } from '@/lib/supabase/useSession'

const NOTIFICATIONS_PAGE_SIZE = 20

export function useNotificationsChannel() {
  const { user } = useSession()
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const refreshQueuedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true
      await refreshInFlightRef.current
      return
    }

    const refreshPromise = (async () => {
      try {
        if (!user?.id) {
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
      }
    })()

    refreshInFlightRef.current = refreshPromise

    await refreshPromise

    if (refreshQueuedRef.current) {
      refreshQueuedRef.current = false
      await refresh()
    }
  }, [user?.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
