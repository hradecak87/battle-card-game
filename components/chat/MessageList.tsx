'use client'

import Link from 'next/link'
import type { ChatListedMessage } from '@/lib/chat/types'

export interface MessageListProps {
  messages: ChatListedMessage[]
  currentPlayerId?: string | null
  emptyText?: string
}

export function MessageList({
  messages,
  currentPlayerId = null,
  emptyText = 'Zatím žádné zprávy.',
}: MessageListProps) {
  const orderedMessages = [...messages].sort((a, b) => a.id - b.id)

  if (orderedMessages.length === 0) {
    return <p className="text-sm text-zinc-400">{emptyText}</p>
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="message-list">
      {orderedMessages.map((message) => {
        const isOwn = currentPlayerId !== null && message.sender_id === currentPlayerId
        const body = message.deleted_at && isOwn ? 'Zpráva byla odstraněna.' : message.body

        return (
          <li
            key={message.id}
            data-testid={`chat-message-${message.id}`}
            className={`rounded-lg border px-3 py-2 ${
              isOwn
                ? 'self-end border-amber-700 bg-amber-950/40 text-amber-100'
                : 'border-zinc-800 bg-zinc-900/70 text-zinc-100'
            } max-w-[min(100%,36rem)]`}
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-zinc-400">
              <Link href={`/profile/${message.sender_id}`} className="font-semibold underline hover:text-zinc-200">
                {message.sender_display_name}
              </Link>
              <span>{new Date(message.created_at).toLocaleString('cs-CZ')}</span>
            </div>
            <p className={`${message.deleted_at ? 'italic text-zinc-400' : ''} whitespace-pre-wrap break-words`}>
              {body}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
