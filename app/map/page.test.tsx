import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MapPage from './page'

const routerPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
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
  ...overrides,
})

const getViewport = jest.fn().mockResolvedValue({
  data: [mockTerritory(128, 128, { is_home: true, owner_id: 'me' })],
  error: null,
})
const getMinimapOverview = jest.fn().mockResolvedValue({ data: [], error: null })
const getCardInstancesAtTerritory = jest.fn().mockResolvedValue({ data: [], error: null })
const getMyHomeTerritory = jest.fn().mockResolvedValue({ data: [], error: null })
const getIncomingAttackArrival = jest.fn().mockResolvedValue({ data: null, error: null })
const getPlayerPublicInfo = jest.fn().mockResolvedValue({ data: null, error: null })
const getMyTerritories = jest.fn().mockResolvedValue({ data: [], error: null })
const startTransfer = jest.fn().mockResolvedValue({ data: null, error: null })
const getMyMovements = jest.fn().mockResolvedValue({ data: [], error: null })
const getTerritoriesByIds = jest.fn().mockResolvedValue({ data: [], error: null })
const getMyActiveBattles = jest.fn().mockResolvedValue({ data: [], error: null })
const getMyRecentlyResolvedBattles = jest.fn().mockResolvedValue({ data: [], error: null })

jest.mock('@/lib/territories/api', () => ({
  getViewport: (...args: unknown[]) => getViewport(...args),
  getMinimapOverview: (...args: unknown[]) => getMinimapOverview(...args),
  getCardInstancesAtTerritory: (...args: unknown[]) => getCardInstancesAtTerritory(...args),
  getMyHomeTerritory: (...args: unknown[]) => getMyHomeTerritory(...args),
  getIncomingAttackArrival: (...args: unknown[]) => getIncomingAttackArrival(...args),
  getPlayerPublicInfo: (...args: unknown[]) => getPlayerPublicInfo(...args),
  getMyTerritories: (...args: unknown[]) => getMyTerritories(...args),
  startTransfer: (...args: unknown[]) => startTransfer(...args),
  getMyMovements: (...args: unknown[]) => getMyMovements(...args),
  getTerritoriesByIds: (...args: unknown[]) => getTerritoriesByIds(...args),
  getMyActiveBattles: (...args: unknown[]) => getMyActiveBattles(...args),
  getMyRecentlyResolvedBattles: (...args: unknown[]) => getMyRecentlyResolvedBattles(...args),
}))

let sessionUser: { id: string } | null = null
jest.mock('@/lib/supabase/useSession', () => ({
  useSession: () => ({ user: sessionUser, player: null, loading: false }),
}))

jest.mock('@/lib/battles/api', () => ({
  declareAttack: jest.fn().mockResolvedValue({ data: null, error: null }),
}))

jest.mock('@/lib/battles/useTerritoryBattleChannel', () => ({
  useTerritoryBattleChannel: jest.fn(),
}))

jest.mock('@/components/territories/MyMovementsPanel', () => ({
  __esModule: true,
  default: ({ refreshKey }: { refreshKey?: number }) => <div data-testid="movements-refresh-key">{refreshKey ?? 0}</div>,
}))

describe('MapPage', () => {
  beforeEach(() => {
    getViewport.mockReset()
    getViewport.mockResolvedValue({
      data: [mockTerritory(128, 128, { is_home: true, owner_id: 'me' })],
      error: null,
    })
    getCardInstancesAtTerritory.mockReset()
    getCardInstancesAtTerritory.mockResolvedValue({ data: [], error: null })
    getMyHomeTerritory.mockReset()
    getMyHomeTerritory.mockResolvedValue({ data: [], error: null })
    getIncomingAttackArrival.mockReset()
    getIncomingAttackArrival.mockResolvedValue({ data: null, error: null })
    getPlayerPublicInfo.mockClear()
    getMyTerritories.mockReset()
    getMyTerritories.mockResolvedValue({ data: [], error: null })
    startTransfer.mockReset()
    startTransfer.mockResolvedValue({ data: null, error: null })
    sessionUser = null
  })

  it('renders the back-link and loads a viewport centered on (128,128)', async () => {
    render(<MapPage />)

    expect(screen.getByRole('link', { name: /Domů/ })).toHaveAttribute('href', '/')

    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    expect(getViewport).toHaveBeenCalledWith(121, 121, 135, 135)
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
    getMyHomeTerritory.mockResolvedValueOnce({ data: [{ id: 1, x: 10, y: 20 }], error: null })
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    getViewport.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Moje domovské území/ }))

    await waitFor(() => expect(getMyHomeTerritory).toHaveBeenCalled())
    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(3, 13, 17, 27))
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

    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Území 128,128' }))

    await waitFor(() => expect(getPlayerPublicInfo).toHaveBeenCalledWith('other-player'))
    expect(await screen.findByText(/Jméno:\s*Sir Testalot/)).toBeInTheDocument()
  })

  it('opens the transfer modal for an owned territory and refreshes after a successful transfer', async () => {
    sessionUser = { id: 'me' }
    getCardInstancesAtTerritory.mockResolvedValueOnce({ data: [], error: null })
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
    fireEvent.click(screen.getAllByText('Lučištníci')[0].closest('label')!)

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
})
