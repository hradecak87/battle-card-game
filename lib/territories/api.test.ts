import { getPlayerPublicInfo } from './api'

const single = jest.fn()
const eq = jest.fn(() => ({ single }))
const select = jest.fn(() => ({ eq }))
const from = jest.fn((_table: string) => ({ select }))

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => from(table),
    rpc: jest.fn(),
  },
}))

describe('getPlayerPublicInfo', () => {
  beforeEach(() => {
    from.mockClear()
    select.mockClear()
    eq.mockClear()
    single.mockReset()
  })

  it('loads the public player profile fields for a given player id', async () => {
    const response = {
      data: {
        id: 'player-1',
        display_name: 'Sir Testalot',
        nation: 'england',
        kingdom_name: 'Bílý lev',
        xp: 1250,
      },
      error: null,
    }
    single.mockResolvedValue(response)

    await expect(getPlayerPublicInfo('player-1')).resolves.toEqual(response)
    expect(from).toHaveBeenCalledWith('players')
    expect(select).toHaveBeenCalledWith('id, display_name, nation, kingdom_name, xp')
    expect(eq).toHaveBeenCalledWith('id', 'player-1')
    expect(single).toHaveBeenCalled()
  })
})
