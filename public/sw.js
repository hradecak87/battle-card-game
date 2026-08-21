// Source of truth for deep-link routing lives in lib/notifications/deepLink.ts.
// Keep this plain-JS mirror in sync because service workers cannot import TS modules.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'Battle Card Game', {
      body: data.body || '',
      data: {
        type: data.type,
        payload: data.payload,
      },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = getDeepLinkForServiceWorker(event.notification.data)

  event.waitUntil(openOrFocus(url))
})

async function openOrFocus(url) {
  const windowClients = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })

  for (const client of windowClients) {
    if ('focus' in client) {
      client.navigate(url)
      return client.focus()
    }
  }

  return clients.openWindow(url)
}

function hasMapCoordinates(payload) {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof payload.x === 'number' &&
    typeof payload.y === 'number'
  )
}

function hasTerritoryCoordinates(payload) {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof payload.territory_x === 'number' &&
    typeof payload.territory_y === 'number'
  )
}

function getDeepLinkForServiceWorker(data) {
  if (!data) {
    return '/notifications'
  }

  switch (data.type) {
    case 'attack_incoming':
    case 'battle_resolved':
    case 'territory_lost':
      return hasMapCoordinates(data.payload)
        ? `/map?x=${data.payload.x}&y=${data.payload.y}`
        : '/notifications'
    case 'attack_cancelled':
      return hasTerritoryCoordinates(data.payload)
        ? `/map?x=${data.payload.territory_x}&y=${data.payload.territory_y}`
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
