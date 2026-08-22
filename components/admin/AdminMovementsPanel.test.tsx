import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminMovementsPanel from './AdminMovementsPanel'

const getAdminMovements = jest.fn()
const adminSpeedUpMovement = jest.fn()

jest.mock('@/lib/admin/api', () => ({
  getAdminMovements: (...args: unknown[]) => getAdminMovements(...args),
  adminSpeedUpMovement: (...args: unknown[]) => adminSpeedUpMovement(...args),
}))

const movements = [
  {
    id: 'mov-1',
    player_id: 'player-1',
    player_display_name: 'Král Artuš',
    player_is_npc: false,
    kind: 'transfer',
    origin_territory_id: 10,
    origin_x: 5,
    origin_y: 6,
    destination_territory_id: 11,
    destination_x: 7,
    destination_y: 8,
    started_at: new Date().toISOString(),
    transfer_arrives_at: new Date(Date.now() + 60000).toISOString(),
    status: 'in_transit',
    claim_occupation_completes_at: null,
    cancelled_at: null,
    unit_count: 3,
  },
  {
    id: 'mov-2',
    player_id: 'npc-1',
    player_display_name: 'NPC Království',
    player_is_npc: true,
    kind: 'claim',
    origin_territory_id: 20,
    origin_x: 1,
    origin_y: 2,
    destination_territory_id: 21,
    destination_x: 3,
    destination_y: 4,
    started_at: new Date().toISOString(),
    transfer_arrives_at: new Date(Date.now() + 120000).toISOString(),
    status: 'in_transit',
    claim_occupation_completes_at: null,
    cancelled_at: null,
    unit_count: 5,
  },
  {
    id: 'mov-3',
    player_id: 'player-2',
    player_display_name: 'Karel',
    player_is_npc: false,
    kind: 'attack',
    origin_territory_id: 30,
    origin_x: 9,
    origin_y: 10,
    destination_territory_id: 31,
    destination_x: 11,
    destination_y: 12,
    started_at: new Date().toISOString(),
    transfer_arrives_at: new Date(Date.now() - 1000).toISOString(),
    status: 'completed',
    claim_occupation_completes_at: null,
    cancelled_at: null,
    unit_count: 2,
  },
]

describe('AdminMovementsPanel', () => {
  beforeEach(() => {
    getAdminMovements.mockReset()
    adminSpeedUpMovement.mockReset()
    // Return only active movements by default
    getAdminMovements.mockImplementation((includeHistory: boolean) =>
      Promise.resolve({
        data: includeHistory ? movements : movements.filter((m) => ['in_transit', 'occupying'].includes(m.status)),
        error: null,
      })
    )
    adminSpeedUpMovement.mockResolvedValue({ data: null, error: null })
  })

  it('renders a row per active movement with player name, kind label, origin/destination, status', async () => {
    render(<AdminMovementsPanel />)

    expect(await screen.findByText('Král Artuš')).toBeInTheDocument()
    expect(screen.getByText('NPC Království')).toBeInTheDocument()
    expect(screen.getByText('Přesun')).toBeInTheDocument()
    expect(screen.getByText('Zabírání')).toBeInTheDocument()
    // Coords
    expect(screen.getByText(/5.*6/)).toBeInTheDocument()
  })

  it('shows NPC badge for NPC player rows', async () => {
    render(<AdminMovementsPanel />)
    expect(await screen.findByText('NPC')).toBeInTheDocument()
  })

  it('Vše/Jen NPC/Jen hráči toggle filters rows client-side', async () => {
    const user = userEvent.setup()
    render(<AdminMovementsPanel />)
    await screen.findByText('Král Artuš')

    // Click "Jen NPC"
    await user.click(screen.getByRole('button', { name: 'Jen NPC' }))
    expect(screen.queryByText('Král Artuš')).not.toBeInTheDocument()
    expect(screen.getByText('NPC Království')).toBeInTheDocument()

    // Click "Jen hráči"
    await user.click(screen.getByRole('button', { name: 'Jen hráči' }))
    expect(screen.getByText('Král Artuš')).toBeInTheDocument()
    expect(screen.queryByText('NPC Království')).not.toBeInTheDocument()

    // Back to Vše
    await user.click(screen.getByRole('button', { name: 'Vše' }))
    expect(screen.getByText('Král Artuš')).toBeInTheDocument()
    expect(screen.getByText('NPC Království')).toBeInTheDocument()
  })

  it('player-name search filters rows client-side (case-insensitive)', async () => {
    const user = userEvent.setup()
    render(<AdminMovementsPanel />)
    await screen.findByText('Král Artuš')

    await user.type(screen.getByPlaceholderText(/hráč/i), 'artuš')
    expect(screen.getByText('Král Artuš')).toBeInTheDocument()
    expect(screen.queryByText('NPC Království')).not.toBeInTheDocument()
  })

  it('toggling "Zobrazit i dokončené/zrušené" calls getAdminMovements with includeHistory=true', async () => {
    const user = userEvent.setup()
    render(<AdminMovementsPanel />)
    await screen.findByText('Král Artuš')

    await user.click(screen.getByLabelText(/dokončené/i))
    await waitFor(() => expect(getAdminMovements).toHaveBeenCalledWith(true))
  })

  it('speed-up icon calls adminSpeedUpMovement and refetches', async () => {
    const user = userEvent.setup()
    render(<AdminMovementsPanel />)
    await screen.findByText('Král Artuš')

    await user.click(screen.getAllByRole('button', { name: /Urychlit na 10s/i })[0])
    await waitFor(() => expect(adminSpeedUpMovement).toHaveBeenCalledWith('mov-1'))
    await waitFor(() => expect(getAdminMovements).toHaveBeenCalledTimes(2))
  })

  it('speed-up icon is absent for completed rows', async () => {
    const user = userEvent.setup()
    render(<AdminMovementsPanel />)
    await screen.findByText('Král Artuš')

    // Toggle history to show completed row
    await user.click(screen.getByLabelText(/dokončené/i))
    await screen.findByText('Karel')

    const speedUpButtons = screen.queryAllByRole('button', { name: /Urychlit na 10s/i })
    // Only 2 active rows (mov-1, mov-2) should have speed-up buttons; mov-3 (completed) should not
    expect(speedUpButtons.length).toBe(2)
  })
})
