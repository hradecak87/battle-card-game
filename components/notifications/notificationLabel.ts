import type { NotificationRow } from '@/lib/notifications/types'

export function notificationLabel(notification: NotificationRow): string {
  switch (notification.type) {
    case 'attack_incoming':
      return 'Útok na tvé území'
    case 'war_declared':
      return 'Vyhlášena válka'
    case 'battle_resolved':
      return 'Boj rozhodnut'
    case 'territory_lost':
      return 'Přišel jsi o území'
    case 'trade_offer_received':
      return 'Nová obchodní nabídka'
    case 'trade_offer_accepted':
      return 'Obchodní nabídka přijata'
    case 'trade_offer_rejected':
      return 'Obchodní nabídka odmítnuta'
    case 'peace_offer_received':
      return 'Nabídka míru'
    case 'level_up':
      return 'Postoupil jsi na vyšší úroveň!'
    case 'dm_message':
      return 'Nová zpráva'
    case 'attack_cancelled':
      return 'NPC útok zrušen'
    default:
      return 'Nové oznámení'
  }
}
