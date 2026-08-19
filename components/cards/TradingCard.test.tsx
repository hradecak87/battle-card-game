import { render, screen } from '@testing-library/react'
import { TradingCard } from './TradingCard'
import { EffectiveCard, UnitCardTemplate } from '@/lib/cards/types'

const stats: EffectiveCard = { str: 5, lng: 12, def: 4, hp: 11 }

function makeTemplate(overrides: Partial<UnitCardTemplate>): UnitCardTemplate {
  return {
    id: 'archers-common-1',
    category: 'unit',
    unitType: 'archers',
    rank: 'common',
    name: 'Královští lučištníci',
    flavorText: 'Déšť šípů přichází bez varování.',
    baseStats: { str: 5, lng: 12, def: 4, hp: 11, speed: 6 },
    totalSupply: null,
    ...overrides,
  }
}

describe('TradingCard', () => {
  it('renders the procedural SVG emblem for templates without illustrated art', () => {
    const template = makeTemplate({ id: 'archers-common-1' })
    render(<TradingCard template={template} stats={stats} />)

    expect(screen.getByRole('img', { name: 'archers' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: template.name })).not.toBeInTheDocument()
  })

  it('renders the illustrated PNG artwork for templates registered in illustrated-art', () => {
    const template = makeTemplate({
      id: 'lightCavalry-rare-04',
      name: 'Blesk stepí',
      unitType: 'lightCavalry',
      rank: 'rare',
    })
    render(<TradingCard template={template} stats={stats} />)

    const img = screen.getByRole('img', { name: template.name })
    expect(img).toHaveAttribute('src', '/cards/units/lightCavalry-rare-04.png')
  })
})
