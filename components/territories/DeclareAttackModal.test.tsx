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
  declareAttack: (...args: unknown[]) => declareAttack(...args),
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
  wall_rank: null,
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
    base_stats: { str: 20, lng: 5, def: 15, hp: 30, speed: 6 },
    total_supply: null,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    boost_type: null,
    effect_kind: null,
    instant_effect_kind: null,
    pct_str: null,
    pct_lng: null,
    pct_def: null,
    pct_hp: null,
  },
}

const mySecondCard = {
  ...myCard,
  instance_id: 'inst-2',
  stationed_territory_id: 2,
  card_templates: {
    ...myCard.card_templates,
    id: 'tmpl-2',
    name: 'Hraničáři z druhé državy',
    base_stats: { str: 12, lng: 11, def: 8, hp: 14, speed: 3 },
  },
}

const offensiveBoost = {
  instance_id: 'boost-1',
  template_id: 'boost-offensive-1',
  owner_id: 'me',
  stationed_territory_id: 1,
  status: 'stationed' as const,
  card_templates: {
    id: 'boost-offensive-1',
    name: 'Praporec dravců',
    flavor_text: 'Útočící vojsko žene vpřed.',
    rank: 'rare',
    category: 'boost' as const,
    unit_type: null,
    base_stats: null,
    total_supply: 12,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    boost_type: 'offensive',
    effect_kind: 'stat_multiplier',
    instant_effect_kind: null,
    pct_str: 12,
    pct_lng: null,
    pct_def: null,
    pct_hp: 6,
  },
}

const maskedDefenderBoost = {
  ...offensiveBoost,
  instance_id: 'boost-foreign-1',
  owner_id: 'other-player',
  stationed_territory_id: territory.id,
  card_templates: {
    ...offensiveBoost.card_templates,
    name: null,
    flavor_text: null,
    rank: 'epic',
    boost_type: null,
    effect_kind: null,
    instant_effect_kind: null,
    pct_str: null,
    pct_lng: null,
    pct_def: null,
    pct_hp: null,
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

  it('loads cards from multiple selected origins and calls declareAttack with grouped payload', async () => {
    getMyTerritories.mockResolvedValue({
      data: [
        { id: 1, x: 0, y: 0, is_home: true },
        { id: 2, x: 3, y: 4, is_home: false },
      ],
      error: null,
    })
    getCardInstancesAtTerritory.mockImplementation((id: number) =>
      Promise.resolve({
        data: id === 1 ? [myCard, offensiveBoost] : id === 2 ? [mySecondCard] : [],
        error: null,
      })
    )
    declareAttack.mockResolvedValue({ data: 'movement-1', error: null })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} onDeclared={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-2'))

    await waitFor(() => expect(getCardInstancesAtTerritory).toHaveBeenCalledWith(1))
    await waitFor(() => expect(getCardInstancesAtTerritory).toHaveBeenCalledWith(2))
    expect(await screen.findByText('Elitní rytíři')).toBeInTheDocument()
    expect(await screen.findByText('Hraničáři z druhé državy')).toBeInTheDocument()
    expect(await screen.findByText('Praporec dravců')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-2'))
    fireEvent.click(screen.getByTestId('declare-attack-boost-select-boost-1'))
    const submit = screen.getByRole('button', { name: /Zaútočit/ })
    fireEvent.click(submit)

    await waitFor(() =>
      expect(declareAttack).toHaveBeenCalledWith(
        99,
        [
          { originTerritoryId: 1, cardInstanceIds: ['inst-1'] },
          { originTerritoryId: 2, cardInstanceIds: ['inst-2'] },
        ],
        'boost-1'
      )
    )
    expect(await screen.findByText(/Útok vyslán/)).toBeInTheDocument()
  })

  it('surfaces declare_attack errors inline', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })
    declareAttack.mockResolvedValue({ data: null, error: { message: 'territory ownership cap (32) reached' } })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
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

    expect(await screen.findByRole('button', { name: 'Odkud útočíš' })).toBeInTheDocument()
    expect(screen.queryByTestId('declare-attack-unreachable')).not.toBeInTheDocument()
  })

  it('lists the caller\'s own territories in the multi-check dropdown, home first', async () => {
    getMyTerritories.mockResolvedValue({
      data: [
        { id: 1, x: 0, y: 0, is_home: true },
        { id: 2, x: 3, y: 4, is_home: false },
      ],
      error: null,
    })
    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    await waitFor(() => expect(getMyTerritories).toHaveBeenCalledWith('me'))
    const options = screen
      .getAllByTestId(/^declare-attack-origin-option-/)
      .map((option) => option.textContent?.replace(/\s+/g, ' ').trim())
    expect(options).toEqual(['Domov (0, 0)', 'Území (3, 4)'])
  })

  it('keeps padding and stable scrollbar gutter around each attack card grid', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))

    const card = await screen.findByTestId('declare-attack-card-select-inst-1')
    const grid = card.closest('div.grid')

    expect(grid).not.toBeNull()
    expect(grid).toHaveClass('p-2', '[scrollbar-gutter:stable]')
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

    await screen.findByRole('button', { name: 'Odkud útočíš' })
    expect(screen.queryByTestId('declare-attack-structure-bonuses')).not.toBeInTheDocument()
  })

  it('renders the wall defense and ranged bonus preview without castle/village lines', async () => {
    render(
      <DeclareAttackModal
        territory={{ ...territory, wall_rank: 'epic' }}
        myPlayerId="me"
        onClose={jest.fn()}
      />
    )

    expect(await screen.findByTestId('declare-attack-structure-bonuses')).toBeInTheDocument()
    expect(screen.getByText('Hradby (epic): +27 % obrana, +27 % dálkový útok')).toBeInTheDocument()
    expect(screen.getByText('Celkem pro obránce: +27 % obrana, +0 % útok zblízka i na dálku')).toBeInTheDocument()
    expect(screen.queryByText(/^Hrad \(/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Vesnice \(/)).not.toBeInTheDocument()
  })

  it('clears the loading state if the player deselects the origin while units are still loading', async () => {
    const pending = deferred<{ data: typeof myCard[]; error: null }>()
    getCardInstancesAtTerritory
      .mockResolvedValueOnce({ data: [], error: null }) // defender-garrison fetch on mount
      .mockReturnValueOnce(pending.promise)

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    expect(await screen.findByText('Načítám vojska…')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    await waitFor(() => expect(screen.queryByText('Načítám vojska…')).not.toBeInTheDocument())
  })

  it('opens zoom from the corner button without toggling selection, while card-body clicks still toggle selection', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    await screen.findByText('Elitní rytíři')

    fireEvent.click(screen.getByRole('button', { name: 'Zvětšit kartu Elitní rytíři' }))
    expect(screen.getByTestId('card-zoom-modal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Zaútočit \(0 vojsk\)/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Zavřít detail karty' }))
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))

    expect(screen.getByTestId('declare-attack-card-select-inst-1')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Zaútočit \(1 vojsk\)/ })).toBeEnabled()
  })

  it('draws the selection ring exactly matching the card shape, not an oversized box around it', async () => {
    // Regression: the ring used to live on a separate wrapper div with
    // default (small) rounded corners and extra padding, so it stuck out
    // past the card's own rounded-xl corners. The ring must be on the same
    // rounded-xl element that renders the card.
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    await screen.findByText('Elitní rytíři')

    const card = screen.getByTestId('declare-attack-card-select-inst-1')
    expect(card).toHaveClass('rounded-xl')
    expect(card).not.toHaveClass('ring-2', 'ring-red-500')

    fireEvent.click(card)
    expect(card).toHaveClass('rounded-xl', 'ring-4', 'ring-red-500')
  })

  it('shows an ETA once an origin territory is picked', async () => {
    getCardInstancesAtTerritory.mockResolvedValue({ data: [myCard], error: null })

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))

    expect(await screen.findByTestId('declare-attack-eta')).toBeInTheDocument()
  })

  it('uses the slowest selected contingent for the shared ETA preview', async () => {
    getMyTerritories.mockResolvedValue({
      data: [
        { id: 1, x: 4, y: 5, is_home: true },
        { id: 2, x: 0, y: 0, is_home: false },
      ],
      error: null,
    })
    getCardInstancesAtTerritory.mockImplementation((id: number) =>
      Promise.resolve({
        data:
          id === 1
            ? [{ ...myCard, card_templates: { ...myCard.card_templates, base_stats: { str: 20, lng: 5, def: 15, hp: 30, speed: 10 } } }]
            : id === 2
              ? [mySecondCard]
              : [],
        error: null,
      })
    )

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    await screen.findByText('Elitní rytíři')
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))
    const firstEta = (await screen.findByTestId('declare-attack-eta')).textContent

    fireEvent.click(screen.getByTestId('declare-attack-origin-check-2'))
    await screen.findByText('Hraničáři z druhé državy')
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-2'))

    expect(await screen.findByTestId('declare-attack-eta')).not.toHaveTextContent(firstEta ?? '')
  })

  it('shows an army-strength comparison once attacker cards are selected', async () => {
    getCardInstancesAtTerritory.mockImplementation((id: number) =>
      Promise.resolve({ data: id === territory.id ? [] : [myCard], error: null })
    )

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    await screen.findByText('Elitní rytíři')
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))

    // Empty defender garrison means a guaranteed strong advantage.
    expect(await screen.findByTestId('declare-attack-army-strength')).toHaveTextContent('Silná výhoda')
  })

  it('shows an occupation-time preview once cards are selected for a genuinely empty target', async () => {
    const emptyTerritory: Territory = { ...territory, owner_id: null, claim_locked_by: null }
    getCardInstancesAtTerritory.mockImplementation((id: number) =>
      Promise.resolve({ data: id === emptyTerritory.id ? [] : [myCard], error: null })
    )

    render(<DeclareAttackModal territory={emptyTerritory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    await screen.findByText('Elitní rytíři')
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))

    expect(await screen.findByTestId('declare-attack-occupation-eta')).toHaveTextContent('hodin')
  })

  it('uses "obsadit" wording (not "útok") for a genuinely empty target', async () => {
    const emptyTerritory: Territory = { ...territory, owner_id: null, claim_locked_by: null }
    getCardInstancesAtTerritory.mockImplementation((id: number) =>
      Promise.resolve({ data: id === emptyTerritory.id ? [] : [myCard], error: null })
    )
    declareAttack.mockResolvedValue({ data: 'movement-1', error: null })

    render(<DeclareAttackModal territory={emptyTerritory} myPlayerId="me" onClose={jest.fn()} />)

    expect(screen.getByText(/^Obsadit území/)).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    await screen.findByText('Elitní rytíři')
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))

    const submit = screen.getByRole('button', { name: /Obsadit/ })
    fireEvent.click(submit)

    expect(await screen.findByText(/pokojně obsazovat/)).toBeInTheDocument()
  })

  it('does not show an occupation-time preview for a defended (non-empty) target', async () => {
    getCardInstancesAtTerritory.mockImplementation((id: number) =>
      Promise.resolve({ data: id === territory.id ? [] : [myCard], error: null })
    )

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Odkud útočíš' }))
    fireEvent.click(screen.getByTestId('declare-attack-origin-check-1'))
    await screen.findByText('Elitní rytíři')
    fireEvent.click(screen.getByTestId('declare-attack-card-select-inst-1'))

    expect(screen.queryByTestId('declare-attack-occupation-eta')).not.toBeInTheDocument()
  })

  it('shows only the defender boost rarity/count before activation', async () => {
    getCardInstancesAtTerritory.mockImplementation((id: number) =>
      Promise.resolve({
        data: id === territory.id ? [maskedDefenderBoost] : [myCard],
        error: null,
      })
    )

    render(<DeclareAttackModal territory={territory} myPlayerId="me" onClose={jest.fn()} />)

    expect(await screen.findByTestId('declare-attack-defender-boost-summary')).toHaveTextContent('Epic ×1')
    expect(screen.queryByText('Praporec dravců')).not.toBeInTheDocument()
    expect(screen.queryByText(/stat_multiplier/i)).not.toBeInTheDocument()
  })
})
