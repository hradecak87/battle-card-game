'use client'

import { useCallback, useMemo, useState } from 'react'
import { listConversations } from '@/lib/chat/api'
import type { ChatConversationSummary } from '@/lib/chat/types'
import { ConversationList } from '@/components/chat/ConversationList'
import { DmChatPanel } from '@/components/chat/DmChatPanel'
import { GlobalChatPanel } from '@/components/chat/GlobalChatPanel'
import { useVisiblePolling } from '@/components/chat/useVisiblePolling'
import { useSession } from '@/lib/supabase/useSession'

type ChatPageTab = 'global' | 'dm'

export default function ChatPage() {
  const { user, loading } = useSession()
  const [activeTab, setActiveTab] = useState<ChatPageTab>('global')
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadConversations = useCallback(async () => {
    if (!user?.id) {
      setConversations([])
      setActiveConversationId(null)
      return
    }

    const { data, error: loadError } = await listConversations()
    if (loadError) {
      setError(loadError.message)
      return
    }

    const rows = data ?? []
    setConversations(rows)
    setActiveConversationId((current) => {
      if (current && rows.some((conversation) => conversation.conversation_id === current)) {
        return current
      }
      return rows[0]?.conversation_id ?? null
    })
    setError(null)
  }, [user?.id])

  useVisiblePolling(loadConversations, 4000, !!user?.id)

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.conversation_id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  )

  if (loading) {
    return <main className="mx-auto max-w-6xl px-4 py-6 text-zinc-400">Načítám chat…</main>
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-6xl flex-col gap-4 px-4 py-6">
      <div
        data-testid="chat-tab-bar"
        className="flex flex-col gap-2 sm:flex-row"
      >
        <button
          type="button"
          onClick={() => setActiveTab('global')}
          className={`w-full rounded-full px-4 py-2 text-sm font-semibold sm:w-auto ${
            activeTab === 'global' ? 'bg-amber-700 text-white' : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          Globální
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('dm')}
          className={`w-full rounded-full px-4 py-2 text-sm font-semibold sm:w-auto ${
            activeTab === 'dm' ? 'bg-amber-700 text-white' : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          Zprávy
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!user ? (
        <p className="text-sm text-zinc-400">Pro chat se nejdřív přihlas.</p>
      ) : activeTab === 'global' ? (
        <GlobalChatPanel currentPlayerId={user.id} />
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className={`${mobileDetailOpen ? 'hidden md:block' : 'block'}`}>
            <ConversationList
              conversations={conversations}
              activeConversationId={activeConversationId}
              onSelectConversation={(conversationId) => {
                setActiveConversationId(conversationId)
                setMobileDetailOpen(true)
              }}
            />
          </div>
          <div className={`${mobileDetailOpen ? 'block' : 'hidden md:block'} min-h-0`}>
            <div className="mb-2 md:hidden">
              <button
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                className="rounded-full border border-zinc-700 px-3 py-1 text-sm text-zinc-300"
              >
                ← Zpět
              </button>
            </div>
            <DmChatPanel
              currentPlayerId={user.id}
              conversationId={selectedConversation?.conversation_id ?? null}
              recipientId={selectedConversation?.other_participant_id ?? null}
              recipientName={selectedConversation?.other_participant_display_name ?? null}
              onConversationCreated={(conversationId) => {
                setActiveConversationId(conversationId)
                void loadConversations()
              }}
            />
          </div>
        </div>
      )}
    </main>
  )
}
