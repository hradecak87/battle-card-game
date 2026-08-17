import { getPlayerPublicInfo, renameTerritory } from './api'

const single = jest.fn()
const eq = jest.fn(() => ({ single }))
const select = jest.fn(() => ({ eq }))
const from = jest.fn((_table: string) => ({ select }))
const rpc = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => from(table),
    rpc: (...args: unknown[]) => rpc(...args),
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

describe('renameTerritory', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('calls the rename_territory RPC with the correct arguments', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await renameTerritory(42, 'Hrad Orlík')
    expect(rpc).toHaveBeenCalledWith('rename_territory', { territory_id: 42, new_name: 'Hrad Orlík' })
  })

  it('passes an empty string to clear the name', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await renameTerritory(42, '')
    expect(rpc).toHaveBeenCalledWith('rename_territory', { territory_id: 42, new_name: '' })
  })
})
