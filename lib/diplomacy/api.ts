import { supabase } from '@/lib/supabase/client'
import type {
  DiplomacyOfferRow,
  DiplomacyRelationState,
  DiplomacyWarRow,
  ProposePeaceInput,
} from './types'

export async function getRelation(otherPlayerId: string) {
  return supabase.rpc('diplomacy_get_relation', {
    p_other_player_id: otherPlayerId,
  }) as unknown as Promise<{
    data: DiplomacyRelationState | null
    error: { message: string } | null
  }>
}

export async function listWars() {
  return supabase.rpc('diplomacy_list_wars') as unknown as Promise<{
    data: DiplomacyWarRow[] | null
    error: { message: string } | null
  }>
}

export async function listOffers() {
  return supabase.rpc('diplomacy_list_offers') as unknown as Promise<{
    data: DiplomacyOfferRow[] | null
    error: { message: string } | null
  }>
}

export async function proposePeace(input: ProposePeaceInput) {
  return supabase.rpc('diplomacy_propose_peace', {
    p_target_id: input.targetPlayerId,
    p_kind: input.kind,
    p_offered_card_ids: input.offeredCardIds ?? [],
    p_offered_territory_id: input.offeredTerritoryId ?? null,
  }) as unknown as Promise<{
    data: string | null
    error: { message: string } | null
  }>
}

export async function acceptPeace(offerId: string) {
  return supabase.rpc('diplomacy_accept_peace', {
    p_offer_id: offerId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}

export async function rejectPeace(offerId: string) {
  return supabase.rpc('diplomacy_reject_peace', {
    p_offer_id: offerId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}

export async function cancelPeace(offerId: string) {
  return supabase.rpc('diplomacy_cancel_peace', {
    p_offer_id: offerId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}
