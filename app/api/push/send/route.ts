import { timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { notificationLabel } from '@/components/notifications/notificationLabel'
import type { NotificationRow } from '@/lib/notifications/types'
import { sendPush } from '@/lib/push/sendPush'

interface NotificationWebhookPayload {
  type: 'INSERT' | 'UPDATE'
  table: 'notifications'
  record: NotificationRow
}

function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )
}

function matchesWebhookSecret(request: Request) {
  const expected = process.env.PUSH_WEBHOOK_SECRET
  const provided = request.headers.get('x-push-webhook-secret')

  if (!expected || !provided) {
    return false
  }

  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)

  if (expectedBuffer.length !== providedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, providedBuffer)
}

function isNotificationWebhookPayload(body: unknown): body is NotificationWebhookPayload {
  return (
    typeof body === 'object' &&
    body !== null &&
    ((body as { type?: unknown }).type === 'INSERT' || (body as { type?: unknown }).type === 'UPDATE') &&
    (body as { table?: unknown }).table === 'notifications' &&
    typeof (body as { record?: { player_id?: unknown; type?: unknown; payload?: unknown } }).record?.player_id ===
      'string' &&
    typeof (body as { record?: { type?: unknown } }).record?.type === 'string' &&
    typeof (body as { record?: { payload?: unknown } }).record?.payload === 'object'
  )
}

function notificationBody(notification: NotificationRow) {
  switch (notification.type) {
    case 'attack_incoming':
    case 'territory_lost':
    case 'war_declared':
    case 'trade_offer_received':
    case 'trade_offer_accepted':
    case 'trade_offer_rejected':
    case 'peace_offer_received':
    case 'dm_message':
      return notification.payload.other_display_name
    case 'attack_cancelled':
      return notification.payload.attacker_display_name
    case 'loan_arrived':
    case 'loan_returned':
    case 'loan_auto_recalled':
      return notification.payload.other_display_name
    case 'battle_resolved':
      return notification.payload.outcome === 'won' ? 'Vyhrál/a jsi bitvu.' : 'Prohrál/a jsi bitvu.'
    case 'level_up':
      return `Nová úroveň: ${notification.payload.new_level}`
    default:
      return ''
  }
}

function isExpiredSubscriptionError(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode
  return statusCode === 404 || statusCode === 410
}

export async function POST(request: Request) {
  if (!matchesWebhookSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)

  if (!isNotificationWebhookPayload(body)) {
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()
  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from('push_subscriptions')
    .select('id, player_id, endpoint, p256dh, auth, created_at')
    .eq('player_id', body.record.player_id)

  if (subscriptionsError) {
    return NextResponse.json({ error: subscriptionsError.message }, { status: 500 })
  }

  let delivered = 0

  for (const subscription of subscriptions ?? []) {
    try {
      await sendPush(subscription, {
        title: notificationLabel(body.record),
        body: notificationBody(body.record),
        type: body.record.type,
        payload: body.record.payload,
      })
      delivered += 1
    } catch (error) {
      if (isExpiredSubscriptionError(error)) {
        await supabase.from('push_subscriptions').delete().eq('id', subscription.id)
      }
    }
  }

  return NextResponse.json({ ok: true, delivered })
}
