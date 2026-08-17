import { render, screen } from '@testing-library/react'
import ProfileMePage from './page'

const push = jest.fn()
const getMyBattleHistory = jest.fn().mockResolvedValue({ data: [], error: null })
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const mockPlayer = {
  id: 'u1',
  display_name: 'Král Test',
  nation: 'england' as const,
  kingdom_name: 'Testovia',
  coat_of_arms_id: 'lion-gold',
  onboarding_completed: true,
  xp: 150,
  created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  last_seen_at: new Date().toISOString(),
  total_playtime_seconds: 3661,
}

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

jest.mock('@/lib/battles/api', () => ({
  getMyBattleHistory: (...args: unknown[]) => getMyBattleHistory(...args),
}))

import { useSession } from '@/lib/supabase/useSession'

describe('ProfileMePage', () => {
  beforeEach(() => {
    push.mockClear()
    getMyBattleHistory.mockClear()
  })

  it('shows level/XP progress, nation perk text, kingdom name and the battle-history section', async () => {
    ;(useSession as jest.Mock).mockReturnValue({
      user: { id: 'u1' },
      player: mockPlayer,
      loading: false,
    })

    render(<ProfileMePage />)

    expect(screen.getByText(/Testovia/)).toBeInTheDocument()
    expect(screen.getByText(/Anglické království/)).toBeInTheDocument()
    expect(screen.getByText(/Tisové luky/)).toBeInTheDocument()
    expect(screen.getByTestId('xp-progress-bar')).toBeInTheDocument()
    expect(screen.getByText(/5 dní/)).toBeInTheDocument()
    expect(await screen.findByText('Historie bitev')).toBeInTheDocument()
  })

  it('redirects to /login when there is no user', () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: null, player: null, loading: false })
    render(<ProfileMePage />)
    expect(push).toHaveBeenCalledWith('/login')
  })

  it('redirects to /onboarding/kingdom when onboarding is not complete', () => {
    ;(useSession as jest.Mock).mockReturnValue({
      user: { id: 'u1' },
      player: { ...mockPlayer, onboarding_completed: false },
      loading: false,
    })
    render(<ProfileMePage />)
    expect(push).toHaveBeenCalledWith('/onboarding/kingdom')
  })
})
