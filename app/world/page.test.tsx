import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import WorldPage from './page'

const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

const listAttacksInTransit = jest.fn()
const listClaimsInProgress = jest.fn()
const listActiveBattles = jest.fn()
const listWorldEvents = jest.fn()
jest.mock('@/lib/world/api', () => ({
  listAttacksInTransit: (...args: unknown[]) => listAttacksInTransit(...args),
  listClaimsInProgress: (...args: unknown[]) => listClaimsInProgress(...args),
  listActiveBattles: (...args: unknown[]) => listActiveBattles(...args),
  listWorldEvents: (...args: unknown[]) => listWorldEvents(...args),
}))

import { useSession } from '@/lib/supabase/useSession'

describe('WorldPage', () => {
  beforeEach(() => {
    push.mockClear()
    listAttacksInTransit.mockReset().mockResolvedValue({
      data: [
        {
          movement_id: 'move-1',
          attacker_id: 'player-1',
          attacker_display_name: 'Král Artuš',
          attacker_home_x: 12,
          attacker_home_y: 34,
          target_territory_id: 50,
          target_x: 56,
          target_y: 78,
          target_owner_id: null,
          target_owner_display_name: null,
          target_owner_is_npc: false,
          target_owner_home_x: null,
          target_owner_home_y: null,
          arrives_at: '2026-08-20T12:30:00.000Z',
        },
      ],
      error: null,
    })
    listClaimsInProgress.mockReset().mockResolvedValue({
      data: [
        {
          territory_id: 60,
          claimant_id: 'player-2',
          claimant_display_name: 'Vévoda Jan',
          claimant_home_x: 11,
          claimant_home_y: 22,
          territory_x: 33,
          territory_y: 44,
          claim_completes_at: '2026-08-20T13:00:00.000Z',
        },
      ],
      error: null,
    })
    listActiveBattles.mockReset().mockResolvedValue({
      data: [
        {
          battle_id: 'battle-1',
          attacker_id: 'player-1',
          attacker_display_name: 'Král Artuš',
          attacker_home_x: 12,
          attacker_home_y: 34,
          defender_id: 'player-3',
          defender_display_name: 'Obránce',
          defender_home_x: 45,
          defender_home_y: 67,
          defender_territory_id: undefined,
          territory_id: 70,
          territory_x: 88,
          territory_y: 99,
          status: 'active',
          current_round: 2,
        },
      ],
      error: null,
    })
    listWorldEvents.mockReset().mockResolvedValue({
      data: [
        {
          event_type: 'battle_won',
          created_at: '2026-08-20T11:55:00.000Z',
          payload: {
            winner_display_name: 'Král Artuš',
            winner_home_x: 12,
            winner_home_y: 34,
            loser_display_name: 'Obránce',
            loser_home_x: 45,
            loser_home_y: 67,
            territory_x: 88,
            territory_y: 99,
          },
          total_count: 20,
        },
      ],
      error: null,
    })
  })

  it('redirects guests to /login', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: null, player: null, loading: false })

    render(<WorldPage />)

    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
  })

  it('loads and renders all four world sections with map links and pagination', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'me' }, player: { id: 'me' }, loading: false })

    render(<WorldPage />)

    expect(await screen.findByRole('heading', { name: 'Dění ve světě' })).toBeInTheDocument()
    await waitFor(() => expect(listAttacksInTransit).toHaveBeenCalled())
    expect(listClaimsInProgress).toHaveBeenCalled()
    expect(listActiveBattles).toHaveBeenCalled()
    expect(listWorldEvents).toHaveBeenCalledWith(0, 10)
    expect(screen.getByRole('link', { name: 'Území (56, 78)' })).toHaveAttribute('href', '/map?x=56&y=78')

    fireEvent.click(screen.getByRole('button', { name: 'Další' }))

    await waitFor(() => expect(listWorldEvents).toHaveBeenCalledWith(1, 10))
  })
})
