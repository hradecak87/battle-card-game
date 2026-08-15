import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollectionPage from './page'

describe('CollectionPage', () => {
  it('shows all 248 cards by default', () => {
    render(<CollectionPage />)
    expect(screen.getByText('248 z 248 karet')).toBeInTheDocument()
  })

  it('filters to only the selected unit type', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)

    await user.selectOptions(screen.getByLabelText('Typ vojska'), 'archers')

    expect(screen.getByText('31 z 248 karet')).toBeInTheDocument()
  })

  it('filters to only the selected rank', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)

    await user.selectOptions(screen.getByLabelText('Rank'), 'legend')

    expect(screen.getByText('24 z 248 karet')).toBeInTheDocument()
  })

  it('combines unit type and rank filters', async () => {
    const user = userEvent.setup()
    render(<CollectionPage />)

    await user.selectOptions(screen.getByLabelText('Typ vojska'), 'archers')
    await user.selectOptions(screen.getByLabelText('Rank'), 'legend')

    // 3 legend variants for archers specifically
    expect(screen.getByText('3 z 248 karet')).toBeInTheDocument()
  })
})
