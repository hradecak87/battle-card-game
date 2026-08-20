import { supabase } from '@/lib/supabase/client'
import type {
  ChatChannelType,
  ChatConversationSummary,
  ChatListedMessage,
  ChatSendMessageResult,
} from './types'
export { isValidMessageBody } from './validation'
export interface SendMessageInput {
  channelType: ChatChannelType
  recipientId?: string | null
  body: string
}

export async function sendMessage(input: SendMessageInput) {
  return supabase.rpc('chat_send_message', {
    p_channel_type: input.channelType,
    p_recipient_id: input.recipientId ?? null,
    p_body: input.body,
  }) as unknown as Promise<{
    data: ChatSendMessageResult | null
    error: { message: string } | null
  }>
}

export async function listGlobalMessages(beforeId: number | null = null, limit = 30) {
  return supabase.rpc('chat_list_global_messages', {
    p_before_id: beforeId,
    p_limit: limit,
  }) as unknown as Promise<{
    data: ChatListedMessage[] | null
    error: { message: string } | null
  }>
}

export async function listConversations() {
  return supabase.rpc('chat_list_conversations') as unknown as Promise<{
    data: ChatConversationSummary[] | null
    error: { message: string } | null
  }>
}

export async function listDmMessages(
  conversationId: string,
  beforeId: number | null = null,
  limit = 30,
) {
  return supabase.rpc('chat_list_dm_messages', {
    p_conversation_id: conversationId,
    p_before_id: beforeId,
    p_limit: limit,
  }) as unknown as Promise<{
    data: ChatListedMessage[] | null
    error: { message: string } | null
  }>
}

export async function markRead(conversationId: string) {
  return supabase.rpc('chat_mark_read', {
    p_conversation_id: conversationId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}

export async function blockPlayer(targetId: string) {
  return supabase.rpc('chat_block_player', {
    p_target_id: targetId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}

export async function unblockPlayer(targetId: string) {
  return supabase.rpc('chat_unblock_player', {
    p_target_id: targetId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}
