import { render, screen } from '@testing-library/react'
import { AdminCardThumbnail } from './AdminCardThumbnail'

const CATEGORY_LABELS = {
  unit: 'Jednotky',
  castle: 'Hrady',
  village: 'Vesnice',
  wall: 'Hradby',
  boost: 'Boost',
}

describe('AdminCardThumbnail', () => {
  it.each([
    ['unit', 'Kopiníci', 'common'],
    ['castle', 'Velký hrad', 'rare'],
    ['village', 'Venkovská osada', 'uncommon'],
    ['wall', 'Kamenná hradba', 'epic'],
    ['boost', 'Posila', 'legend'],
  ] as const)('renders name, rank label, and category label for %s', (category, name, rank) => {
    render(<AdminCardThumbnail name={name} rank={rank} category={category} />)
    expect(screen.getByText(name)).toBeInTheDocument()
    expect(screen.getByText(CATEGORY_LABELS[category])).toBeInTheDocument()
    // rank label (first char uppercase)
    expect(screen.getByText(new RegExp(rank.charAt(0).toUpperCase() + rank.slice(1), 'i'))).toBeInTheDocument()
  })

  it('applies rank border class', () => {
    const { container } = render(<AdminCardThumbnail name="Test" rank="rare" category="unit" />)
    // Should have border-blue-500 or similar for rare
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/border-/)
  })

  it('renders in sm size by default (no lg data attribute)', () => {
    const { container } = render(<AdminCardThumbnail name="Test" rank="common" category="unit" />)
    const card = container.firstChild as HTMLElement
    expect(card).not.toHaveAttribute('data-size', 'lg')
  })

  it('renders in lg mode when size="lg" — has data-size="lg"', () => {
    const { container } = render(<AdminCardThumbnail name="Test" rank="common" category="unit" size="lg" />)
    const card = container.firstChild as HTMLElement
    expect(card).toHaveAttribute('data-size', 'lg')
  })
})
