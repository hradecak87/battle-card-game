import {
  acceptCoalitionInvite,
  acceptCoalitionJoinRequest,
  acceptNonAggression,
  acceptPeace,
  cancelCoalitionInvite,
  cancelCoalitionJoinRequest,
  cancelNonAggression,
  cancelPeace,
  createCoalition,
  declareCoalitionPeace,
  declareCoalitionWar,
  declareWar,
  disbandCoalition,
  getMyCoalition,
  getRelation,
  inviteToCoalition,
  kickCoalitionMember,
  leaveCoalition,
  listCoalitionInvites,
  listCoalitionJoinRequests,
  listCoalitions,
  listNonAggressionPacts,
  listOffers,
  listWars,
  proposeNonAggression,
  proposePeace,
  rejectCoalitionInvite,
  rejectCoalitionJoinRequest,
  rejectNonAggression,
  rejectPeace,
  requestJoinCoalition,
  transferCoalitionLeadership,
} from './api'

const rpc = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

describe('diplomacy api wrappers', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('calls diplomacy_get_relation with the expected payload', async () => {
    const response = { data: 'war', error: null }
    rpc.mockResolvedValue(response)

    await expect(getRelation('player-2')).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('diplomacy_get_relation', {
      p_other_player_id: 'player-2',
    })
  })

  it.each([
    ['diplomacy_list_wars', listWars],
    ['diplomacy_list_offers', listOffers],
    ['diplomacy_list_non_aggression_pacts', listNonAggressionPacts],
    ['coalition_get_mine', getMyCoalition],
    ['coalition_list', listCoalitions],
    ['coalition_list_invites', listCoalitionInvites],
    ['coalition_leave', leaveCoalition],
    ['coalition_disband', disbandCoalition],
  ])('calls %s without arguments', async (rpcName, fn) => {
    const response = { data: [], error: null }
    rpc.mockResolvedValue(response)

    await expect(fn()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith(rpcName)
  })

  it('calls diplomacy_propose_peace with the expected payload', async () => {
    const response = { data: 'offer-1', error: null }
    rpc.mockResolvedValue(response)

    await expect(
      proposePeace({
        targetPlayerId: 'player-2',
        kind: 'tribute_peace',
        offeredCardIds: ['card-a', 'card-b'],
        offeredTerritoryId: 42,
      })
    ).resolves.toEqual(response)

    expect(rpc).toHaveBeenCalledWith('diplomacy_propose_peace', {
      p_target_id: 'player-2',
      p_kind: 'tribute_peace',
      p_offered_card_ids: ['card-a', 'card-b'],
      p_offered_territory_id: 42,
    })
  })

  it('defaults optional tribute fields when proposing peace', async () => {
    rpc.mockResolvedValue({ data: 'offer-2', error: null })

    await proposePeace({
      targetPlayerId: 'player-3',
      kind: 'white_peace',
    })

    expect(rpc).toHaveBeenCalledWith('diplomacy_propose_peace', {
      p_target_id: 'player-3',
      p_kind: 'white_peace',
      p_offered_card_ids: [],
      p_offered_territory_id: null,
    })
  })

  it('calls diplomacy_propose_non_aggression with the expected payload', async () => {
    const response = { data: 'offer-3', error: null }
    rpc.mockResolvedValue(response)

    await expect(proposeNonAggression('player-4')).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('diplomacy_propose_non_aggression', {
      p_target_id: 'player-4',
    })
  })

  it.each([
    [acceptPeace, 'diplomacy_accept_peace', 'p_offer_id', 'offer-a'],
    [rejectPeace, 'diplomacy_reject_peace', 'p_offer_id', 'offer-b'],
    [cancelPeace, 'diplomacy_cancel_peace', 'p_offer_id', 'offer-c'],
    [acceptNonAggression, 'diplomacy_accept_non_aggression', 'p_offer_id', 'offer-d'],
    [rejectNonAggression, 'diplomacy_reject_non_aggression', 'p_offer_id', 'offer-e'],
    [cancelNonAggression, 'diplomacy_cancel_non_aggression', 'p_offer_id', 'offer-f'],
    [acceptCoalitionInvite, 'coalition_accept_invite', 'p_invite_id', 'invite-a'],
    [acceptCoalitionJoinRequest, 'coalition_accept_request', 'p_request_id', 'request-a'],
    [rejectCoalitionInvite, 'coalition_reject_invite', 'p_invite_id', 'invite-b'],
    [cancelCoalitionInvite, 'coalition_cancel_invite', 'p_invite_id', 'invite-c'],
    [rejectCoalitionJoinRequest, 'coalition_reject_request', 'p_request_id', 'request-b'],
    [cancelCoalitionJoinRequest, 'coalition_cancel_request', 'p_request_id', 'request-c'],
    [kickCoalitionMember, 'coalition_kick', 'p_player_id', 'player-9'],
    [transferCoalitionLeadership, 'coalition_transfer_leadership', 'p_new_leader_id', 'player-10'],
  ])('calls %s via %s', async (fn, rpcName, key, value) => {
    rpc.mockResolvedValue({ data: null, error: null })

    await fn(value)

    expect(rpc).toHaveBeenCalledWith(rpcName, { [key]: value })
  })

  it('calls diplomacy_declare_war with the target player id', async () => {
    const response = { data: null, error: null }
    rpc.mockResolvedValue(response)

    await expect(declareWar('player-4')).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('diplomacy_declare_war', {
      p_target_id: 'player-4',
    })
  })

  it.each([
    [listCoalitionJoinRequests, 'coalition_list_join_requests', { p_coalition_id: 'coalition-1' }, 'coalition-1'],
    [createCoalition, 'coalition_create', { p_name: 'Amber Pact' }, 'Amber Pact'],
    [
      inviteToCoalition,
      'coalition_invite',
      { p_coalition_id: 'coalition-2', p_player_id: 'player-6' },
      'coalition-2',
      'player-6',
    ],
    [requestJoinCoalition, 'coalition_request_join', { p_coalition_id: 'coalition-3' }, 'coalition-3'],
    [declareCoalitionWar, 'coalition_declare_war', { p_target_id: 'player-7' }, 'player-7'],
    [declareCoalitionPeace, 'coalition_declare_peace', { p_target_id: 'player-8' }, 'player-8'],
  ])('calls %s with the expected payload', async (fn, rpcName, payload, ...args) => {
    const response = { data: 'result', error: null }
    rpc.mockResolvedValue(response)

    await expect((fn as (...callArgs: unknown[]) => Promise<unknown>)(...args)).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith(rpcName, payload)
  })
})
