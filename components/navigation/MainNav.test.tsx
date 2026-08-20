import { render, screen, waitFor } from '@testing-library/react'
import { MainNav } from './MainNav'

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

const listMyOffers = jest.fn()
jest.mock('@/lib/trading/api', () => ({
  listMyOffers: (...args: unknown[]) => listMyOffers(...args),
}))

const getAdminStatus = jest.fn()
jest.mock('@/lib/admin/api', () => ({
  getAdminStatus: (...args: unknown[]) => getAdminStatus(...args),
}))

import { useSession } from '@/lib/supabase/useSession'

describe('MainNav', () => {
  beforeEach(() => {
    getAdminStatus.mockReset().mockResolvedValue({ data: { is_admin: false }, error: null })
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

  it('shows the unread pending-offer badge next to the exchange link for logged-in users', async () => {
    ;(useSession as jest.Mock).mockReturnValue({
      user: { id: 'me' },
      player: { onboarding_completed: true },
      loading: false,
    })

    render(<MainNav />)

    expect(await screen.findByRole('link', { name: /Chat/ })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: 'Diplomacie' })).toHaveAttribute('href', '/diplomacy')
    expect(await screen.findByRole('link', { name: /Směnárna/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dění ve světě' })).toHaveAttribute('href', '/world')
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
  })

  it('does not show an admin link for a non-admin player', async () => {
    ;(useSession as jest.Mock).mockReturnValue({
      user: { id: 'me' },
      player: { onboarding_completed: true },
      loading: false,
    })
    getAdminStatus.mockResolvedValue({ data: { is_admin: false }, error: null })

    render(<MainNav />)

    await screen.findByRole('link', { name: /Směnárna/ })
    expect(screen.queryByRole('link', { name: /Admin/ })).not.toBeInTheDocument()
  })

  it('shows an admin link for a player flagged as admin', async () => {
    ;(useSession as jest.Mock).mockReturnValue({
      user: { id: 'me' },
      player: { onboarding_completed: true },
      loading: false,
    })
    getAdminStatus.mockResolvedValue({ data: { is_admin: true }, error: null })

    render(<MainNav />)

    expect(await screen.findByRole('link', { name: /Admin/ })).toHaveAttribute('href', '/admin')
  })
})
