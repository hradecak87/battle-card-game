import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import MapPage from './page'

const routerPush = jest.fn()
let searchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => searchParams,
}))

const mockTerritory = (x: number, y: number, overrides: Partial<Record<string, unknown>> = {}) => ({
  id: y * 256 + x + 1,
  x,
  y,
  difficulty: 1,
  castle_rank: null,
  village_rank: null,
  owner_id: null,
  is_home: false,
  claim_locked_by: null,
  claim_started_at: null,
  claim_transfer_arrives_at: null,
  claim_occupation_completes_at: null,
  battle_locked_by: null,
  name: null,
  ...overrides,
})

const getViewport = jest.fn().mockResolvedValue({
  data: [mockTerritory(128, 128, { is_home: true, owner_id: 'me' })],
  error: null,
})
const getMinimapOverview = jest.fn().mockResolvedValue({ data: [], error: null })
const getCardInstancesAtTerritory = jest.fn().mockResolvedValue({ data: [], error: null })
const getMyHomeTerritory = jest.fn().mockResolvedValue({ data: [], error: null })
const getMyTerritories = jest.fn().mockResolvedValue({ data: [], error: null })
const getIncomingAttackInfo = jest.fn().mockResolvedValue({ data: null, error: null })
const getPlayerPublicInfo = jest.fn().mockResolvedValue({ data: null, error: null })
const startTransfer = jest.fn().mockResolvedValue({ data: null, error: null })
const getMyMovements = jest.fn().mockResolvedValue({ data: [], error: null })
const getTerritoriesByIds = jest.fn().mockResolvedValue({ data: [], error: null })
const getMyActiveBattles = jest.fn().mockResolvedValue({ data: [], error: null })
const getMyRecentlyResolvedBattles = jest.fn().mockResolvedValue({ data: [], error: null })
const getActiveBattleForTerritory = jest.fn().mockResolvedValue({ data: null, error: null })
const renameTerritory = jest.fn().mockResolvedValue({ data: null, error: null })
const getMyStructureCardInstances = jest.fn().mockResolvedValue({ data: [], error: null })
const buildStructure = jest.fn().mockResolvedValue({ data: null, error: null })
const relocateHome = jest.fn().mockResolvedValue({ data: null, error: null })
const getRelation = jest.fn().mockResolvedValue({ data: null, error: null })

jest.mock('@/lib/territories/api', () => ({
  getViewport: (...args: unknown[]) => getViewport(...args),
  getMinimapOverview: (...args: unknown[]) => getMinimapOverview(...args),
  getCardInstancesAtTerritory: (...args: unknown[]) => getCardInstancesAtTerritory(...args),
  getMyHomeTerritory: (...args: unknown[]) => getMyHomeTerritory(...args),
  getMyTerritories: (...args: unknown[]) => getMyTerritories(...args),
  getIncomingAttackInfo: (...args: unknown[]) => getIncomingAttackInfo(...args),
  getPlayerPublicInfo: (...args: unknown[]) => getPlayerPublicInfo(...args),
  startTransfer: (...args: unknown[]) => startTransfer(...args),
  getMyMovements: (...args: unknown[]) => getMyMovements(...args),
  getTerritoriesByIds: (...args: unknown[]) => getTerritoriesByIds(...args),
  getMyActiveBattles: (...args: unknown[]) => getMyActiveBattles(...args),
  getMyRecentlyResolvedBattles: (...args: unknown[]) => getMyRecentlyResolvedBattles(...args),
  getActiveBattleForTerritory: (...args: unknown[]) => getActiveBattleForTerritory(...args),
  renameTerritory: (...args: unknown[]) => renameTerritory(...args),
  getMyStructureCardInstances: (...args: unknown[]) => getMyStructureCardInstances(...args),
  buildStructure: (...args: unknown[]) => buildStructure(...args),
  relocateHome: (...args: unknown[]) => relocateHome(...args),
}))

let sessionUser: { id: string } | null = null
let sessionPlayer: { xp: number; king_relocation_used_at: string | null } | null = null
jest.mock('@/lib/supabase/useSession', () => ({
  useSession: () => ({ user: sessionUser, player: sessionPlayer, loading: false }),
}))

jest.mock('@/lib/diplomacy/api', () => ({
  getRelation: (...args: unknown[]) => getRelation(...args),
}))

jest.mock('@/lib/battles/api', () => ({
  declareAttack: jest.fn().mockResolvedValue({ data: null, error: null }),
}))

jest.mock('@/lib/battles/useTerritoryBattleChannel', () => ({
  useTerritoryBattleChannel: jest.fn(),
}))

jest.mock('@/lib/battles/useMyTerritoriesBattleChannel', () => ({
  useMyTerritoriesBattleChannel: jest.fn(),
}))

jest.mock('@/components/territories/MyMovementsPanel', () => ({
  __esModule: true,
  default: ({ refreshKey }: { refreshKey?: number }) => <div data-testid="movements-refresh-key">{refreshKey ?? 0}</div>,
}))

describe('MapPage', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams()
    routerPush.mockReset()
    getViewport.mockReset()
    getViewport.mockResolvedValue({
      data: [mockTerritory(128, 128, { is_home: true, owner_id: 'me' })],
      error: null,
    })
    getMinimapOverview.mockReset()
    getMinimapOverview.mockResolvedValue({ data: [], error: null })
    getCardInstancesAtTerritory.mockReset()
    getCardInstancesAtTerritory.mockResolvedValue({ data: [], error: null })
    getMyHomeTerritory.mockReset()
    getMyHomeTerritory.mockResolvedValue({ data: [], error: null })
    getIncomingAttackInfo.mockReset()
    getIncomingAttackInfo.mockResolvedValue({ data: null, error: null })
    getPlayerPublicInfo.mockClear()
    getMyTerritories.mockReset()
    getMyTerritories.mockResolvedValue({ data: [], error: null })
    startTransfer.mockReset()
    startTransfer.mockResolvedValue({ data: null, error: null })
    getMyMovements.mockReset()
    getMyMovements.mockResolvedValue({ data: [], error: null })
    getTerritoriesByIds.mockReset()
    getTerritoriesByIds.mockResolvedValue({ data: [], error: null })
    getMyActiveBattles.mockReset()
    getMyActiveBattles.mockResolvedValue({ data: [], error: null })
    getMyRecentlyResolvedBattles.mockReset()
    getMyRecentlyResolvedBattles.mockResolvedValue({ data: [], error: null })
    getActiveBattleForTerritory.mockReset()
    getActiveBattleForTerritory.mockResolvedValue({ data: null, error: null })
    relocateHome.mockReset()
    relocateHome.mockResolvedValue({ data: null, error: null })
    getRelation.mockReset()
    getRelation.mockResolvedValue({ data: null, error: null })
    sessionUser = null
    sessionPlayer = null
  })

  it('renders the back-link and loads a viewport centered on (128,128)', async () => {
    render(<MapPage />)

    expect(screen.getByRole('link', { name: /Domů/ })).toHaveAttribute('href', '/')

    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    expect(getViewport).toHaveBeenCalledWith(121, 121, 135, 135)
  })

  it('automatically centers the map on the player home territory after mount', async () => {
    sessionUser = { id: 'me' }
    getMyHomeTerritory.mockResolvedValueOnce({ data: [{ id: 1, x: 10, y: 20 }], error: null })
    render(<MapPage />)

    await waitFor(() => expect(getMyHomeTerritory).toHaveBeenCalled())
    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(3, 13, 17, 27))
  })

  it('uses ?x=&y= query params as the initial center when they are valid', async () => {
    searchParams = new URLSearchParams('x=100&y=50')
    render(<MapPage />)

    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    expect(getViewport).toHaveBeenCalledWith(93, 43, 107, 57)
  })

  it('does not override an explicit ?x=&y= deep link with the player home territory', async () => {
    sessionUser = { id: 'me' }
    searchParams = new URLSearchParams('x=100&y=50')
    getMyHomeTerritory.mockResolvedValueOnce({ data: [{ id: 1, x: 10, y: 20 }], error: null })
    render(<MapPage />)

    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    expect(getViewport).toHaveBeenCalledWith(93, 43, 107, 57)
    expect(getMyHomeTerritory).not.toHaveBeenCalled()
  })

  it('updates the requested window when the coordinate-jump form is submitted', async () => {
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    getViewport.mockClear()

    fireEvent.change(screen.getByLabelText('Souřadnice X'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Souřadnice Y'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Přejít' }))

    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(3, 13, 17, 27))
  })

  it('re-requests a shifted window when a pan arrow is clicked', async () => {
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    getViewport.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Posunout doprava' }))

    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(122, 121, 136, 135))
  })

  it('surfaces an RPC error instead of silently failing', async () => {
    getViewport.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    render(<MapPage />)
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })

  it('jumps to the tile returned by getMyHomeTerritory when "Moje domovské území" is clicked', async () => {
    sessionUser = { id: 'me' }
    getMyHomeTerritory.mockResolvedValue({ data: [{ id: 1, x: 10, y: 20 }], error: null })
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(3, 13, 17, 27))

    fireEvent.click(screen.getByRole('button', { name: 'Posunout doprava' }))
    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(4, 13, 18, 27))
    getViewport.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Moje domovské území/ }))

    await waitFor(() => expect(getMyHomeTerritory).toHaveBeenCalled())
    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(3, 13, 17, 27))
  })

  it('loads owned territories and lets the player focus one from the list', async () => {
    sessionUser = { id: 'me' }
    getMyHomeTerritory.mockResolvedValueOnce({ data: [{ id: 1, x: 10, y: 20 }], error: null })
    getMyTerritories.mockResolvedValueOnce({
      data: [
        { id: 1, x: 10, y: 20, is_home: true, castle_rank: null, village_rank: null },
        { id: 2, x: 33, y: 44, is_home: false, castle_rank: 'rare', village_rank: null },
      ],
      error: null,
    })
    render(<MapPage />)

    expect(await screen.findByText('Tvoje území')).toBeInTheDocument()
    const select = screen.getByLabelText('Zaostřit na vlastní území')
    expect(within(select).getByText('🏠 (10, 20)')).toBeInTheDocument()
    expect(within(select).getByText('🏰 (33, 44)')).toBeInTheDocument()

    getViewport.mockClear()
    fireEvent.change(select, { target: { value: '2' } })

    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(26, 37, 40, 51))
  })

  it('shows a not-found message when getMyHomeTerritory returns no rows', async () => {
    sessionUser = { id: 'me' }
    getMyHomeTerritory.mockResolvedValueOnce({ data: [], error: null })
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Moje domovské území/ }))

    await waitFor(() =>
      expect(screen.getByText(/Domovské území nenalezeno/)).toBeInTheDocument()
    )
  })

  it('loads and displays the garrison when a tile is selected', async () => {
    getCardInstancesAtTerritory.mockResolvedValueOnce({
      data: [
        {
          instance_id: 'inst-1',
          template_id: 'archers-common-01',
          owner_id: 'me',
          stationed_territory_id: 999,
          status: 'stationed',
          card_templates: {
            id: 'archers-common-01',
            name: 'Lučištníci',
            flavor_text: 'Přesní stateční střelci.',
            rank: 'common',
            category: 'unit',
            unit_type: 'archers',
            base_stats: { str: 2, lng: 8, def: 3, hp: 5 },
            total_supply: null,
            defense_bonus_pct: null,
            attack_bonus_pct: null,
          },
        },
      ],
      error: null,
    })
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Území 128,128' }))

    expect(getCardInstancesAtTerritory).toHaveBeenCalledWith(mockTerritory(128, 128).id)
    await waitFor(() => expect(screen.getByTestId('garrison-modal')).toBeInTheDocument())
    expect(screen.getAllByText(/Lučištníci/).length).toBeGreaterThan(0)
  })

  it('shows a message when the selected tile has no garrison', async () => {
    getCardInstancesAtTerritory.mockResolvedValueOnce({ data: [], error: null })
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Území 128,128' }))

    await waitFor(() => expect(screen.getByText('Žádná vojska na tomto území.')).toBeInTheDocument())
  })

  it('loads and shows public owner info for another player territory', async () => {
    sessionUser = { id: 'me' }
    getViewport.mockResolvedValueOnce({
      data: [mockTerritory(128, 128, { owner_id: 'other-player' })],
      error: null,
    })
    getCardInstancesAtTerritory.mockResolvedValueOnce({ data: [], error: null })
    getPlayerPublicInfo.mockResolvedValueOnce({
      data: {
        id: 'other-player',
        display_name: 'Sir Testalot',
        nation: 'england',
        kingdom_name: 'Bílý lev',
        xp: 1250,
      },
      error: null,
    })
    getRelation.mockResolvedValueOnce({ data: 'war', error: null })

    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Území 128,128' }))

    await waitFor(() => expect(getPlayerPublicInfo).toHaveBeenCalledWith('other-player'))
    expect(await screen.findByText(/Jméno:\s*Sir Testalot/)).toBeInTheDocument()
    expect(screen.getByTestId('garrison-war-badge')).toHaveAttribute('href', '/diplomacy')
  })

  it('shows the king relocation action for an eligible owned non-home territory and executes it', async () => {
    sessionUser = { id: 'me' }
    sessionPlayer = { xp: 10500, king_relocation_used_at: null }
    getViewport.mockResolvedValueOnce({
      data: [mockTerritory(128, 128, { owner_id: 'me', is_home: false })],
      error: null,
    })
    getMyTerritories.mockResolvedValueOnce({
      data: [{ id: 1, x: 128, y: 128, is_home: false, castle_rank: null, village_rank: null, name: null, battle_locked_by: null }],
      error: null,
    })
    getCardInstancesAtTerritory.mockResolvedValueOnce({ data: [], error: null })

    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Území 128,128' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Přesunout sem domovské území' })).toBeInTheDocument()
    )

    getViewport.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Přesunout sem domovské území' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ano, přesunout domovské území' }))

    await waitFor(() => expect(relocateHome).toHaveBeenCalledWith(mockTerritory(128, 128).id))
    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(121, 121, 135, 135))
  })

  it('opens the transfer modal for an owned territory and refreshes after a successful transfer', async () => {
    sessionUser = { id: 'me' }
    getCardInstancesAtTerritory.mockResolvedValueOnce({ data: [], error: null })
    // Called twice: once for the page's own "Tvoje území" list (mounted
    // since sessionUser is set), once for TransferModal's origin picker.
    getMyTerritories.mockResolvedValueOnce({
      data: [
        { id: mockTerritory(128, 128).id, x: 128, y: 128, is_home: false },
        { id: 1, x: 0, y: 0, is_home: true },
      ],
      error: null,
    })
    getMyTerritories.mockResolvedValueOnce({
      data: [
        { id: mockTerritory(128, 128).id, x: 128, y: 128, is_home: false },
        { id: 1, x: 0, y: 0, is_home: true },
      ],
      error: null,
    })
    getCardInstancesAtTerritory.mockResolvedValueOnce({
      data: [
        {
          instance_id: 'inst-1',
          template_id: 'archers-common-01',
          owner_id: 'me',
          stationed_territory_id: 1,
          status: 'stationed',
          card_templates: {
            id: 'archers-common-01',
            name: 'Lučištníci',
            flavor_text: 'Přesní stateční střelci.',
            rank: 'common',
            category: 'unit',
            unit_type: 'archers',
            base_stats: { str: 2, lng: 8, def: 3, hp: 5 },
            total_supply: null,
            defense_bonus_pct: null,
            attack_bonus_pct: null,
          },
        },
      ],
      error: null,
    })

    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Území 128,128' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Přesunout vojska' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Přesunout vojska' }))
    fireEvent.change(await screen.findByLabelText('Odkud přesouváš'), { target: { value: '1' } })
    await screen.findAllByText('Lučištníci')
    fireEvent.click(screen.getByTestId('transfer-card-select-inst-1'))

    getViewport.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Přesunout vojska \(1\)/ }))

    await waitFor(() => expect(startTransfer).toHaveBeenCalledWith(1, mockTerritory(128, 128).id, ['inst-1']))
    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(121, 121, 135, 135))
    expect(screen.getByTestId('movements-refresh-key')).toHaveTextContent('1')
  })

  it('closes the garrison popup when the close button is clicked', async () => {
    getCardInstancesAtTerritory.mockResolvedValueOnce({ data: [], error: null })
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Území 128,128' }))
    await waitFor(() => expect(screen.getByTestId('garrison-modal')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Zavřít' }))
    expect(screen.queryByTestId('garrison-modal')).not.toBeInTheDocument()
  })

  it('passes the player-owned territories into the incoming-battle channel', async () => {
    sessionUser = { id: 'me' }
    getMyTerritories.mockResolvedValueOnce({
      data: [
        { id: 11, x: 10, y: 20, is_home: true, castle_rank: null, village_rank: null, name: null, battle_locked_by: null },
        { id: 12, x: 30, y: 40, is_home: false, castle_rank: null, village_rank: 'common', name: 'Pevnost', battle_locked_by: null },
      ],
      error: null,
    })

    render(<MapPage />)

    const { useMyTerritoriesBattleChannel } = jest.requireMock('@/lib/battles/useMyTerritoriesBattleChannel')
    await waitFor(() =>
      expect(useMyTerritoriesBattleChannel).toHaveBeenCalledWith(
        [
          expect.objectContaining({ id: 11, x: 10, y: 20 }),
          expect.objectContaining({ id: 12, x: 30, y: 40 }),
        ],
        expect.any(Function)
      )
    )
  })

  it('shows an incoming attack banner and navigates to the resolved battle from it', async () => {
    sessionUser = { id: 'me' }
    let incomingBattleCallback: ((update: { territoryId: number; battleLockedBy: string }) => void | Promise<void>) | null = null
    const { useMyTerritoriesBattleChannel } = jest.requireMock('@/lib/battles/useMyTerritoriesBattleChannel')
    useMyTerritoriesBattleChannel.mockImplementation(
      (_territories: unknown, onIncomingBattle: (update: { territoryId: number; battleLockedBy: string }) => void | Promise<void>) => {
        incomingBattleCallback = onIncomingBattle
      }
    )
    getMyTerritories.mockResolvedValueOnce({
      data: [
        { id: 99, x: 12, y: 34, is_home: false, castle_rank: null, village_rank: null, name: null, battle_locked_by: null },
      ],
      error: null,
    })
    getActiveBattleForTerritory.mockResolvedValueOnce({ data: { id: 'battle-99' }, error: null })

    render(<MapPage />)

    await waitFor(() => expect(incomingBattleCallback).not.toBeNull())
    await act(async () => {
      await incomingBattleCallback?.({ territoryId: 99, battleLockedBy: 'enemy-1' })
    })

    expect(await screen.findByText('Vaše území (12, 34) bylo napadeno!')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Přejít do bitvy' }))
    expect(routerPush).toHaveBeenCalledWith('/battles/battle-99')
  })

  it('lets the player dismiss an incoming attack banner without navigating', async () => {
    sessionUser = { id: 'me' }
    let incomingBattleCallback: ((update: { territoryId: number; battleLockedBy: string }) => void | Promise<void>) | null = null
    const { useMyTerritoriesBattleChannel } = jest.requireMock('@/lib/battles/useMyTerritoriesBattleChannel')
    useMyTerritoriesBattleChannel.mockImplementation(
      (_territories: unknown, onIncomingBattle: (update: { territoryId: number; battleLockedBy: string }) => void | Promise<void>) => {
        incomingBattleCallback = onIncomingBattle
      }
    )
    getMyTerritories.mockResolvedValueOnce({
      data: [
        { id: 101, x: 50, y: 60, is_home: true, castle_rank: null, village_rank: null, name: 'Domov', battle_locked_by: null },
      ],
      error: null,
    })
    getActiveBattleForTerritory.mockResolvedValueOnce({ data: { id: 'battle-101' }, error: null })

    render(<MapPage />)

    await waitFor(() => expect(incomingBattleCallback).not.toBeNull())
    await act(async () => {
      await incomingBattleCallback?.({ territoryId: 101, battleLockedBy: 'enemy-2' })
    })

    expect(await screen.findByText('Vaše území Domov (50, 60) bylo napadeno!')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Zavřít upozornění na útok na území Domov (50, 60)' }))

    await waitFor(() =>
      expect(screen.queryByText('Vaše území Domov (50, 60) bylo napadeno!')).not.toBeInTheDocument()
    )
    expect(routerPush).not.toHaveBeenCalled()
  })
})
