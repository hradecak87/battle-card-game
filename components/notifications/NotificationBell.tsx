'use client'

import { useState } from 'react'
import { useNotificationsChannel } from '@/lib/notifications/useNotificationsChannel'
import { NotificationPanel } from './NotificationPanel'

export function NotificationBell() {
  const { unreadCount, notifications, refresh } = useNotificationsChannel()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Oznámení"
        onClick={() => setIsOpen((current) => !current)}
        className="relative inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
          <path d="M10 2a4 4 0 0 0-4 4v1.17c0 .53-.21 1.04-.59 1.41L4.7 9.3A2 2 0 0 0 6.11 12h7.78a2 2 0 0 0 1.41-3.41l-.7-.71A1.99 1.99 0 0 1 14 7.17V6a4 4 0 0 0-4-4Zm0 16a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 10 18Z" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-amber-600 px-1.5 text-[10px] font-bold leading-4 text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <NotificationPanel
          notifications={notifications}
          refresh={refresh}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}
