import type { Rank, RawStats, UnitType } from '@/lib/cards/types'

export type DiplomacyRelationState = 'war' | 'peace'
export type PeaceOfferKind = 'white_peace' | 'tribute_peace'
export type PeaceOfferStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired'

export interface DiplomacyWarRow {
  other_player_id: string
  other_player_display_name: string
  other_kingdom_name: string | null
  other_home_x: number | null
  other_home_y: number | null
  war_started_at: string
}

export interface DiplomacyOfferedCard {
  instance_id: string
  template_id: string
  owner_id: string | null
  stationed_territory_id: number | null
  status: 'stationed' | 'in_transit' | 'deposit'
  template_name: string
  template_rank: Rank
  template_unit_type: UnitType | null
  template_flavor_text: string
  template_base_stats: RawStats | null
  template_total_supply: number | null
}

export interface DiplomacyOfferRow {
  id: string
  initiator_id: string
  initiator_display_name: string
  target_id: string
  target_display_name: string
  kind: PeaceOfferKind
  offered_card_ids: string[]
  offered_territory_id: number | null
  offered_territory_name: string | null
  offered_territory_x: number | null
  offered_territory_y: number | null
  status: PeaceOfferStatus
  created_at: string
  expires_at: string
  resolved_at: string | null
  offered_cards: DiplomacyOfferedCard[]
}

export interface ProposePeaceInput {
  targetPlayerId: string
  kind: PeaceOfferKind
  offeredCardIds?: string[]
  offeredTerritoryId?: number | null
}
