import type { NotificationRow } from './types'

// Keep public/sw.js in sync with this switch: the service worker cannot import TS modules.
function hasMapCoordinates(payload: unknown): payload is { x: number; y: number } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { x?: unknown }).x === 'number' &&
    typeof (payload as { y?: unknown }).y === 'number'
  )
}

function hasTerritoryCoordinates(payload: unknown): payload is { territory_x: number; territory_y: number } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { territory_x?: unknown }).territory_x === 'number' &&
    typeof (payload as { territory_y?: unknown }).territory_y === 'number'
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
    case 'attack_cancelled':
      return hasTerritoryCoordinates(notification.payload)
        ? `/map?x=${notification.payload.territory_x}&y=${notification.payload.territory_y}`
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
