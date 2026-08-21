import type { Rank, RawStats, UnitType } from '@/lib/cards/types'

export type DiplomacyRelationState = 'war' | 'non_aggression' | 'peace' | 'coalition'
export type PeaceOfferKind = 'white_peace' | 'tribute_peace' | 'non_aggression'
export type PeaceOfferStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired'

export interface DiplomacyWarRow {
  other_player_id: string
  other_player_display_name: string
  other_kingdom_name: string | null
  other_home_x: number | null
  other_home_y: number | null
  war_started_at: string
}

export interface NonAggressionPactRow {
  other_player_id: string
  other_player_display_name: string
  other_kingdom_name: string | null
  other_home_x: number | null
  other_home_y: number | null
  pact_started_at: string
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

export interface CoalitionMember {
  player_id: string
  display_name: string
  joined_at: string
  is_leader: boolean
  is_online: boolean
}

export interface CoalitionSummary {
  id: string
  name: string
  leader_id: string
  leader_display_name: string
  member_count: number
}

export interface CoalitionDetail {
  id: string | null
  name: string | null
  leader_id: string | null
  leader_display_name: string | null
  created_at: string | null
  members: CoalitionMember[]
}

export interface CoalitionInviteRow {
  id: string
  coalition_id: string
  coalition_name: string
  leader_id: string
  leader_display_name: string
  invited_by: string
  invited_by_display_name: string
  created_at: string
}

export interface CoalitionJoinRequestRow {
  id: string
  coalition_id: string
  player_id: string
  player_display_name: string
  created_at: string
}
