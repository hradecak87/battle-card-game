import {
  declareAttack,
  getCardInstancesAtTerritory,
  getPlayerPublicInfo,
  getMyStructureCardInstances,
  getMyTerritories,
  relocateHome,
  renameTerritory,
} from './api'

const single = jest.fn()
const inFn = jest.fn()
const order = jest.fn()
const eq = jest.fn(() => ({ single, in: inFn, order }))
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

  describe('relocateHome', () => {
    beforeEach(() => {
      rpc.mockReset()
    })

    it('calls the relocate_home RPC with the correct arguments', async () => {
      rpc.mockResolvedValue({ data: null, error: null })
      await relocateHome(42)
      expect(rpc).toHaveBeenCalledWith('relocate_home', { p_new_territory_id: 42 })
    })
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

describe('declareAttack', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('calls the declare_attack RPC with grouped multi-origin payload', async () => {
    rpc.mockResolvedValue({ data: 'movement-1', error: null })

    await declareAttack(99, [
      { originTerritoryId: 1, cardInstanceIds: ['inst-1'] },
      { originTerritoryId: 2, cardInstanceIds: ['inst-2', 'inst-3'] },
    ], 'boost-1')

    expect(rpc).toHaveBeenCalledWith('declare_attack', {
      target_territory_id: 99,
      origin_groups: [
        { origin_territory_id: 1, card_instance_ids: ['inst-1'] },
        { origin_territory_id: 2, card_instance_ids: ['inst-2', 'inst-3'] },
      ],
      p_boost_card_instance_id: 'boost-1',
    })
  })
})

describe('getCardInstancesAtTerritory', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('uses the visibility-aware territory card RPC', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await getCardInstancesAtTerritory(55)
    expect(rpc).toHaveBeenCalledWith('get_visible_territory_cards', { p_territory_id: 55 })
  })
})

describe('getMyTerritories', () => {
  it('selects the owned-territory battle lock alongside the existing fields', async () => {
    const orderChain: { order: jest.Mock } & PromiseLike<{ data: unknown[]; error: null }> = {
      order: jest.fn(() => orderChain),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    } as unknown as { order: jest.Mock } & PromiseLike<{ data: unknown[]; error: null }>
    eq.mockReturnValueOnce(orderChain as unknown as ReturnType<typeof eq>)

    await getMyTerritories('player-1')

    expect(select).toHaveBeenCalledWith('id, x, y, is_home, castle_rank, village_rank, name, battle_locked_by')
    expect(eq).toHaveBeenCalledWith('owner_id', 'player-1')
  })
})

describe('getMyStructureCardInstances', () => {
  beforeEach(() => {
    from.mockClear()
    select.mockClear()
    eq.mockClear()
    inFn.mockReset()
  })

  it('queries card_instances filtered to the owner and castle/village categories', async () => {
    const response = {
      data: [
        {
          instance_id: 'ci-castle-1',
          template_id: 'castle-common',
          owner_id: 'player-1',
          stationed_territory_id: null,
          status: 'stationed',
          card_templates: {
            id: 'castle-common',
            name: 'Hrad (common)',
            flavor_text: 'Kamenná pevnost.',
            rank: 'common',
            category: 'castle',
            unit_type: null,
            base_stats: null,
            total_supply: 45,
            defense_bonus_pct: 20,
            attack_bonus_pct: 10,
          },
        },
      ],
      error: null,
    }
    inFn.mockResolvedValue(response)

    await expect(getMyStructureCardInstances('player-1')).resolves.toEqual(response)
    expect(from).toHaveBeenCalledWith('card_instances')
    expect(eq).toHaveBeenCalledWith('owner_id', 'player-1')
    expect(inFn).toHaveBeenCalledWith('card_templates.category', ['castle', 'village'])
  })
})
