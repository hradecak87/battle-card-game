import { render, screen } from '@testing-library/react'
import { AuthStatusBar } from './AuthStatusBar'

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

import { useSession } from '@/lib/supabase/useSession'

describe('AuthStatusBar', () => {
  it('renders nothing while the session is still loading', () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: null, player: null, loading: true })
    const { container } = render(<AuthStatusBar />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a logged-out warning with a login link when there is no user', () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: null, player: null, loading: false })
    render(<AuthStatusBar />)
    expect(screen.getByText(/Nejsi přihlášen/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Přihlásit se/i })).toHaveAttribute('href', '/login')
  })

  it("shows the logged-in user's email", () => {
    ;(useSession as jest.Mock).mockReturnValue({
      user: { email: 'hradecak87@gmail.com' },
      player: null,
      loading: false,
    })
    render(<AuthStatusBar />)
    expect(screen.getByText(/hradecak87@gmail\.com/)).toBeInTheDocument()
  })
})
