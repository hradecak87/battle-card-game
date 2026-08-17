import { render, screen, waitFor } from '@testing-library/react'
import { MainNav } from './MainNav'

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

const listMyOffers = jest.fn()
jest.mock('@/lib/trading/api', () => ({
  listMyOffers: (...args: unknown[]) => listMyOffers(...args),
}))

import { useSession } from '@/lib/supabase/useSession'

describe('MainNav', () => {
  beforeEach(() => {
    listMyOffers.mockReset().mockResolvedValue({
      data: [
        {
          id: 'offer-1',
          type: 'direct',
          status: 'pending',
          initiator_id: 'other-player',
          initiator_display_name: 'Král Artuš',
          target_player_id: 'me',
          target_display_name: 'Já',
          parent_offer_id: null,
          root_offer_id: 'offer-1',
          offered_card_ids: [],
          requested_card_ids: [],
          requested_criteria: null,
          message: null,
          created_at: '2026-08-17T10:00:00Z',
          expires_at: '2026-08-20T10:00:00Z',
          resolved_at: null,
          offered_cards: [],
          requested_cards: [],
        },
      ],
      error: null,
    })
  })

  it('shows the unread pending-offer badge next to the profile link for logged-in users', async () => {
    ;(useSession as jest.Mock).mockReturnValue({
      user: { id: 'me' },
      player: { onboarding_completed: true },
      loading: false,
    })

    render(<MainNav />)

    expect(await screen.findByRole('link', { name: /Můj profil/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
  })
})
