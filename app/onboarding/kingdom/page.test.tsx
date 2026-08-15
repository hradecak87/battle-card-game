import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KingdomOnboardingPage from './page'

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

describe('KingdomOnboardingPage', () => {
  it('renders the kingdom-name input and all coat-of-arms tiles, and lets you pick one', async () => {
    const user = userEvent.setup()
    render(<KingdomOnboardingPage />)

    expect(screen.getByLabelText('Název tvého království')).toBeInTheDocument()

    const tiles = screen.getAllByRole('button', { name: /erb/i })
    expect(tiles.length).toBeGreaterThanOrEqual(20)

    expect(tiles[0]).toHaveAttribute('aria-pressed', 'false')
    await user.click(tiles[0])
    expect(tiles[0]).toHaveAttribute('aria-pressed', 'true')
    expect(tiles[1]).toHaveAttribute('aria-pressed', 'false')
  })
})
