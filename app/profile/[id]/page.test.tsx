import { render, screen, waitFor } from '@testing-library/react'
import ProfilePage from './page'

const mockPlayer = {
  id: 'u2',
  display_name: 'Jiný hráč',
  nation: 'francia' as const,
  kingdom_name: 'Franskoland',
  coat_of_arms_id: 'cross-white',
  onboarding_completed: true,
  is_npc: false,
  npc_next_action_at: null,
  xp: 500,
  king_relocation_used_at: null,
  daily_reward_streak: 0,
  last_daily_reward_at: null,
  created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  last_seen_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  total_playtime_seconds: 7200,
}

const single = jest.fn().mockResolvedValue({ data: mockPlayer, error: null })
const eq = jest.fn(() => ({ single }))
const select = jest.fn(() => ({ eq }))
const from = jest.fn((_table: string) => ({ select }))

jest.mock('@/lib/supabase/client', () => ({
  supabase: { from: (table: string) => from(table) },
}))

describe('ProfilePage (public)', () => {
  it('fetches and renders the given player id without edit controls', async () => {
    render(<ProfilePage params={{ id: 'u2' }} />)

    await waitFor(() => expect(screen.getByText(/Franskoland/)).toBeInTheDocument())
    expect(from).toHaveBeenCalledWith('players')
    expect(eq).toHaveBeenCalledWith('id', 'u2')
    expect(screen.getByText(/Franská říše/)).toBeInTheDocument()
    expect(screen.queryByText('Upravit království')).not.toBeInTheDocument()
  })
})
