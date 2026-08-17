import { claimDailyReward } from './api'

const rpc = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

describe('claimDailyReward', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('calls the claim_daily_reward RPC without arguments', async () => {
    const response = {
      data: {
        streak: 4,
        claimed_at: '2026-08-17T10:00:00Z',
        granted_cards: [{ template_id: 'archers-common-01', rank: 'common' }],
      },
      error: null,
    }
    rpc.mockResolvedValue(response)

    await expect(claimDailyReward()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('claim_daily_reward')
  })
})
