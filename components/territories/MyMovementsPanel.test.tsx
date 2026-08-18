import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MyMovementsPanel from './MyMovementsPanel'

const getMyMovements = jest.fn()
const getTerritoriesByIds = jest.fn()
const getMyActiveBattles = jest.fn()
const getMyRecentlyResolvedBattles = jest.fn()
const debugSpeedUpMovement = jest.fn()
const getIncomingReinforcements = jest.fn()
const getLastSeenRound = jest.fn()
const recallAttack = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getMyMovements: (...args: unknown[]) => getMyMovements(...args),
  getTerritoriesByIds: (...args: unknown[]) => getTerritoriesByIds(...args),
  getMyActiveBattles: (...args: unknown[]) => getMyActiveBattles(...args),
  getMyRecentlyResolvedBattles: (...args: unknown[]) => getMyRecentlyResolvedBattles(...args),
  debugSpeedUpMovement: (...args: unknown[]) => debugSpeedUpMovement(...args),
  getIncomingReinforcements: (...args: unknown[]) => getIncomingReinforcements(...args),
}))

jest.mock('@/lib/battles/api', () => ({
  recallAttack: (...args: unknown[]) => recallAttack(...args),
}))

jest.mock('@/lib/battles/lastSeenRound', () => ({
  getLastSeenRound: (...args: unknown[]) => getLastSeenRound(...args),
}))

describe('MyMovementsPanel', () => {
  beforeEach(() => {
    getMyMovements.mockReset()
    getTerritoriesByIds.mockReset()
    getMyActiveBattles.mockReset()
    getMyRecentlyResolvedBattles.mockReset()
    debugSpeedUpMovement.mockReset()
    getIncomingReinforcements.mockReset()
    getLastSeenRound.mockReset()
    recallAttack.mockReset()
    getTerritoriesByIds.mockResolvedValue({ data: [], error: null })
    getMyActiveBattles.mockResolvedValue({ data: [], error: null })
    getMyRecentlyResolvedBattles.mockResolvedValue({ data: [], error: null })
    getIncomingReinforcements.mockResolvedValue({ data: [], error: null })
    getLastSeenRound.mockReturnValue(0)
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

  it('shows a link to view results for a recently resolved (e.g. instant NPC) battle not yet viewed', async () => {
    getMyMovements.mockResolvedValue({ data: [], error: null })
    getMyRecentlyResolvedBattles.mockResolvedValue({
      data: [{ id: 'battle-npc-1', territory_id: 83, current_round: 164, resolved_at: new Date().toISOString() }],
      error: null,
    })
    getLastSeenRound.mockReturnValue(0)

    render(<MyMovementsPanel myPlayerId="me" />)

    const link = await screen.findByText('Zobrazit výsledek →')
    expect(link.closest('a')).toHaveAttribute('href', '/battles/battle-npc-1')
    expect(screen.getByText(/území 83/)).toBeInTheDocument()
  })

  it('hides a recently resolved battle once its rounds have already been fully viewed', async () => {
    getMyMovements.mockResolvedValue({ data: [], error: null })
    getMyRecentlyResolvedBattles.mockResolvedValue({
      data: [{ id: 'battle-npc-1', territory_id: 83, current_round: 164, resolved_at: new Date().toISOString() }],
      error: null,
    })
    getLastSeenRound.mockReturnValue(164)

    const { container } = render(<MyMovementsPanel myPlayerId="me" />)
    await waitFor(() => expect(getMyRecentlyResolvedBattles).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('calls debugSpeedUpMovement and refetches when the test speed-up button is clicked', async () => {
    const user = userEvent.setup()
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
    debugSpeedUpMovement.mockResolvedValue({ error: null })

    render(<MyMovementsPanel myPlayerId="me" />)

    const button = await screen.findByRole('button', { name: /10s \(test\)/ })
    await user.click(button)

    await waitFor(() => expect(debugSpeedUpMovement).toHaveBeenCalledWith('m1'))
    await waitFor(() => expect(getMyMovements).toHaveBeenCalledTimes(2))
  })

  it('shows a warning when a defender reinforcement will arrive before an in-transit attack (backlog #23)', async () => {
    const attackArrivesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const reinforcementArrivesAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    getMyMovements.mockResolvedValue({
      data: [
        {
          id: 'm1',
          player_id: 'me',
          kind: 'attack',
          origin_territory_id: 80,
          destination_territory_id: 81,
          started_at: new Date().toISOString(),
          transfer_arrives_at: attackArrivesAt,
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
    getIncomingReinforcements.mockResolvedValue({
      data: [{ destination_territory_id: 81, transfer_arrives_at: reinforcementArrivesAt }],
      error: null,
    })

    render(<MyMovementsPanel myPlayerId="me" />)

    expect(await screen.findByTestId('reinforcement-warning-m1')).toHaveTextContent(
      'Obránce posílá posily, dorazí dřív než tvá vojska!'
    )
    expect(getIncomingReinforcements).toHaveBeenCalledWith([81])
  })

  it('does not show a reinforcement warning when the incoming reinforcement arrives after the attack', async () => {
    const attackArrivesAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const reinforcementArrivesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    getMyMovements.mockResolvedValue({
      data: [
        {
          id: 'm1',
          player_id: 'me',
          kind: 'attack',
          origin_territory_id: 80,
          destination_territory_id: 81,
          started_at: new Date().toISOString(),
          transfer_arrives_at: attackArrivesAt,
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
    getIncomingReinforcements.mockResolvedValue({
      data: [{ destination_territory_id: 81, transfer_arrives_at: reinforcementArrivesAt }],
      error: null,
    })

    render(<MyMovementsPanel myPlayerId="me" />)

    await screen.findByText(/za 10 min/)
    expect(screen.queryByTestId('reinforcement-warning-m1')).not.toBeInTheDocument()
  })

  it('lets the player recall an in-transit attack and refetches movements', async () => {
    const user = userEvent.setup()
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
    recallAttack.mockResolvedValue({ error: null })

    render(<MyMovementsPanel myPlayerId="me" />)

    const button = await screen.findByTestId('recall-attack-m1')
    await user.click(button)

    await waitFor(() => expect(recallAttack).toHaveBeenCalledWith('m1'))
    await waitFor(() => expect(getMyMovements).toHaveBeenCalledTimes(2))
  })

  it('does not show a recall button once the attack has resolved into an active battle', async () => {
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

    await screen.findByText('Bitva probíhá →')
    expect(screen.queryByTestId('recall-attack-m1')).not.toBeInTheDocument()
  })
})
