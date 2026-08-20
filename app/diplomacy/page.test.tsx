import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DiplomacyPage from './page'

const useSession = jest.fn()
const listWars = jest.fn()
const listOffers = jest.fn()
const proposePeace = jest.fn()
const acceptPeace = jest.fn()
const rejectPeace = jest.fn()
const cancelPeace = jest.fn()
const getMyCardInstances = jest.fn()
const getMyTerritories = jest.fn()

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: () => useSession(),
}))

jest.mock('@/lib/diplomacy/api', () => ({
  listWars: (...args: unknown[]) => listWars(...args),
  listOffers: (...args: unknown[]) => listOffers(...args),
  proposePeace: (...args: unknown[]) => proposePeace(...args),
  acceptPeace: (...args: unknown[]) => acceptPeace(...args),
  rejectPeace: (...args: unknown[]) => rejectPeace(...args),
  cancelPeace: (...args: unknown[]) => cancelPeace(...args),
}))

jest.mock('@/lib/territories/api', () => ({
  getMyCardInstances: (...args: unknown[]) => getMyCardInstances(...args),
  getMyTerritories: (...args: unknown[]) => getMyTerritories(...args),
}))

describe('DiplomacyPage', () => {
  beforeEach(() => {
    useSession.mockReturnValue({
      user: { id: 'me' },
      player: { onboarding_completed: true },
      loading: false,
    })
    listWars.mockReset().mockResolvedValue({
      data: [
        {
          other_player_id: 'enemy-1',
          other_player_display_name: 'Král Jan',
          other_kingdom_name: 'Sever',
          other_home_x: 11,
          other_home_y: 22,
          war_started_at: '2026-08-20T10:00:00.000Z',
        },
      ],
      error: null,
    })
    listOffers.mockReset().mockResolvedValue({ data: [], error: null })
    proposePeace.mockReset().mockResolvedValue({ data: 'offer-1', error: null })
    acceptPeace.mockReset().mockResolvedValue({ data: null, error: null })
    rejectPeace.mockReset().mockResolvedValue({ data: null, error: null })
    cancelPeace.mockReset().mockResolvedValue({ data: null, error: null })
    getMyCardInstances.mockReset().mockResolvedValue({
      data: [
        {
          instance_id: 'card-1',
          template_id: 'archers-common-01',
          owner_id: 'me',
          stationed_territory_id: 1,
          status: 'stationed',
          territories: { id: 1, x: 1, y: 1, is_home: true },
          card_templates: {
            id: 'archers-common-01',
            name: 'Práčata',
            flavor_text: 'Text',
            rank: 'common',
            category: 'unit',
            unit_type: 'archers',
            base_stats: { str: 1, lng: 8, def: 2, hp: 4, speed: 6 },
            total_supply: null,
            defense_bonus_pct: null,
            attack_bonus_pct: null,
          },
        },
      ],
      error: null,
    })
    getMyTerritories.mockReset().mockResolvedValue({
      data: [{ id: 9, x: 9, y: 10, is_home: false, castle_rank: null, village_rank: null, name: 'Pohraničí', battle_locked_by: null }],
      error: null,
    })
  })

  it('renders stacked full-width sections suitable for mobile portrait', async () => {
    render(<DiplomacyPage />)

    await waitFor(() => expect(listWars).toHaveBeenCalled())
    expect(screen.getByTestId('diplomacy-sections')).toHaveClass('flex-col')
    expect(screen.getByRole('heading', { name: 'Moje války' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nabídky míru' })).toBeInTheDocument()
  })

  it('opens the fullscreen peace proposal overlay from a war card', async () => {
    render(<DiplomacyPage />)

    await waitFor(() => expect(screen.getByText('Král Jan')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Navrhnout mír' }))

    expect(screen.getByTestId('peace-proposal-overlay')).toBeInTheDocument()
  })
})
