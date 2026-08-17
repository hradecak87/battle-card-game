import { render, screen, waitFor } from '@testing-library/react'
import MyMovementsPanel from './MyMovementsPanel'

const getMyMovements = jest.fn()
const getTerritoriesByIds = jest.fn()
const getMyActiveBattles = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getMyMovements: (...args: unknown[]) => getMyMovements(...args),
  getTerritoriesByIds: (...args: unknown[]) => getTerritoriesByIds(...args),
  getMyActiveBattles: (...args: unknown[]) => getMyActiveBattles(...args),
}))

describe('MyMovementsPanel', () => {
  beforeEach(() => {
    getMyMovements.mockReset()
    getTerritoriesByIds.mockReset()
    getMyActiveBattles.mockReset()
    getTerritoriesByIds.mockResolvedValue({ data: [], error: null })
    getMyActiveBattles.mockResolvedValue({ data: [], error: null })
  })

  it('renders nothing when there is no logged-in player', () => {
    const { container } = render(<MyMovementsPanel myPlayerId={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the player has no in-progress movements', async () => {
    getMyMovements.mockResolvedValue({ data: [], error: null })
    const { container } = render(<MyMovementsPanel myPlayerId="me" />)
    await waitFor(() => expect(getMyMovements).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('lists an in-progress movement with its origin/destination coordinates and ETA', async () => {
    getMyMovements.mockResolvedValue({
      data: [
        {
          id: 'm1',
          player_id: 'me',
          kind: 'attack',
          origin_territory_id: 80,
          destination_territory_id: 81,
          started_at: new Date().toISOString(),
          transfer_arrives_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          status: 'in_transit',
          cancelled_at: null,
        },
      ],
      error: null,
    })
    getTerritoriesByIds.mockResolvedValue({
      data: [
        { id: 80, x: 0, y: 79 },
        { id: 81, x: 1, y: 79 },
      ],
      error: null,
    })

    render(<MyMovementsPanel myPlayerId="me" />)

    expect(await screen.findByText('Moje probíhající akce')).toBeInTheDocument()
    expect(screen.getByText(/\(0, 79\)/)).toBeInTheDocument()
    expect(screen.getByText(/\(1, 79\)/)).toBeInTheDocument()
    expect(screen.getByText(/za 10 min/)).toBeInTheDocument()
  })

  it('shows a link to the battle screen once the attack has resolved into an active battle', async () => {
    getMyMovements.mockResolvedValue({
      data: [
        {
          id: 'm1',
          player_id: 'me',
          kind: 'attack',
          origin_territory_id: 80,
          destination_territory_id: 81,
          started_at: new Date().toISOString(),
          transfer_arrives_at: new Date(Date.now() - 1000).toISOString(),
          status: 'in_transit',
          cancelled_at: null,
        },
      ],
      error: null,
    })
    getTerritoriesByIds.mockResolvedValue({
      data: [
        { id: 80, x: 0, y: 79 },
        { id: 81, x: 1, y: 79 },
      ],
      error: null,
    })
    getMyActiveBattles.mockResolvedValue({ data: [{ id: 'battle-1', territory_id: 81 }], error: null })

    render(<MyMovementsPanel myPlayerId="me" />)

    const link = await screen.findByText('Bitva probíhá →')
    expect(link.closest('a')).toHaveAttribute('href', '/battles/battle-1')
  })

  it('uses the territory occupation-completion time (not the transfer time) as ETA for an in-progress claim', async () => {
    getMyMovements.mockResolvedValue({
      data: [
        {
          id: 'm1',
          player_id: 'me',
          kind: 'claim',
          origin_territory_id: 80,
          destination_territory_id: 81,
          started_at: new Date().toISOString(),
          // Troops already arrived at the empty territory (short transfer)...
          transfer_arrives_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          status: 'occupying',
          cancelled_at: null,
        },
      ],
      error: null,
    })
    getTerritoriesByIds.mockResolvedValue({
      data: [
        { id: 80, x: 0, y: 79, claim_occupation_completes_at: null },
        // ...but the occupation itself still needs ~22h more.
        { id: 81, x: 1, y: 79, claim_occupation_completes_at: new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString() },
      ],
      error: null,
    })

    render(<MyMovementsPanel myPlayerId="me" />)

    expect(await screen.findByText(/za 22 h/)).toBeInTheDocument()
    expect(screen.queryByText('Již brzy')).not.toBeInTheDocument()
  })

  it('shows an error message when the movements query fails', async () => {
    getMyMovements.mockResolvedValue({ data: null, error: { message: 'boom' } })
    render(<MyMovementsPanel myPlayerId="me" />)
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
