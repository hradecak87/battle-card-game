import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MyCollectionPage from './page'

const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

const getMyCardInstances = jest.fn()
jest.mock('@/lib/territories/api', () => ({
  getMyCardInstances: (...args: unknown[]) => getMyCardInstances(...args),
}))

import { useSession } from '@/lib/supabase/useSession'

function archerTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'archers-common-1',
    name: 'Vesničtí lučištníci',
    flavor_text: '',
    rank: 'common',
    category: 'unit',
    unit_type: 'archers',
    base_stats: { str: 5, lng: 10, def: 3, hp: 8 },
    total_supply: null,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    ...overrides,
  }
}

function knightTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'knights-legend-1',
    name: 'Legendární rytíři',
    flavor_text: '',
    rank: 'legend',
    category: 'unit',
    unit_type: 'knights',
    base_stats: { str: 20, lng: 2, def: 18, hp: 30 },
    total_supply: 3,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    ...overrides,
  }
}

function boostTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'boost-common-1',
    name: 'Krysa',
    flavor_text: 'Přetáhne nepřátelskou jednotku.',
    rank: 'rare',
    category: 'boost',
    unit_type: null,
    base_stats: null,
    total_supply: 8,
    defense_bonus_pct: null,
    attack_bonus_pct: null,
    boost_type: 'offensive',
    effect_kind: 'instant_effect',
    instant_effect_kind: 'steal_unit',
    pct_str: null,
    pct_lng: null,
    pct_def: null,
    pct_hp: null,
    ...overrides,
  }
}

const fixture = [
  {
    instance_id: 'i1',
    template_id: 'archers-common-1',
    owner_id: 'u1',
    stationed_territory_id: 10,
    status: 'stationed' as const,
    card_templates: archerTemplate(),
    territories: { id: 10, x: 3, y: 4, is_home: true },
  },
  {
    instance_id: 'i2',
    template_id: 'knights-legend-1',
    owner_id: 'u1',
    stationed_territory_id: 20,
    status: 'stationed' as const,
    card_templates: knightTemplate(),
    territories: { id: 20, x: 7, y: 1, is_home: false },
  },
  {
    instance_id: 'i3',
    template_id: 'archers-common-1',
    owner_id: 'u1',
    stationed_territory_id: null,
    status: 'in_transit' as const,
    card_templates: archerTemplate({ id: 'archers-common-2', name: 'Lesní lučištníci' }),
    territories: null,
  },
  {
    instance_id: 'i4',
    template_id: 'boost-common-1',
    owner_id: 'u1',
    stationed_territory_id: 10,
    status: 'stationed' as const,
    card_templates: boostTemplate(),
    territories: { id: 10, x: 3, y: 4, is_home: true },
  },
]

describe('MyCollectionPage', () => {
  beforeEach(() => {
    push.mockClear()
    getMyCardInstances.mockReset()
  })

  it('redirects to /login when there is no user', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: null, player: null, loading: false })
    render(<MyCollectionPage />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
  })

  it('loads and shows all of the current owned cards with their location', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'u1' }, player: null, loading: false })
    getMyCardInstances.mockResolvedValue({ data: fixture, error: null })

    render(<MyCollectionPage />)

    await waitFor(() => expect(screen.getByText(/4\s+z\s+4 karet/)).toBeInTheDocument())
    expect(getMyCardInstances).toHaveBeenCalledWith('u1')
    const locations = screen.getAllByTestId('card-location').map((el) => el.textContent)
    expect(locations).toEqual(['Domov (3, 4)', 'Území (7, 1)', 'Na cestě', 'Domov (3, 4)'])
  })

  it('filters by rank', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'u1' }, player: null, loading: false })
    getMyCardInstances.mockResolvedValue({ data: fixture, error: null })
    const user = userEvent.setup()

    render(<MyCollectionPage />)
    await waitFor(() => expect(screen.getByText(/4\s+z\s+4 karet/)).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Rank'), 'legend')
    expect(screen.getByText(/1\s+z\s+4 karet/)).toBeInTheDocument()
  })

  it('filters by unit type', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'u1' }, player: null, loading: false })
    getMyCardInstances.mockResolvedValue({ data: fixture, error: null })
    const user = userEvent.setup()

    render(<MyCollectionPage />)
    await waitFor(() => expect(screen.getByText(/4\s+z\s+4 karet/)).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Typ vojska'), 'knights')
    expect(screen.getByText(/1\s+z\s+4 karet/)).toBeInTheDocument()
  })

  it('filters by location, including the in-transit option', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'u1' }, player: null, loading: false })
    getMyCardInstances.mockResolvedValue({ data: fixture, error: null })
    const user = userEvent.setup()

    render(<MyCollectionPage />)
    await waitFor(() => expect(screen.getByText(/4\s+z\s+4 karet/)).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Oblast'), 'in_transit')
    expect(screen.getByText(/1\s+z\s+4 karet/)).toBeInTheDocument()
  })

  it('filters by search text on the card name', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'u1' }, player: null, loading: false })
    getMyCardInstances.mockResolvedValue({ data: fixture, error: null })
    const user = userEvent.setup()

    render(<MyCollectionPage />)
    await waitFor(() => expect(screen.getByText(/4\s+z\s+4 karet/)).toBeInTheDocument())

    await user.type(screen.getByLabelText('Hledat kartu podle názvu'), 'lesní')
    expect(screen.getByText(/1\s+z\s+4 karet/)).toBeInTheDocument()
  })

  it('shows an empty-state message when the player owns no cards', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'u1' }, player: null, loading: false })
    getMyCardInstances.mockResolvedValue({ data: [], error: null })

    render(<MyCollectionPage />)

    await waitFor(() => expect(screen.getByText(/nevlastníš žádné karty/)).toBeInTheDocument())
  })

  it('opens the zoom modal when an owned card is clicked', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'u1' }, player: null, loading: false })
    getMyCardInstances.mockResolvedValue({ data: fixture, error: null })
    const user = userEvent.setup()

    render(<MyCollectionPage />)
    await waitFor(() => expect(screen.getByText(/4\s+z\s+4 karet/)).toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: /Zvětšit kartu / })[0])
    expect(screen.getByTestId('card-zoom-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Zavřít detail karty' }))
    expect(screen.queryByTestId('card-zoom-modal')).not.toBeInTheDocument()
  })

  it('lets the player filter the collection down to boost cards', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'u1' }, player: null, loading: false })
    getMyCardInstances.mockResolvedValue({ data: fixture, error: null })
    const user = userEvent.setup()

    render(<MyCollectionPage />)
    await waitFor(() => expect(screen.getByText(/4\s+z\s+4 karet/)).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Kategorie'), 'boost')

    expect(screen.getByText(/1\s+z\s+4 karet/)).toBeInTheDocument()
    expect(screen.getByText('Krysa')).toBeInTheDocument()
    expect(screen.queryByText('Legendární rytíři')).not.toBeInTheDocument()
  })
})
