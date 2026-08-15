import { render, screen, waitFor } from '@testing-library/react'
import LeaderboardPage from './page'

const mockPlayers = [
  { id: 'a', display_name: 'Nízký level', nation: 'england', xp: 50, kingdom_name: 'A' },
  { id: 'b', display_name: 'Vysoký level', nation: 'francia', xp: 5000, kingdom_name: 'B' },
  { id: 'c', display_name: 'Střední level', nation: 'hre', xp: 900, kingdom_name: 'C' },
]

const eq = jest.fn().mockResolvedValue({ data: mockPlayers, error: null })
const select = jest.fn(() => ({ eq }))
const from = jest.fn((_table: string) => ({ select }))

jest.mock('@/lib/supabase/client', () => ({
  supabase: { from: (table: string) => from(table) },
}))

describe('LeaderboardPage', () => {
  it('renders players sorted by level then XP descending, with rank numbers and links', async () => {
    render(<LeaderboardPage />)

    await waitFor(() => expect(screen.getByText('Vysoký level')).toBeInTheDocument())

    expect(from).toHaveBeenCalledWith('players')
    expect(eq).toHaveBeenCalledWith('onboarding_completed', true)

    const rows = screen.getAllByTestId('leaderboard-row')
    expect(rows[0]).toHaveTextContent('1')
    expect(rows[0]).toHaveTextContent('Vysoký level')
    expect(rows[1]).toHaveTextContent('2')
    expect(rows[1]).toHaveTextContent('Střední level')
    expect(rows[2]).toHaveTextContent('3')
    expect(rows[2]).toHaveTextContent('Nízký level')

    expect(screen.getByRole('link', { name: /Vysoký level/ })).toHaveAttribute('href', '/profile/b')
  })
})
