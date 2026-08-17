import {
  acceptOffer,
  cancelOffer,
  counterOffer,
  createTradeOffer,
  listMyOffers,
  listPublicMarketplace,
  listTradeHistory,
  rejectOffer,
  respondToPublicOffer,
} from './api'

const rpc = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

describe('trading api wrappers', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('calls create_trade_offer with the expected payload', async () => {
    const response = { data: { id: 'offer-1' }, error: null }
    rpc.mockResolvedValue(response)

    await expect(
      createTradeOffer({
        type: 'direct',
        targetPlayerId: 'player-2',
        offeredCardIds: ['card-a'],
        requestedCardIds: ['card-b'],
        message: 'Směna?',
      })
    ).resolves.toEqual(response)

    expect(rpc).toHaveBeenCalledWith('create_trade_offer', {
      p_type: 'direct',
      p_target_player_id: 'player-2',
      p_offered_card_ids: ['card-a'],
      p_requested_card_ids: ['card-b'],
      p_requested_criteria: null,
      p_message: 'Směna?',
    })
  })

  it('calls counter_trade_offer with the expected payload', async () => {
    rpc.mockResolvedValue({ data: { id: 'offer-2' }, error: null })

    await counterOffer('offer-1', {
      offeredCardIds: ['card-c'],
      requestedCardIds: ['card-d'],
      message: 'Protivýměna',
    })

    expect(rpc).toHaveBeenCalledWith('counter_trade_offer', {
      p_parent_offer_id: 'offer-1',
      p_offered_card_ids: ['card-c'],
      p_requested_card_ids: ['card-d'],
      p_message: 'Protivýměna',
    })
  })

  it('calls respond_to_public_offer with the expected payload', async () => {
    rpc.mockResolvedValue({ data: { id: 'offer-3' }, error: null })

    await respondToPublicOffer('public-1', {
      offeredCardIds: ['card-e'],
      message: 'Mám zájem',
    })

    expect(rpc).toHaveBeenCalledWith('respond_to_public_offer', {
      p_public_offer_id: 'public-1',
      p_offered_card_ids: ['card-e'],
      p_message: 'Mám zájem',
    })
  })

  it('calls the accept/reject/cancel RPCs with offer ids', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await acceptOffer('offer-a')
    await rejectOffer('offer-b')
    await cancelOffer('offer-c')

    expect(rpc).toHaveBeenNthCalledWith(1, 'accept_trade_offer', { p_offer_id: 'offer-a' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'reject_trade_offer', { p_offer_id: 'offer-b' })
    expect(rpc).toHaveBeenNthCalledWith(3, 'cancel_trade_offer', { p_offer_id: 'offer-c' })
  })

  it('calls list_my_offers without arguments', async () => {
    const response = { data: [], error: null }
    rpc.mockResolvedValue(response)

    await expect(listMyOffers()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('list_my_trade_offers')
  })

  it('calls list_public_trade_marketplace with nullable filters', async () => {
    const response = { data: [], error: null }
    rpc.mockResolvedValue(response)

    await expect(
      listPublicMarketplace({
        rank: 'common',
        unitType: 'archers',
        ownerName: 'Artuš',
      })
    ).resolves.toEqual(response)

    expect(rpc).toHaveBeenCalledWith('list_public_trade_marketplace', {
      p_rank: 'common',
      p_unit_type: 'archers',
      p_owner_name: 'Artuš',
    })
  })

  it('calls list_trade_history without arguments', async () => {
    const response = { data: [], error: null }
    rpc.mockResolvedValue(response)

    await expect(listTradeHistory()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('list_trade_history')
  })
})
