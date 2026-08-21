'use client'

import { useCallback, useEffect, useState } from 'react'
import { listDmMessages, markRead, sendMessage } from '@/lib/chat/api'
import type { ChatListedMessage } from '@/lib/chat/types'
import { MessageInput } from './MessageInput'
import { MessageList } from './MessageList'
import { useStickToBottom } from './useStickToBottom'
import { useVisiblePolling } from './useVisiblePolling'

export interface DmChatPanelProps {
  currentPlayerId: string | null
  conversationId: string | null
  recipientId: string | null
  recipientName?: string | null
  onConversationCreated?: (conversationId: string) => void
}

export function DmChatPanel({
  currentPlayerId,
  conversationId,
  recipientId,
  recipientName = null,
  onConversationCreated,
}: DmChatPanelProps) {
  const [messages, setMessages] = useState<ChatListedMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const { containerRef, handleScroll, resetStickToBottom } = useStickToBottom(messages)

  const loadMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([])
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error: loadError } = await listDmMessages(conversationId)
    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setMessages(data ?? [])
    setError(null)
    setLoading(false)
    await markRead(conversationId)
  }, [conversationId])

  useEffect(() => {
    setMessages([])
    setError(null)
    setLoading(Boolean(conversationId))
    resetStickToBottom()
  }, [conversationId, resetStickToBottom])

  useVisiblePolling(loadMessages, 4000, currentPlayerId !== null && conversationId !== null)

  const handleSend = useCallback(
    async (body: string) => {
      if (!recipientId) return

      setSending(true)
      const { data, error: sendError } = await sendMessage({
        channelType: 'dm',
        recipientId,
        body,
      })
      setSending(false)

      if (sendError) {
        setError(sendError.message)
        return
      }

      if (data?.conversation_id && onConversationCreated) {
        onConversationCreated(data.conversation_id)
      }

      setLastSentAt(Date.now())
      setError(null)
      await loadMessages()
    },
    [loadMessages, onConversationCreated, recipientId],
  )

  if (currentPlayerId === null) {
    return <p className="text-sm text-zinc-400">Pro zprávy se nejdřív přihlas.</p>
  }

  if (!conversationId && !recipientId) {
    return <p className="text-sm text-zinc-400">Vyber konverzaci.</p>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="dm-chat-panel">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
      >
        {recipientName && <p className="mb-3 text-sm font-semibold text-zinc-200">{recipientName}</p>}
        {loading ? (
          <p className="text-sm text-zinc-400">Načítám konverzaci…</p>
        ) : (
          <MessageList messages={messages} currentPlayerId={currentPlayerId} emptyText="Zatím tu nejsou žádné zprávy." />
        )}
      </div>
      <MessageInput
        onSend={handleSend}
        sending={sending}
        error={error}
        lastSentAt={lastSentAt}
        disabled={!recipientId}
        placeholder="Napiš soukromou zprávu…"
      />
    </div>
  )
}
