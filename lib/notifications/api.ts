import { supabase } from '@/lib/supabase/client'
import type { NotificationRow } from './types'

export async function listNotifications(beforeId: number | null = null, limit = 20) {
  return supabase.rpc('list_notifications', {
    p_before_id: beforeId,
    p_limit: limit,
  }) as unknown as Promise<{
    data: NotificationRow[] | null
    error: { message: string } | null
  }>
}

export async function getUnreadCount() {
  return supabase.rpc('get_unread_notification_count') as unknown as Promise<{
    data: number | null
    error: { message: string } | null
  }>
}

export async function markRead(id: number) {
  return supabase.rpc('mark_notification_read', {
    p_id: id,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}

export async function markAllRead() {
  return supabase.rpc('mark_all_notifications_read') as unknown as Promise<{
    data: null
    error: { message: string } | null
  }>
}
