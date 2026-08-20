'use client'

import type { ChatConversationSummary } from '@/lib/chat/types'

export interface ConversationListProps {
  conversations: ChatConversationSummary[]
  activeConversationId?: string | null
  onSelectConversation: (conversationId: string) => void
}

export function ConversationList({
  conversations,
  activeConversationId = null,
  onSelectConversation,
}: ConversationListProps) {
  if (conversations.length === 0) {
    return <p className="text-sm text-zinc-400">Zatím nemáš žádné konverzace.</p>
  }

  return (
    <div
      data-testid="conversation-list"
      className="flex w-full flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
    >
      {conversations.map((conversation) => {
        const isActive = conversation.conversation_id === activeConversationId
        return (
          <button
            key={conversation.conversation_id}
            type="button"
            onClick={() => onSelectConversation(conversation.conversation_id)}
            className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
              isActive
                ? 'border-amber-600 bg-amber-950/30'
                : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-100">
                {conversation.other_participant_display_name}
              </p>
              <p className="truncate text-xs text-zinc-400">{conversation.last_message_body}</p>
            </div>
            {conversation.unread_count > 0 && (
              <span className="rounded-full bg-amber-600 px-2 py-0.5 text-xs font-semibold text-white">
                {conversation.unread_count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
