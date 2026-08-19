import { supabase } from '@/lib/supabase/client'
import type { BoostEffectKind, BoostType, InstantEffectKind, Rank, RawStats, UnitType } from '@/lib/cards/types'

export type TradeOfferType = 'direct' | 'public'
export type TradeOfferStatus = 'pending' | 'countered' | 'accepted' | 'rejected' | 'cancelled' | 'expired'
export type TradeOfferDirection = 'create' | 'counter' | 'respond'

export interface TradeRequestedCriteria {
  rank?: Rank | null
  unit_type?: UnitType | null
}

export interface TradeSelectableCard {
  instance_id: string
  template_id: string
  owner_id: string | null
  stationed_territory_id: number | null
  status: 'stationed' | 'in_transit'
  template_category: 'unit' | 'boost'
  template_name: string
  template_rank: Rank
  template_unit_type: UnitType | null
  template_flavor_text: string
  template_base_stats: RawStats | null
  template_total_supply: number | null
  template_boost_type: BoostType | null
  template_effect_kind: BoostEffectKind | null
  template_instant_effect_kind: InstantEffectKind | null
  template_pct_str: number | null
  template_pct_lng: number | null
  template_pct_def: number | null
  template_pct_hp: number | null
}

export interface TradePlayerOption {
  id: string
  display_name: string
  kingdom_name: string | null
}

export interface TradeOffer {
  id: string
  type: TradeOfferType
  status: TradeOfferStatus
  initiator_id: string
  initiator_display_name: string
  target_player_id: string | null
  target_display_name: string | null
  parent_offer_id: string | null
  root_offer_id: string
  offered_card_ids: string[]
  requested_card_ids: string[] | null
  requested_criteria: TradeRequestedCriteria | null
  message: string | null
  created_at: string
  expires_at: string
  resolved_at: string | null
  offered_cards: TradeSelectableCard[]
  requested_cards: TradeSelectableCard[]
}

export interface CreateTradeOfferInput {
  type: TradeOfferType
  targetPlayerId?: string | null
  offeredCardIds: string[]
  requestedCardIds?: string[] | null
  requestedCriteria?: TradeRequestedCriteria | null
  message?: string | null
}

export interface CounterOfferInput {
  offeredCardIds: string[]
  requestedCardIds?: string[] | null
  message?: string | null
}

export interface RespondToPublicOfferInput {
  offeredCardIds: string[]
  message?: string | null
}

export interface TradeMarketplaceFilters {
  rank?: Rank | null
  unitType?: UnitType | null
  ownerName?: string | null
}

export async function createTradeOffer(input: CreateTradeOfferInput) {
  return supabase.rpc('create_trade_offer', {
    p_type: input.type,
    p_target_player_id: input.targetPlayerId ?? null,
    p_offered_card_ids: input.offeredCardIds,
    p_requested_card_ids: input.requestedCardIds ?? null,
    p_requested_criteria: input.requestedCriteria ?? null,
    p_message: input.message ?? null,
  }) as unknown as Promise<{ data: { id: string } | null; error: { message: string } | null }>
}

export async function counterOffer(parentOfferId: string, input: CounterOfferInput) {
  return supabase.rpc('counter_trade_offer', {
    p_parent_offer_id: parentOfferId,
    p_offered_card_ids: input.offeredCardIds,
    p_requested_card_ids: input.requestedCardIds ?? null,
    p_message: input.message ?? null,
  }) as unknown as Promise<{ data: { id: string } | null; error: { message: string } | null }>
}

export async function respondToPublicOffer(publicOfferId: string, input: RespondToPublicOfferInput) {
  return supabase.rpc('respond_to_public_offer', {
    p_public_offer_id: publicOfferId,
    p_offered_card_ids: input.offeredCardIds,
    p_message: input.message ?? null,
  }) as unknown as Promise<{ data: { id: string } | null; error: { message: string } | null }>
}

export async function acceptOffer(offerId: string) {
  return supabase.rpc('accept_trade_offer', {
    p_offer_id: offerId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}

export async function rejectOffer(offerId: string) {
  return supabase.rpc('reject_trade_offer', {
    p_offer_id: offerId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}

export async function cancelOffer(offerId: string) {
  return supabase.rpc('cancel_trade_offer', {
    p_offer_id: offerId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}

export async function listMyOffers() {
  return supabase.rpc('list_my_trade_offers') as unknown as Promise<{
    data: TradeOffer[] | null
    error: { message: string } | null
  }>
}

export async function listPublicMarketplace(filters: TradeMarketplaceFilters = {}) {
  return supabase.rpc('list_public_trade_marketplace', {
    p_rank: filters.rank ?? null,
    p_unit_type: filters.unitType ?? null,
    p_owner_name: filters.ownerName ?? null,
  }) as unknown as Promise<{
    data: TradeOffer[] | null
    error: { message: string } | null
  }>
}

export async function listTradeHistory() {
  return supabase.rpc('list_trade_history') as unknown as Promise<{
    data: TradeOffer[] | null
    error: { message: string } | null
  }>
}
