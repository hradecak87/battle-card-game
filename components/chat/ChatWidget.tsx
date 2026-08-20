'use client'

import { useCallback, useMemo, useState } from 'react'
import { listConversations, listDirectMessagePlayers } from '@/lib/chat/api'
import type { ChatConversationSummary, ChatPlayerOption } from '@/lib/chat/types'
import { useSession } from '@/lib/supabase/useSession'
import { ConversationList } from './ConversationList'
import { DmChatPanel } from './DmChatPanel'
import { GlobalChatPanel } from './GlobalChatPanel'
import { useVisiblePolling } from './useVisiblePolling'

type WidgetTab = 'global' | 'dm'

export function ChatWidget() {
  const { user, loading } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<WidgetTab>('global')
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([])
  const [players, setPlayers] = useState<ChatPlayerOption[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [draftRecipientId, setDraftRecipientId] = useState<string | null>(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

  const loadConversations = useCallback(async () => {
    if (!user?.id) {
      setConversations([])
      setActiveConversationId(null)
      return
    }

    const { data, error } = await listConversations()
    if (error) return

    const rows = data ?? []
    setConversations(rows)
    setActiveConversationId((current) => {
      if (current && rows.some((conversation) => conversation.conversation_id === current)) {
        return current
      }
      return rows[0]?.conversation_id ?? null
    })
  }, [user?.id])

  useVisiblePolling(loadConversations, isOpen ? 4000 : 15000, !loading)

  const loadPlayers = useCallback(async () => {
    if (!user?.id) {
      setPlayers([])
      return
    }

    const { data, error } = await listDirectMessagePlayers(user.id)
    if (error) return
    setPlayers(data ?? [])
  }, [user?.id])

  useVisiblePolling(loadPlayers, 15000, !loading && !!user?.id)

  const unreadCount = useMemo(
    () => conversations.reduce((total, conversation) => total + conversation.unread_count, 0),
    [conversations],
  )
  const selectedConversation =
    conversations.find((conversation) => conversation.conversation_id === activeConversationId) ?? null
  const draftRecipient = players.find((player) => player.id === draftRecipientId) ?? null

  if (loading) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-amber-600 bg-zinc-950/95 px-4 py-3 text-sm font-semibold text-amber-200 shadow-lg shadow-black/40"
      >
        <span>Chat</span>
        {unreadCount > 0 && (
          <span className="rounded-full bg-amber-600 px-2 py-0.5 text-xs font-bold text-white">{unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div
          data-testid="chat-widget-panel"
          className="fixed inset-0 z-50 flex flex-col bg-zinc-950 p-4 md:bottom-4 md:right-4 md:left-auto md:top-auto md:h-[38rem] md:w-[42rem] md:rounded-2xl md:border md:border-zinc-800 md:bg-zinc-950/95"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="hidden md:flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('global')}
                className={`rounded-full px-3 py-1 text-sm ${activeTab === 'global' ? 'bg-amber-700 text-white' : 'bg-zinc-800 text-zinc-300'}`}
              >
                Globální
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('dm')}
                className={`rounded-full px-3 py-1 text-sm ${activeTab === 'dm' ? 'bg-amber-700 text-white' : 'bg-zinc-800 text-zinc-300'}`}
              >
                Zprávy
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full border border-zinc-700 px-3 py-1 text-sm text-zinc-200"
            >
              Zavřít
            </button>
          </div>

          {!user ? (
            <p className="text-sm text-zinc-400">Pro chat se nejdřív přihlas.</p>
          ) : activeTab === 'global' ? (
            <GlobalChatPanel currentPlayerId={user.id} />
          ) : (
            <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
              <div className={`${mobileDetailOpen ? 'hidden md:block' : 'block'}`}>
                <label className="mb-2 block text-xs text-zinc-400">
                  Nová zpráva
                  <select
                    value={draftRecipientId ?? ''}
                    onChange={(event) => {
                      const nextId = event.target.value || null
                      setDraftRecipientId(nextId)
                      setActiveConversationId(null)
                      setMobileDetailOpen(Boolean(nextId))
                    }}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  >
                    <option value="">Vyber hráče…</option>
                    {players.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <ConversationList
                  conversations={conversations}
                  activeConversationId={activeConversationId}
                  onSelectConversation={(conversationId) => {
                    setActiveConversationId(conversationId)
                    setDraftRecipientId(null)
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
                  recipientId={selectedConversation?.other_participant_id ?? draftRecipient?.id ?? null}
                  recipientName={selectedConversation?.other_participant_display_name ?? draftRecipient?.display_name ?? null}
                  onConversationCreated={(conversationId) => {
                    setActiveConversationId(conversationId)
                    setDraftRecipientId(null)
                    void loadConversations()
                  }}
                />
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setActiveTab('global')}
              className={`rounded-full px-3 py-2 text-sm ${activeTab === 'global' ? 'bg-amber-700 text-white' : 'bg-zinc-800 text-zinc-300'}`}
            >
              Globální
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('dm')}
              className={`rounded-full px-3 py-2 text-sm ${activeTab === 'dm' ? 'bg-amber-700 text-white' : 'bg-zinc-800 text-zinc-300'}`}
            >
              Zprávy
            </button>
          </div>
        </div>
      )}
    </>
  )
}
