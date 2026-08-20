'use client'

import Link from 'next/link'
import type { NotificationRow } from '@/lib/notifications/types'
import { NotificationList } from './NotificationList'

type NotificationPanelProps = {
  notifications: NotificationRow[]
  refresh: () => Promise<void> | void
  onClose?: () => void
}

export function NotificationPanel({ notifications, refresh, onClose }: NotificationPanelProps) {
  return (
    <div
      data-testid="notification-panel"
      className="fixed inset-0 z-[60] flex flex-col bg-zinc-950 p-4 md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:max-h-[70vh] md:w-[26rem] md:rounded-2xl md:border md:border-zinc-800 md:bg-zinc-950/95 md:shadow-2xl md:shadow-black/40"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-100">Oznámení</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-zinc-700 px-3 py-1 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
        >
          Zavřít
        </button>
      </div>

      <NotificationList
        notifications={notifications}
        emptyText="Zatím nemáš žádná oznámení."
        onRefresh={refresh}
        onAfterItemClick={onClose}
        showMarkAll
      />

      <Link
        href="/notifications"
        onClick={onClose}
        className="mt-4 text-sm font-medium text-amber-300 transition hover:text-amber-200"
      >
        Zobrazit celou historii
      </Link>
    </div>
  )
}
