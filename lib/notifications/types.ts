export type NotificationType =
  | 'attack_incoming'
  | 'war_declared'
  | 'battle_resolved'
  | 'territory_lost'
  | 'trade_offer_received'
  | 'trade_offer_accepted'
  | 'trade_offer_rejected'
  | 'peace_offer_received'
  | 'level_up'
  | 'dm_message'
  | 'attack_cancelled'

export interface AttackIncomingNotificationPayload {
  territory_id: number
  x: number
  y: number
  other_player_id: string
  other_display_name: string
}

export interface WarDeclaredNotificationPayload {
  other_player_id: string
  other_display_name: string
}

export interface BattleResolvedNotificationPayload {
  territory_id: number
  x: number
  y: number
  outcome: 'won' | 'lost'
  other_player_id: string
}

export interface TerritoryLostNotificationPayload {
  territory_id: number
  x: number
  y: number
  other_player_id: string
  other_display_name: string
}

export interface TradeOfferNotificationPayload {
  offer_id: string
  other_player_id: string
  other_display_name: string
}

export interface PeaceOfferReceivedNotificationPayload {
  offer_id: string
  other_player_id: string
  other_display_name: string
}

export interface LevelUpNotificationPayload {
  new_level: number
}

export interface DmMessageNotificationPayload {
  conversation_id: string
  other_player_id: string
  other_display_name: string
}

export interface AttackCancelledNotificationPayload {
  territory_id: number
  territory_x: number
  territory_y: number
  territory_name: string | null
  attacker_display_name: string
}

export interface NotificationPayloadByType {
  attack_incoming: AttackIncomingNotificationPayload
  war_declared: WarDeclaredNotificationPayload
  battle_resolved: BattleResolvedNotificationPayload
  territory_lost: TerritoryLostNotificationPayload
  trade_offer_received: TradeOfferNotificationPayload
  trade_offer_accepted: TradeOfferNotificationPayload
  trade_offer_rejected: TradeOfferNotificationPayload
  peace_offer_received: PeaceOfferReceivedNotificationPayload
  level_up: LevelUpNotificationPayload
  dm_message: DmMessageNotificationPayload
  attack_cancelled: AttackCancelledNotificationPayload
}

interface NotificationRowBase<TType extends NotificationType> {
  id: number
  player_id: string
  type: TType
  payload: NotificationPayloadByType[TType]
  is_read: boolean
  created_at: string
}

export type NotificationRow = {
  [TType in NotificationType]: NotificationRowBase<TType>
}[NotificationType]
