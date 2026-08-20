const rpc = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

describe('world activity feed RPC wrappers', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('calls world_list_attacks_in_transit', async () => {
    const { listAttacksInTransit } = await import('./api')
    rpc.mockResolvedValue({ data: [], error: null })

    await listAttacksInTransit()

    expect(rpc).toHaveBeenCalledWith('world_list_attacks_in_transit')
  })

  it('calls world_list_claims_in_progress', async () => {
    const { listClaimsInProgress } = await import('./api')
    rpc.mockResolvedValue({ data: [], error: null })

    await listClaimsInProgress()

    expect(rpc).toHaveBeenCalledWith('world_list_claims_in_progress')
  })

  it('calls world_list_active_battles', async () => {
    const { listActiveBattles } = await import('./api')
    rpc.mockResolvedValue({ data: [], error: null })

    await listActiveBattles()

    expect(rpc).toHaveBeenCalledWith('world_list_active_battles')
  })

  it('calls world_list_events with page args', async () => {
    const { listWorldEvents } = await import('./api')
    rpc.mockResolvedValue({ data: [], error: null })

    await listWorldEvents(2, 10)

    expect(rpc).toHaveBeenCalledWith('world_list_events', {
      p_page: 2,
      p_page_size: 10,
    })
  })
})
