'use client'

import { useCallback, useState } from 'react'
import { listGlobalMessages, sendMessage } from '@/lib/chat/api'
import type { ChatListedMessage } from '@/lib/chat/types'
import { MessageInput } from './MessageInput'
import { MessageList } from './MessageList'
import { useVisiblePolling } from './useVisiblePolling'

export interface GlobalChatPanelProps {
  currentPlayerId: string | null
}

export function GlobalChatPanel({ currentPlayerId }: GlobalChatPanelProps) {
  const [messages, setMessages] = useState<ChatListedMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)

  const loadMessages = useCallback(async () => {
    const { data, error: loadError } = await listGlobalMessages()
    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setMessages(data ?? [])
    setError(null)
    setLoading(false)
  }, [])

  useVisiblePolling(loadMessages, 4000, currentPlayerId !== null)

  const handleSend = useCallback(
    async (body: string) => {
      setSending(true)
      const { error: sendError } = await sendMessage({
        channelType: 'global',
        body,
      })
      setSending(false)

      if (sendError) {
        setError(sendError.message)
        return
      }

      setLastSentAt(Date.now())
      setError(null)
      await loadMessages()
    },
    [loadMessages],
  )

  if (currentPlayerId === null) {
    return <p className="text-sm text-zinc-400">Pro chat se nejdřív přihlas.</p>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="global-chat-panel">
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        {loading ? (
          <p className="text-sm text-zinc-400">Načítám globální chat…</p>
        ) : (
          <MessageList messages={messages} currentPlayerId={currentPlayerId} emptyText="Globální chat je zatím prázdný." />
        )}
      </div>
      <MessageInput
        onSend={handleSend}
        sending={sending}
        error={error}
        lastSentAt={lastSentAt}
        placeholder="Napiš do globálního chatu…"
      />
    </div>
  )
}
