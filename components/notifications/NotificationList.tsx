'use client'

import { useRouter } from 'next/navigation'
import { getDeepLink } from '@/lib/notifications/deepLink'
import { markAllRead, markRead } from '@/lib/notifications/api'
import type { NotificationRow } from '@/lib/notifications/types'
import { notificationLabel } from './notificationLabel'

function formatTimestamp(createdAt: string) {
  return new Date(createdAt).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function notificationDetail(notification: NotificationRow) {
  switch (notification.type) {
    case 'attack_incoming':
    case 'territory_lost':
    case 'war_declared':
    case 'trade_offer_received':
    case 'trade_offer_accepted':
    case 'trade_offer_rejected':
    case 'peace_offer_received':
    case 'dm_message':
      return notification.payload.other_display_name
    case 'attack_cancelled':
      return notification.payload.attacker_display_name
    case 'battle_resolved':
      return notification.payload.outcome === 'won' ? 'Vyhrál/a jsi bitvu.' : 'Prohrál/a jsi bitvu.'
    case 'level_up':
      return `Nová úroveň: ${notification.payload.new_level}`
    default:
      return ''
  }
}

type NotificationListProps = {
  notifications: NotificationRow[]
  emptyText: string
  onRefresh?: () => Promise<void> | void
  onAfterItemClick?: () => void
  showMarkAll?: boolean
}

export function NotificationList({
  notifications,
  emptyText,
  onRefresh,
  onAfterItemClick,
  showMarkAll = false,
}: NotificationListProps) {
  const router = useRouter()

  async function handleNotificationClick(notification: NotificationRow) {
    const { error } = await markRead(notification.id)
    if (error) return
    await onRefresh?.()
    router.push(getDeepLink(notification))
    onAfterItemClick?.()
  }

  async function handleMarkAllRead() {
    const { error } = await markAllRead()
    if (error) return
    await onRefresh?.()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showMarkAll && (
        <div className="mb-3 flex items-center justify-end">
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            className="text-xs font-medium text-amber-300 transition hover:text-amber-200"
          >
            Označit vše jako přečtené
          </button>
        </div>
      )}

      {notifications.length === 0 ? (
        <p className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">{emptyText}</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {notifications.map((notification) => {
            const detail = notificationDetail(notification)

            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => void handleNotificationClick(notification)}
                  className={`w-full rounded-2xl border p-3 text-left transition hover:border-amber-700 hover:bg-zinc-900 ${notification.is_read ? 'border-zinc-800 bg-zinc-900/40 text-zinc-400' : 'border-amber-900/70 bg-zinc-900/80 text-zinc-100'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{notificationLabel(notification)}</p>
                      {detail ? <p className="mt-1 text-sm text-zinc-400">{detail}</p> : null}
                      <p className="mt-2 text-xs text-zinc-500">{formatTimestamp(notification.created_at)}</p>
                    </div>
                    {!notification.is_read ? (
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                    ) : null}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
