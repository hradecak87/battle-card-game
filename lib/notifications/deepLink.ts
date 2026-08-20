import type { NotificationRow } from './types'

function hasMapCoordinates(payload: unknown): payload is { x: number; y: number } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { x?: unknown }).x === 'number' &&
    typeof (payload as { y?: unknown }).y === 'number'
  )
}

export function getDeepLink(notification: NotificationRow): string {
  switch (notification.type) {
    case 'attack_incoming':
    case 'battle_resolved':
    case 'territory_lost':
      return hasMapCoordinates(notification.payload)
        ? `/map?x=${notification.payload.x}&y=${notification.payload.y}`
        : '/notifications'
    case 'war_declared':
    case 'peace_offer_received':
      return '/diplomacy'
    case 'trade_offer_received':
    case 'trade_offer_accepted':
    case 'trade_offer_rejected':
      return '/exchange'
    case 'level_up':
      return '/profile/me'
    case 'dm_message':
      return '/chat'
    default:
      return '/notifications'
  }
}
