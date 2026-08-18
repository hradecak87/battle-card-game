import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import DeclareAttackModal from './DeclareAttackModal'
import { Territory } from '@/lib/territories/api'

const getCardInstancesAtTerritory = jest.fn()
const getMyTerritories = jest.fn()
const getPlayerPublicInfo = jest.fn()
const getTerritoryNeighborOwners = jest.fn()
const declareAttack = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getCardInstancesAtTerritory: (...args: unknown[]) => getCardInstancesAtTerritory(...args),
  getMyTerritories: (...args: unknown[]) => getMyTerritories(...args),
  getPlayerPublicInfo: (...args: unknown[]) => getPlayerPublicInfo(...args),
  getTerritoryNeighborOwners: (...args: unknown[]) => getTerritoryNeighborOwners(...args),
}))

jest.mock('@/lib/battles/api', () => ({
  declareAttack: (...args: unknown[]) => declareAttack(...args),
}))

const territory: Territory = {
  id: 99,
  x: 5,
  y: 5,
  difficulty: 3,
  castle_rank: null,
  village_rank: null,
  owner_id: 'other-player',
  is_home: false,
  claim_locked_by: null,
  claim_started_at: null,
  claim_transfer_arrives_at: null,
  claim_occupation_completes_at: null,
  battle_locked_by: null,
  name: null,
}

const myCard = {
  instance_id: 'inst-1',
  template_id: 'tmpl-1',
  owner_id: 'me',
  stationed_territory_id: 1,
  status: 'stationed' as const,
  card_templates: {
    id: 'tmpl-1',
    name: 'Elitní rytíři',
    flavor_text: 'Silná jízda.',
    rank: 'rare',
    category: 'unit' as const,
    unit_type: 'knights',
    base_stats: { str: 20, lng: 5, def: 15, hp: 30 },
    total_supply: null,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('DeclareAttackModal', () => {
  beforeEach(() => {
    getCardInstancesAtTerritory.mockReset()
    getMyTerritories.mockReset()
    getPlayerPublicInfo.mockReset()
    getPlayerPublicInfo.mockResolvedValue({ data: null, error: null })
    getTerritoryNeighborOwners.mockReset()
    getTerritoryNeighborOwners.mockResolvedValue({ data: [null, null, null, null], error: null })
    getCardInstancesAtTerritory.mockResolvedValue({ data: [], error: null })
    getMyTerritories.mockResolvedValue({
      data: [{ id: 1, x: 0, y: 0, is_home: true }],
      error: null,
    })
    declareAttack.mockReset()
  })

  it('loads origin cards, selects one, and calls declareAttack', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })
    declareAttack.mockResolvedValue({ data: 'movement-1', error: null })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} onDeclared={jest.fn()} />)

    fireEvent.change(await screen.findByLabelText('Odkud útočíš'), { target: { value: '1' } })

    await waitFor(() => expect(getCardInstancesAtTerritory).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Elitní rytíři')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))
    const submit = screen.getByRole('button', { name: /Zaútočit/ })
    fireEvent.click(submit)

    await waitFor(() => expect(declareAttack).toHaveBeenCalledWith(1, 99, ['inst-1']))
    expect(await screen.findByText(/Útok vyslán/)).toBeInTheDocument()
  })

  it('surfaces declare_attack errors inline', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })
    declareAttack.mockResolvedValue({ data: null, error: { message: 'territory ownership cap (32) reached' } })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.change(await screen.findByLabelText('Odkud útočíš'), { target: { value: '1' } })
    await screen.findByText('Elitní rytíři')

    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))
    fireEvent.click(screen.getByRole('button', { name: /Zaútočit/ }))

    expect(await screen.findByText('territory ownership cap (32) reached')).toBeInTheDocument()
  })

  it('hides the attack form and shows a message when the target is surrounded by the same owner (backlog #10)', async () => {
    getTerritoryNeighborOwners.mockResolvedValue({
      data: ['other-player', 'other-player', 'other-player', 'other-player'],
      error: null,
    })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    expect(await screen.findByTestId('declare-attack-unreachable')).toHaveTextContent(
      'Toto území je obklíčeno nepřátelským územím'
    )
    expect(screen.queryByLabelText('Odkud útočíš')).not.toBeInTheDocument()
  })

  it('allows attacking a territory with at least one differing neighbor (backlog #10)', async () => {
    getTerritoryNeighborOwners.mockResolvedValue({
      data: ['other-player', 'other-player', 'other-player', null],
      error: null,
    })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    expect(await screen.findByLabelText('Odkud útočíš')).toBeInTheDocument()
    expect(screen.queryByTestId('declare-attack-unreachable')).not.toBeInTheDocument()
  })

  it('lists the caller\'s own territories in the origin dropdown, home first', async () => {
    getMyTerritories.mockResolvedValue({
      data: [
        { id: 1, x: 0, y: 0, is_home: true },
        { id: 2, x: 3, y: 4, is_home: false },
      ],
      error: null,
    })
    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    const select = (await screen.findByLabelText('Odkud útočíš')) as HTMLSelectElement
    await waitFor(() => expect(getMyTerritories).toHaveBeenCalledWith('me'))
    const options = Array.from(select.options).map((o) => o.textContent)
    expect(options).toEqual(['— vyber území —', 'Domov (0, 0)', 'Území (3, 4)'])
  })

  it('renders the defender structure bonus panel when the target has castle and village', async () => {
    render(
      <DeclareAttackModal
        territory={{ ...territory, castle_rank: 'rare', village_rank: 'common' }}
        myPlayerId="me"
        onClose={jest.fn()}
      />
    )

    expect(await screen.findByTestId('declare-attack-structure-bonuses')).toBeInTheDocument()
    expect(screen.getByText('Bonusy obránce na tomto území')).toBeInTheDocument()
    expect(screen.getByText('Hrad (rare): +55 % obrana, +35 % útok zblízka i na dálku')).toBeInTheDocument()
    expect(screen.getByText('Vesnice (common): +10 % obrana')).toBeInTheDocument()
    expect(screen.getByText('Celkem pro obránce: +65 % obrana, +35 % útok zblízka i na dálku')).toBeInTheDocument()
  })

  it('does not render the defender structure bonus panel when the target has no structures', async () => {
    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    await screen.findByLabelText('Odkud útočíš')
    expect(screen.queryByTestId('declare-attack-structure-bonuses')).not.toBeInTheDocument()
  })

  it('ignores stale origin loads when the player quickly switches origin territory', async () => {
    const first = deferred<{ data: typeof myCard[]; error: null }>()
    const second = deferred<{ data: typeof myCard[]; error: null }>()
    getMyTerritories.mockResolvedValue({
      data: [
        { id: 1, x: 0, y: 0, is_home: true },
        { id: 2, x: 3, y: 4, is_home: false },
      ],
      error: null,
    })
    getCardInstancesAtTerritory
      .mockResolvedValueOnce({ data: [], error: null }) // defender-garrison fetch on mount
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    const select = await screen.findByLabelText('Odkud útočíš')
    fireEvent.change(select, { target: { value: '1' } })
    fireEvent.change(select, { target: { value: '2' } })

    second.resolve({
      data: [
        {
          ...myCard,
          instance_id: 'inst-2',
          card_templates: { ...myCard.card_templates, name: 'Jezdci z druhé državy' },
        },
      ],
      error: null,
    })
    first.resolve({ data: [myCard], error: null })

    expect(await screen.findByText('Jezdci z druhé državy')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Elitní rytíři')).not.toBeInTheDocument())
  })

  it('clears the loading state if the player deselects the origin while units are still loading', async () => {
    const pending = deferred<{ data: typeof myCard[]; error: null }>()
    getCardInstancesAtTerritory
      .mockResolvedValueOnce({ data: [], error: null }) // defender-garrison fetch on mount
      .mockReturnValueOnce(pending.promise)

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    const select = await screen.findByLabelText('Odkud útočíš')
    fireEvent.change(select, { target: { value: '1' } })
    expect(await screen.findByText('Načítám vojska…')).toBeInTheDocument()

    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => expect(screen.queryByText('Načítám vojska…')).not.toBeInTheDocument())
  })

  it('opens zoom from the corner button without toggling selection, while card-body clicks still toggle selection', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.change(await screen.findByLabelText('Odkud útočíš'), { target: { value: '1' } })
    await screen.findByText('Elitní rytíři')

    fireEvent.click(screen.getByRole('button', { name: 'Zvětšit kartu Elitní rytíři' }))
    expect(screen.getByTestId('card-zoom-modal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Zaútočit \(0 vojsk\)/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Zavřít detail karty' }))
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))

    expect(screen.getByTestId('declare-attack-card-select-inst-1')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Zaútočit \(1 vojsk\)/ })).toBeEnabled()
  })

  it('shows an ETA once an origin territory is picked', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.change(await screen.findByLabelText('Odkud útočíš'), { target: { value: '1' } })

    expect(await screen.findByTestId('declare-attack-eta')).toBeInTheDocument()
  })

  it('shows an army-strength comparison once attacker cards are selected', async () => {
    getCardInstancesAtTerritory.mockImplementation((id: number) =>
      Promise.resolve({ data: id === territory.id ? [] : [myCard], error: null })
    )

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.change(await screen.findByLabelText('Odkud útočíš'), { target: { value: '1' } })
    await screen.findByText('Elitní rytíři')
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))

    // Empty defender garrison means a guaranteed strong advantage.
    expect(await screen.findByTestId('declare-attack-army-strength')).toHaveTextContent('Silná výhoda')
  })
})
