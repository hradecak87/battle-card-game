import {
  acceptPeace,
  cancelPeace,
  getRelation,
  listOffers,
  listWars,
  proposePeace,
  rejectPeace,
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

  it('calls diplomacy_list_wars without arguments', async () => {
    const response = { data: [], error: null }
    rpc.mockResolvedValue(response)

    await expect(listWars()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('diplomacy_list_wars')
  })

  it('calls diplomacy_list_offers without arguments', async () => {
    const response = { data: [], error: null }
    rpc.mockResolvedValue(response)

    await expect(listOffers()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('diplomacy_list_offers')
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

  it('calls the accept/reject/cancel RPCs with offer ids', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await acceptPeace('offer-a')
    await rejectPeace('offer-b')
    await cancelPeace('offer-c')

    expect(rpc).toHaveBeenNthCalledWith(1, 'diplomacy_accept_peace', { p_offer_id: 'offer-a' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'diplomacy_reject_peace', { p_offer_id: 'offer-b' })
    expect(rpc).toHaveBeenNthCalledWith(3, 'diplomacy_cancel_peace', { p_offer_id: 'offer-c' })
  })
})
