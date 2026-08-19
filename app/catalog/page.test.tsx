import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollectionPage from './page'

describe('CollectionPage', () => {
  it('shows all 279 cards by default', () => {
    render(<CollectionPage />)
    expect(screen.getByText('279 z 279 karet')).toBeInTheDocument()
  })

  it('filters to only the selected unit type', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)

    await user.selectOptions(screen.getByLabelText('Typ vojska'), 'archers')

    expect(screen.getByText('31 z 279 karet')).toBeInTheDocument()
  })

  it('filters to only the selected rank', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)

    await user.selectOptions(screen.getByLabelText('Rank'), 'legend')

    expect(screen.getByText('27 z 279 karet')).toBeInTheDocument()
  })

  it('combines unit type and rank filters', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)

    await user.selectOptions(screen.getByLabelText('Typ vojska'), 'archers')
    await user.selectOptions(screen.getByLabelText('Rank'), 'legend')

    // 3 legend variants for archers specifically
    expect(screen.getByText('3 z 279 karet')).toBeInTheDocument()
  })

  it('opens the zoom modal when a catalog card is clicked', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)

    await user.click(screen.getAllByRole('button', { name: /Zvětšit kartu / })[0])

    expect(screen.getByTestId('card-zoom-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Zavřít detail karty' }))
    expect(screen.queryByTestId('card-zoom-modal')).not.toBeInTheDocument()
  })
})
