export type ChatChannelType = 'global' | 'dm'

export interface ChatSendMessageResult {
  id: number
  sender_id: string
  channel_type: ChatChannelType
  conversation_id: string | null
  recipient_id: string | null
  body: string
  created_at: string
  deleted_at: string | null
  deleted_by: string | null
}

export interface ChatListedMessage {
  id: number
  sender_id: string
  sender_display_name: string
  channel_type: ChatChannelType
  conversation_id: string | null
  recipient_id: string | null
  body: string
  created_at: string
  deleted_at: string | null
}

export interface ChatConversationSummary {
  conversation_id: string
  other_participant_id: string
  other_participant_display_name: string
  last_message_id: number
  last_message_sender_id: string
  last_message_body: string
  last_message_created_at: string
  unread_count: number
}

export interface ChatPlayerOption {
  id: string
  display_name: string
  kingdom_name: string | null
}
