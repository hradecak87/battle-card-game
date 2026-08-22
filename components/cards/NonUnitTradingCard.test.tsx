import { render, screen } from '@testing-library/react'
import { NonUnitTradingCard } from './NonUnitTradingCard'
import { BoostCardTemplate, StructureCardTemplate } from '@/lib/cards/types'

function makeBoostTemplate(overrides: Partial<BoostCardTemplate> = {}): BoostCardTemplate {
  return {
    id: 'boost-1',
    category: 'boost',
    rank: 'epic',
    name: 'Bojový prapor',
    flavorText: 'Prapor vpředu drží útok pohromadě.',
    boostType: 'offensive',
    effectKind: 'stat_multiplier',
    instantEffectKind: null,
    pctStr: 8,
    pctLng: null,
    pctDef: null,
    pctHp: 4,
    totalSupply: 12,
    ...overrides,
  }
}

function makeStructureTemplate(
  overrides: Partial<StructureCardTemplate> = {}
): StructureCardTemplate {
  return {
    id: 'castle-1',
    category: 'castle',
    rank: 'rare',
    name: 'Pevná hradba',
    flavorText: 'Dřevěné štíty a hustá sestava zpevní obránce na valu.',
    defenseBonusPct: 18,
    attackBonusPct: 10,
    totalSupply: null,
    ...overrides,
  }
}

describe('NonUnitTradingCard', () => {
  it('renders a boost card with its stat-percentage columns, blanking out unused stats', () => {
    render(<NonUnitTradingCard template={makeBoostTemplate()} />)

    expect(screen.getByText('Bojový prapor')).toBeInTheDocument()
    expect(screen.getByText('Útočný boost')).toBeInTheDocument()
    expect(screen.getByText('Epic')).toBeInTheDocument()
    expect(screen.getByText('Existuje jen 12×')).toBeInTheDocument()

    expect(screen.getByText('STR')).toBeInTheDocument()
    expect(screen.getByText('+8%')).toBeInTheDocument()
    expect(screen.getByText('HP')).toBeInTheDocument()
    expect(screen.getByText('+4%')).toBeInTheDocument()

    // LNG and DEF labels stay, but with no value since this boost doesn't affect them.
    expect(screen.getByText('LNG')).toBeInTheDocument()
    expect(screen.getByText('DEF')).toBeInTheDocument()
    expect(screen.queryByText('+null%')).not.toBeInTheDocument()
  })

  it('labels a territorial boost as an "Obranný boost"', () => {
    render(<NonUnitTradingCard template={makeBoostTemplate({ boostType: 'territorial' })} />)
    expect(screen.getByText('Obranný boost')).toBeInTheDocument()
  })

  it('shows the instant-effect summary as flavor text for the steal-unit boost', () => {
    render(
      <NonUnitTradingCard
        template={makeBoostTemplate({
          name: 'Krysa',
          effectKind: 'instant_effect',
          instantEffectKind: 'steal_unit',
          pctStr: null,
          pctLng: null,
          pctDef: null,
          pctHp: null,
          flavorText: '',
        })}
      />
    )

    expect(screen.getByText(/ukradne náhodnou nepřátelskou jednotku/)).toBeInTheDocument()
    // All four stat labels remain, all blank.
    for (const label of ['STR', 'LNG', 'DEF', 'HP']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('renders a structure card with ATK/DEF columns and the correct type label', () => {
    render(<NonUnitTradingCard template={makeStructureTemplate()} />)

    expect(screen.getByText('Hrad')).toBeInTheDocument()
    expect(screen.getByText('ATK')).toBeInTheDocument()
    expect(screen.getByText('+10%')).toBeInTheDocument()
    expect(screen.getByText('DEF')).toBeInTheDocument()
    expect(screen.getByText('+18%')).toBeInTheDocument()
    expect(screen.getByText('Neomezeno')).toBeInTheDocument()
  })

  it('blanks the ATK value (but keeps the label) for a village, which has no attack bonus', () => {
    render(
      <NonUnitTradingCard
        template={makeStructureTemplate({
          category: 'village',
          name: 'Selská osada',
          attackBonusPct: null,
          defenseBonusPct: 10,
        })}
      />
    )

    expect(screen.getByText('Selská osada')).toBeInTheDocument()
    expect(screen.getByText('Vesnice')).toBeInTheDocument()
    expect(screen.getByText('ATK')).toBeInTheDocument()
    expect(screen.getByText('+10%')).toBeInTheDocument()
    expect(screen.queryByText('+null%')).not.toBeInTheDocument()
  })

  it('labels a wall structure card correctly', () => {
    render(
      <NonUnitTradingCard template={makeStructureTemplate({ category: 'wall', name: 'Kamenné opevnění' })} />
    )
    expect(screen.getByText('Kamenné opevnění')).toBeInTheDocument()
    expect(screen.getByText('Hradby')).toBeInTheDocument()
  })

  it('omits flavor text and supply line in compact mode', () => {
    render(<NonUnitTradingCard template={makeBoostTemplate()} compact />)

    expect(screen.queryByText('Prapor vpředu drží útok pohromadě.')).not.toBeInTheDocument()
    expect(screen.queryByText('Existuje jen 12×')).not.toBeInTheDocument()
  })
})
