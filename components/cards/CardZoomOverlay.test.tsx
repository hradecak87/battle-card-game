import { fireEvent, render, screen } from '@testing-library/react'
import { CardZoomOverlay } from './CardZoomOverlay'
import { EffectiveCard, UnitCardTemplate } from '@/lib/cards/types'

const template: UnitCardTemplate = {
  id: 'archers-common-1',
  category: 'unit',
  unitType: 'archers',
  rank: 'common',
  name: 'Královští lučištníci',
  flavorText: 'Déšť šípů přichází bez varování.',
  baseStats: { str: 5, lng: 12, def: 4, hp: 11 },
  totalSupply: null,
}

const stats: EffectiveCard = { str: 5, lng: 12, def: 4, hp: 11 }

describe('CardZoomOverlay', () => {
  it('renders nothing when no card is open', () => {
    render(<CardZoomOverlay card={null} onClose={jest.fn()} />)

    expect(screen.queryByTestId('card-zoom-modal')).not.toBeInTheDocument()
  })

  it('renders the backdrop and enlarged card when open', () => {
    render(<CardZoomOverlay card={{ template, stats }} onClose={jest.fn()} />)

    expect(screen.getByTestId('card-zoom-modal')).toBeInTheDocument()
    expect(screen.getByText('Královští lučištníci')).toBeInTheDocument()
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = jest.fn()
    render(<CardZoomOverlay card={{ template, stats }} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('card-zoom-backdrop'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the close button is clicked', () => {
    const onClose = jest.fn()
    render(<CardZoomOverlay card={{ template, stats }} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Zavřít detail karty' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when Escape is pressed', () => {
    const onClose = jest.fn()
    render(<CardZoomOverlay card={{ template, stats }} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when the card content itself is clicked', () => {
    const onClose = jest.fn()
    render(<CardZoomOverlay card={{ template, stats }} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('card-zoom-content'))

    expect(onClose).not.toHaveBeenCalled()
  })
})
