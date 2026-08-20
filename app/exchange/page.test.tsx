'use client'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExchangePage from './page'
import type { TradeOffer } from '@/lib/trading/api'

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
const acceptOffer = jest.fn()

jest.mock('@/lib/trading/api', () => ({
  listMyOffers: (...args: unknown[]) => listMyOffers(...args),
  listPublicMarketplace: (...args: unknown[]) => listPublicMarketplace(...args),
  listTradeHistory: (...args: unknown[]) => listTradeHistory(...args),
  createTradeOffer: jest.fn(),
  counterOffer: jest.fn(),
  respondToPublicOffer: jest.fn(),
  acceptOffer: (...args: unknown[]) => acceptOffer(...args),
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

const unitTradeFields = {
  template_category: 'unit' as const,
  template_boost_type: null,
  template_effect_kind: null,
  template_instant_effect_kind: null,
  template_pct_str: null,
  template_pct_lng: null,
  template_pct_def: null,
  template_pct_hp: null,
}

function createOffer(overrides: Partial<TradeOffer> = {}): TradeOffer {
  return {
    id: 'offer-1',
    type: 'direct',
    status: 'pending',
    initiator_id: 'player-2',
    initiator_display_name: 'Karel',
    target_player_id: 'player-1',
    target_display_name: 'Král Artuš',
    parent_offer_id: null,
    root_offer_id: 'offer-1',
    offered_card_ids: ['card-1'],
    requested_card_ids: ['card-2'],
    requested_criteria: null,
    message: 'Vyměníme luky za kopí?',
    created_at: '2026-08-17T10:00:00Z',
    expires_at: '2026-08-20T10:00:00Z',
    resolved_at: null,
    offered_cards: [
      {
        instance_id: 'card-1',
        template_id: 'archers-common-1',
        owner_id: 'player-2',
        stationed_territory_id: 10,
        status: 'stationed',
        template_name: 'Lučištníci',
        template_rank: 'common',
        template_unit_type: 'archers',
        template_flavor_text: 'Hlídka z pohraničí.',
        template_base_stats: { str: 5, lng: 10, def: 4, hp: 8, speed: 5 },
        template_total_supply: null,
        ...unitTradeFields,
      },
    ],
    requested_cards: [
      {
        instance_id: 'card-2',
        template_id: 'spearmen-common-1',
        owner_id: 'player-1',
        stationed_territory_id: 20,
        status: 'stationed',
        template_name: 'Kopiníci',
        template_rank: 'common',
        template_unit_type: 'spearmen',
        template_flavor_text: 'Drží linii.',
        template_base_stats: { str: 6, lng: 2, def: 6, hp: 9, speed: 5 },
        template_total_supply: null,
        ...unitTradeFields,
      },
    ],
    ...overrides,
  }
}

describe('ExchangePage', () => {
  beforeEach(() => {
    push.mockClear()
    acceptOffer.mockReset().mockResolvedValue({ data: null, error: null })
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

  it('hides accepted offers from Moje nabídky while keeping them in Historie', async () => {
    const acceptedOffer = createOffer({
      id: 'offer-accepted',
      root_offer_id: 'offer-accepted',
      status: 'accepted',
      resolved_at: '2026-08-18T10:00:00Z',
      message: 'Už uzavřená směna',
    })

    listMyOffers.mockResolvedValue({ data: [acceptedOffer], error: null })
    listTradeHistory.mockResolvedValue({ data: [acceptedOffer], error: null })

    const user = userEvent.setup()
    render(<ExchangePage />)

    expect(await screen.findByRole('heading', { name: 'Moje nabídky' })).toBeInTheDocument()
    expect(screen.getByText('Zatím tu nemáš žádné nabídky.')).toBeInTheDocument()
    expect(screen.queryByText('Už uzavřená směna')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Historie' }))

    expect(await screen.findByText('Už uzavřená směna')).toBeInTheDocument()
  })

  it('refetches after accept and removes the resolved offer from Moje nabídky', async () => {
    const pendingOffer = createOffer({ message: 'Čekající nabídka' })
    const acceptedOffer = createOffer({
      status: 'accepted',
      resolved_at: '2026-08-18T10:00:00Z',
      message: 'Čekající nabídka',
    })
    let wasAccepted = false

    listMyOffers.mockImplementation(() =>
      Promise.resolve({ data: [wasAccepted ? acceptedOffer : pendingOffer], error: null })
    )
    listTradeHistory.mockImplementation(() =>
      Promise.resolve({ data: wasAccepted ? [acceptedOffer] : [], error: null })
    )
    acceptOffer.mockImplementation(async () => {
      wasAccepted = true
      return { data: null, error: null }
    })

    const user = userEvent.setup()
    render(<ExchangePage />)

    expect(await screen.findByText('Čekající nabídka')).toBeInTheDocument()

    await user.click(screen.getByText('Čekající nabídka'))
    await user.click(screen.getByRole('button', { name: 'Přijmout' }))

    await waitFor(() => expect(acceptOffer).toHaveBeenCalledWith('offer-1'))
    await waitFor(() => expect(screen.getByText('Zatím tu nemáš žádné nabídky.')).toBeInTheDocument())
    expect(screen.queryByText('Čekající nabídka')).not.toBeInTheDocument()
  })

  it('does not offer deposit cards in the create-trade modal', async () => {
    getMyCardInstances.mockResolvedValue({
      data: [
        {
          instance_id: 'deposit-card-1',
          template_id: 'archers-common-9',
          owner_id: 'player-1',
          stationed_territory_id: null,
          status: 'deposit',
          card_templates: {
            category: 'unit',
            name: 'Depozitní lučištník',
            rank: 'common',
            unit_type: 'archers',
            flavor_text: 'Čeká v depozitu.',
            base_stats: { str: 5, lng: 7, def: 3, hp: 7, speed: 5 },
            total_supply: null,
            boost_type: null,
            effect_kind: null,
            instant_effect_kind: null,
            pct_str: null,
            pct_lng: null,
            pct_def: null,
            pct_hp: null,
          },
        },
      ],
      error: null,
    })
    const user = userEvent.setup()

    render(<ExchangePage />)
    await screen.findByRole('heading', { name: 'Směnárna' })

    await user.click(screen.getByRole('button', { name: 'Nová nabídka' }))

    expect(screen.getByRole('heading', { name: 'Nová nabídka' })).toBeInTheDocument()
    expect(screen.queryByText('Depozitní lučištník')).not.toBeInTheDocument()
  })
})
