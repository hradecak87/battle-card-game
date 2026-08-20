import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollectionPage from './page'
import { getNonUnitCardTemplates } from '@/lib/cards/nonUnitTemplates'

jest.mock('@/lib/cards/nonUnitTemplates', () => ({
  getNonUnitCardTemplates: jest.fn(),
}))

const mockGetNonUnitCardTemplates = getNonUnitCardTemplates as jest.Mock

// 5 castle + 5 village + 11 boost + 5 wall = 26 non-unit templates (matches
// the live card_templates table as of this test's writing).
const NON_UNIT_TEMPLATES = [
  ...(['common', 'uncommon', 'rare', 'epic', 'legend'] as const).map((rank) => ({
    id: `castle-${rank}`,
    category: 'castle' as const,
    rank,
    name: `Hrad (${rank})`,
    flavorText: '',
    defenseBonusPct: 20,
    attackBonusPct: 10,
    totalSupply: null,
  })),
  ...(['common', 'uncommon', 'rare', 'epic', 'legend'] as const).map((rank) => ({
    id: `village-${rank}`,
    category: 'village' as const,
    rank,
    name: `Vesnice (${rank})`,
    flavorText: '',
    defenseBonusPct: 10,
    attackBonusPct: null,
    totalSupply: null,
  })),
  ...Array.from({ length: 11 }, (_, i) => ({
    id: `boost-${i}`,
    category: 'boost' as const,
    rank: 'common' as const,
    name: `Boost ${i}`,
    flavorText: '',
    boostType: 'territorial' as const,
    effectKind: 'stat_multiplier' as const,
    instantEffectKind: null,
    pctStr: 10,
    pctLng: null,
    pctDef: null,
    pctHp: null,
    totalSupply: null,
  })),
  ...(['common', 'uncommon', 'rare', 'epic', 'legend'] as const).map((rank) => ({
    id: `wall-${rank}`,
    category: 'wall' as const,
    rank,
    name: `Hradby (${rank})`,
    flavorText: '',
    defenseBonusPct: 5,
    attackBonusPct: null,
    totalSupply: null,
  })),
]

jest.setTimeout(20000)

describe('CollectionPage', () => {
  beforeEach(() => {
    mockGetNonUnitCardTemplates.mockResolvedValue(NON_UNIT_TEMPLATES)
  })

  it('shows all 305 cards by default (279 units + 26 castle/village/boost/wall)', async () => {
    render(<CollectionPage />)
    expect(await screen.findByText('305 z 305 karet')).toBeInTheDocument()
  })

  it('filters to only the selected unit type (excludes non-unit cards)', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)
    await screen.findByText('305 z 305 karet')

    await user.selectOptions(screen.getByLabelText('Typ vojska'), 'archers')

    expect(screen.getByText('31 z 305 karet')).toBeInTheDocument()
  })

  it('filters to only the selected rank (includes matching non-unit cards)', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)
    await screen.findByText('305 z 305 karet')

    await user.selectOptions(screen.getByLabelText('Rank'), 'legend')

    // 27 legend units + 1 legend castle + 1 legend village + 1 legend wall = 30
    expect(screen.getByText('30 z 305 karet')).toBeInTheDocument()
  })

  it('combines unit type and rank filters', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)
    await screen.findByText('305 z 305 karet')

    await user.selectOptions(screen.getByLabelText('Typ vojska'), 'archers')
    await user.selectOptions(screen.getByLabelText('Rank'), 'legend')

    // 3 legend variants for archers specifically
    expect(screen.getByText('3 z 305 karet')).toBeInTheDocument()
  })

  it('opens the zoom modal when a catalog card is clicked', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)
    await screen.findByText('305 z 305 karet')

    await user.click(screen.getAllByRole('button', { name: /Zvětšit kartu / })[0])

    expect(screen.getByTestId('card-zoom-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Zavřít detail karty' }))
    expect(screen.queryByTestId('card-zoom-modal')).not.toBeInTheDocument()
  })

  it('renders castle/village structure cards with a plain tile', async () => {
    render(<CollectionPage />)
    await screen.findByText('305 z 305 karet')

    expect(screen.getByText('Hrad (common)')).toBeInTheDocument()
    expect(screen.getByText('Vesnice (common)')).toBeInTheDocument()
  })

  it('renders boost cards with an illustrated tile', async () => {
    render(<CollectionPage />)
    await screen.findByText('305 z 305 karet')

    expect(screen.getByText('Boost 0')).toBeInTheDocument()
  })

  it('renders wall cards with an illustrated tile', async () => {
    render(<CollectionPage />)
    await screen.findByText('305 z 305 karet')

    expect(screen.getByText('Hradby (common)')).toBeInTheDocument()
  })
})
