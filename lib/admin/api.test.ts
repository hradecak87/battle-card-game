import {
  getAdminStatus,
  getAdminOnlinePlayers,
  getAdminActiveBattles,
  getAdminPlayerCards,
  getAdminCardTemplates,
  grantAdminCard,
  removeAdminCard,
  grantAdminXp,
} from './api'

const rpc = jest.fn()

const playerSingle = jest.fn()
const playerEq = jest.fn(() => ({ single: playerSingle }))
const playerSelect = jest.fn(() => ({ eq: playerEq }))

const templatesOrder = jest.fn()
const templateBuilder = { order: templatesOrder }
templatesOrder.mockImplementation(() => templateBuilder)
const templatesSelect = jest.fn(() => templateBuilder)

const cardsOrder = jest.fn()
const cardBuilder = { order: cardsOrder }
cardsOrder.mockImplementation(() => cardBuilder)
const cardsEq = jest.fn(() => cardBuilder)
const cardsSelect = jest.fn(() => ({ eq: cardsEq }))

const from = jest.fn((table: string) => {
  if (table === 'players') return { select: playerSelect }
  if (table === 'card_templates') return { select: templatesSelect }
  if (table === 'card_instances') return { select: cardsSelect }
  return { select: jest.fn() }
})

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => from(table),
  },
}))

describe('getAdminStatus', () => {
  beforeEach(() => {
    from.mockClear()
    playerSelect.mockClear()
    playerEq.mockClear()
    playerSingle.mockReset()
  })

  it('loads the current player admin flag from the players table', async () => {
    const response = { data: { is_admin: true }, error: null }
    playerSingle.mockResolvedValue(response)

    await expect(getAdminStatus('player-1')).resolves.toEqual(response)
    expect(from).toHaveBeenCalledWith('players')
    expect(playerSelect).toHaveBeenCalledWith('is_admin')
    expect(playerEq).toHaveBeenCalledWith('id', 'player-1')
    expect(playerSingle).toHaveBeenCalled()
  })
})

describe('admin RPC wrappers', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('calls admin_list_online_players', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await getAdminOnlinePlayers()
    expect(rpc).toHaveBeenCalledWith('admin_list_online_players')
  })

  it('calls admin_list_active_battles', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await getAdminActiveBattles()
    expect(rpc).toHaveBeenCalledWith('admin_list_active_battles')
  })

  it('calls admin_list_player_cards with the selected player id', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await getAdminPlayerCards('player-2')
    expect(rpc).toHaveBeenCalledWith('admin_list_player_cards', { p_player_id: 'player-2' })
  })

  it('calls admin_grant_card with the selected arguments', async () => {
    rpc.mockResolvedValue({ data: 'card-1', error: null })
    await grantAdminCard('player-2', 'spearmen-common-1', 77)
    expect(rpc).toHaveBeenCalledWith('admin_grant_card', {
      p_player_id: 'player-2',
      p_template_id: 'spearmen-common-1',
      p_territory_id: 77,
    })
  })

  it('passes null territory ids through to admin_grant_card', async () => {
    rpc.mockResolvedValue({ data: 'card-2', error: null })
    await grantAdminCard('player-2', 'village-common', null)
    expect(rpc).toHaveBeenCalledWith('admin_grant_card', {
      p_player_id: 'player-2',
      p_template_id: 'village-common',
      p_territory_id: null,
    })
  })

  it('calls admin_remove_card', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await removeAdminCard('instance-1')
    expect(rpc).toHaveBeenCalledWith('admin_remove_card', { p_card_instance_id: 'instance-1' })
  })

  it('calls admin_grant_xp', async () => {
    rpc.mockResolvedValue({ data: 1250, error: null })
    await grantAdminXp('player-2', -50)
    expect(rpc).toHaveBeenCalledWith('admin_grant_xp', {
      p_player_id: 'player-2',
      p_amount: -50,
    })
  })
})

describe('getAdminCardTemplates', () => {
  beforeEach(() => {
    from.mockClear()
    templatesSelect.mockClear()
    templatesOrder.mockClear()
  })

  it('loads card templates ordered for the admin picker', async () => {
    const response = Promise.resolve({ data: [], error: null })
    ;(templateBuilder as unknown as Promise<unknown>).then = response.then.bind(response)

    await getAdminCardTemplates()

    expect(from).toHaveBeenCalledWith('card_templates')
    expect(templatesSelect).toHaveBeenCalledWith('id, name, rank, category, unit_type')
    expect(templatesOrder).toHaveBeenNthCalledWith(1, 'category')
    expect(templatesOrder).toHaveBeenNthCalledWith(2, 'rank')
    expect(templatesOrder).toHaveBeenNthCalledWith(3, 'name')
  })
})
