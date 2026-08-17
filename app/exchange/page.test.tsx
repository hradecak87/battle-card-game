'use client'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExchangePage from './page'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

const listMyOffers = jest.fn()
const listPublicMarketplace = jest.fn()
const listTradeHistory = jest.fn()

jest.mock('@/lib/trading/api', () => ({
  listMyOffers: (...args: unknown[]) => listMyOffers(...args),
  listPublicMarketplace: (...args: unknown[]) => listPublicMarketplace(...args),
  listTradeHistory: (...args: unknown[]) => listTradeHistory(...args),
  createTradeOffer: jest.fn(),
  counterOffer: jest.fn(),
  respondToPublicOffer: jest.fn(),
  acceptOffer: jest.fn(),
  rejectOffer: jest.fn(),
  cancelOffer: jest.fn(),
}))

const getMyCardInstances = jest.fn()
jest.mock('@/lib/territories/api', () => ({
  getMyCardInstances: (...args: unknown[]) => getMyCardInstances(...args),
}))

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        ilike: jest.fn(() => ({
          neq: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  },
}))

import { useSession } from '@/lib/supabase/useSession'

describe('ExchangePage', () => {
  beforeEach(() => {
    push.mockClear()
    listMyOffers.mockReset().mockResolvedValue({ data: [], error: null })
    listPublicMarketplace.mockReset().mockResolvedValue({ data: [], error: null })
    listTradeHistory.mockReset().mockResolvedValue({ data: [], error: null })
    getMyCardInstances.mockReset().mockResolvedValue({ data: [], error: null })
    ;(useSession as jest.Mock).mockReturnValue({
      user: { id: 'player-1' },
      player: { id: 'player-1', onboarding_completed: true },
      loading: false,
    })
  })

  it('switches between the three exchange tabs', async () => {
    const user = userEvent.setup()
    render(<ExchangePage />)

    expect(await screen.findByRole('heading', { name: 'Směnárna' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tržnice' }))
    expect(screen.getByRole('heading', { name: 'Tržnice' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Historie' }))
    expect(screen.getByRole('heading', { name: 'Historie' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Moje nabídky' }))
    expect(screen.getByRole('heading', { name: 'Moje nabídky' })).toBeInTheDocument()
  })

  it('redirects to /login when there is no user', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: null, player: null, loading: false })

    render(<ExchangePage />)

    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
  })
})
