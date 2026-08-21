import { supabase } from '@/lib/supabase/client'
import type {
  CoalitionDetail,
  CoalitionInviteRow,
  CoalitionJoinRequestRow,
  CoalitionSummary,
  DiplomacyOfferRow,
  DiplomacyRelationState,
  DiplomacyWarRow,
  NonAggressionPactRow,
  ProposePeaceInput,
} from './types'

type RpcResult<T> = Promise<{
  data: T
  error: { message: string } | null
}>

export async function getRelation(otherPlayerId: string) {
  return supabase.rpc('diplomacy_get_relation', {
    p_other_player_id: otherPlayerId,
  }) as unknown as RpcResult<DiplomacyRelationState | null>
}

export async function listWars() {
  return supabase.rpc('diplomacy_list_wars') as unknown as RpcResult<DiplomacyWarRow[] | null>
}

export async function listOffers() {
  return supabase.rpc('diplomacy_list_offers') as unknown as RpcResult<DiplomacyOfferRow[] | null>
}

export async function listNonAggressionPacts() {
  return supabase.rpc('diplomacy_list_non_aggression_pacts') as unknown as RpcResult<
    NonAggressionPactRow[] | null
  >
}

export async function proposePeace(input: ProposePeaceInput) {
  return supabase.rpc('diplomacy_propose_peace', {
    p_target_id: input.targetPlayerId,
    p_kind: input.kind,
    p_offered_card_ids: input.offeredCardIds ?? [],
    p_offered_territory_id: input.offeredTerritoryId ?? null,
  }) as unknown as RpcResult<string | null>
}

export async function proposeNonAggression(targetPlayerId: string) {
  return supabase.rpc('diplomacy_propose_non_aggression', {
    p_target_id: targetPlayerId,
  }) as unknown as RpcResult<string | null>
}

export async function acceptPeace(offerId: string) {
  return supabase.rpc('diplomacy_accept_peace', {
    p_offer_id: offerId,
  }) as unknown as RpcResult<null>
}

export async function acceptNonAggression(offerId: string) {
  return supabase.rpc('diplomacy_accept_non_aggression', {
    p_offer_id: offerId,
  }) as unknown as RpcResult<null>
}

export async function rejectPeace(offerId: string) {
  return supabase.rpc('diplomacy_reject_peace', {
    p_offer_id: offerId,
  }) as unknown as RpcResult<null>
}

export async function rejectNonAggression(offerId: string) {
  return supabase.rpc('diplomacy_reject_non_aggression', {
    p_offer_id: offerId,
  }) as unknown as RpcResult<null>
}

export async function cancelPeace(offerId: string) {
  return supabase.rpc('diplomacy_cancel_peace', {
    p_offer_id: offerId,
  }) as unknown as RpcResult<null>
}

export async function cancelNonAggression(offerId: string) {
  return supabase.rpc('diplomacy_cancel_non_aggression', {
    p_offer_id: offerId,
  }) as unknown as RpcResult<null>
}

export async function declareWar(targetPlayerId: string) {
  return supabase.rpc('diplomacy_declare_war', {
    p_target_id: targetPlayerId,
  }) as unknown as RpcResult<null>
}

export async function getMyCoalition() {
  return supabase.rpc('coalition_get_mine') as unknown as RpcResult<CoalitionDetail[] | null>
}

export async function listCoalitions() {
  return supabase.rpc('coalition_list') as unknown as RpcResult<CoalitionSummary[] | null>
}

export async function listCoalitionInvites() {
  return supabase.rpc('coalition_list_invites') as unknown as RpcResult<CoalitionInviteRow[] | null>
}

export async function listCoalitionJoinRequests(coalitionId: string) {
  return supabase.rpc('coalition_list_join_requests', {
    p_coalition_id: coalitionId,
  }) as unknown as RpcResult<CoalitionJoinRequestRow[] | null>
}

export async function createCoalition(name: string) {
  return supabase.rpc('coalition_create', {
    p_name: name,
  }) as unknown as RpcResult<string | null>
}

export async function inviteToCoalition(coalitionId: string, playerId: string) {
  return supabase.rpc('coalition_invite', {
    p_coalition_id: coalitionId,
    p_player_id: playerId,
  }) as unknown as RpcResult<string | null>
}

export async function requestJoinCoalition(coalitionId: string) {
  return supabase.rpc('coalition_request_join', {
    p_coalition_id: coalitionId,
  }) as unknown as RpcResult<string | null>
}

export async function acceptCoalitionInvite(inviteId: string) {
  return supabase.rpc('coalition_accept_invite', {
    p_invite_id: inviteId,
  }) as unknown as RpcResult<null>
}

export async function acceptCoalitionJoinRequest(requestId: string) {
  return supabase.rpc('coalition_accept_request', {
    p_request_id: requestId,
  }) as unknown as RpcResult<null>
}

export async function rejectCoalitionInvite(inviteId: string) {
  return supabase.rpc('coalition_reject_invite', {
    p_invite_id: inviteId,
  }) as unknown as RpcResult<null>
}

export async function cancelCoalitionInvite(inviteId: string) {
  return supabase.rpc('coalition_cancel_invite', {
    p_invite_id: inviteId,
  }) as unknown as RpcResult<null>
}

export async function rejectCoalitionJoinRequest(requestId: string) {
  return supabase.rpc('coalition_reject_request', {
    p_request_id: requestId,
  }) as unknown as RpcResult<null>
}

export async function cancelCoalitionJoinRequest(requestId: string) {
  return supabase.rpc('coalition_cancel_request', {
    p_request_id: requestId,
  }) as unknown as RpcResult<null>
}

export async function kickCoalitionMember(playerId: string) {
  return supabase.rpc('coalition_kick', {
    p_player_id: playerId,
  }) as unknown as RpcResult<null>
}

export async function transferCoalitionLeadership(newLeaderId: string) {
  return supabase.rpc('coalition_transfer_leadership', {
    p_new_leader_id: newLeaderId,
  }) as unknown as RpcResult<null>
}

export async function leaveCoalition() {
  return supabase.rpc('coalition_leave') as unknown as RpcResult<null>
}

export async function disbandCoalition() {
  return supabase.rpc('coalition_disband') as unknown as RpcResult<null>
}

export async function declareCoalitionWar(targetPlayerId: string) {
  return supabase.rpc('coalition_declare_war', {
    p_target_id: targetPlayerId,
  }) as unknown as RpcResult<null>
}

export async function declareCoalitionPeace(targetPlayerId: string) {
  return supabase.rpc('coalition_declare_peace', {
    p_target_id: targetPlayerId,
  }) as unknown as RpcResult<null>
}
