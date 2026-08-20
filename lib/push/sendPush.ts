import webpush from 'web-push'
import type { NotificationRow } from '@/lib/notifications/types'
import { getVapidConfig } from './vapid'

export interface PushSubscriptionRow {
  id: number
  player_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

export interface PushNotificationPayload {
  title: string
  body: string
  type: NotificationRow['type']
  payload: NotificationRow['payload']
}

export async function sendPush(
  subscription: PushSubscriptionRow,
  payload: PushNotificationPayload,
) {
  const { subject, publicKey, privateKey } = getVapidConfig()

  webpush.setVapidDetails(subject, publicKey, privateKey)

  return webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    },
    JSON.stringify(payload),
  )
}
