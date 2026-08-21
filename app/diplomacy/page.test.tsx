import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DiplomacyPage from './page'

const useSession = jest.fn()
const listWars = jest.fn()
const listOffers = jest.fn()
const listNonAggressionPacts = jest.fn()
const getMyCoalition = jest.fn()
const listCoalitions = jest.fn()
const listCoalitionInvites = jest.fn()
const listCoalitionJoinRequests = jest.fn()
const proposePeace = jest.fn()
const acceptPeace = jest.fn()
const rejectPeace = jest.fn()
const cancelPeace = jest.fn()
const proposeNonAggression = jest.fn()
const acceptNonAggression = jest.fn()
const rejectNonAggression = jest.fn()
const cancelNonAggression = jest.fn()
const createCoalition = jest.fn()
const requestJoinCoalition = jest.fn()
const acceptCoalitionInvite = jest.fn()
const rejectCoalitionInvite = jest.fn()
const inviteToCoalition = jest.fn()
const acceptCoalitionJoinRequest = jest.fn()
const rejectCoalitionJoinRequest = jest.fn()
const kickCoalitionMember = jest.fn()
const transferCoalitionLeadership = jest.fn()
const leaveCoalition = jest.fn()
const disbandCoalition = jest.fn()
const declareCoalitionWar = jest.fn()
const declareCoalitionPeace = jest.fn()
const getMyCardInstances = jest.fn()
const getMyTerritories = jest.fn()

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: () => useSession(),
}))

jest.mock('@/lib/diplomacy/api', () => ({
  listWars: (...args: unknown[]) => listWars(...args),
  listOffers: (...args: unknown[]) => listOffers(...args),
  listNonAggressionPacts: (...args: unknown[]) => listNonAggressionPacts(...args),
  getMyCoalition: (...args: unknown[]) => getMyCoalition(...args),
  listCoalitions: (...args: unknown[]) => listCoalitions(...args),
  listCoalitionInvites: (...args: unknown[]) => listCoalitionInvites(...args),
  listCoalitionJoinRequests: (...args: unknown[]) => listCoalitionJoinRequests(...args),
  proposePeace: (...args: unknown[]) => proposePeace(...args),
  acceptPeace: (...args: unknown[]) => acceptPeace(...args),
  rejectPeace: (...args: unknown[]) => rejectPeace(...args),
  cancelPeace: (...args: unknown[]) => cancelPeace(...args),
  proposeNonAggression: (...args: unknown[]) => proposeNonAggression(...args),
  acceptNonAggression: (...args: unknown[]) => acceptNonAggression(...args),
  rejectNonAggression: (...args: unknown[]) => rejectNonAggression(...args),
  cancelNonAggression: (...args: unknown[]) => cancelNonAggression(...args),
  createCoalition: (...args: unknown[]) => createCoalition(...args),
  requestJoinCoalition: (...args: unknown[]) => requestJoinCoalition(...args),
  acceptCoalitionInvite: (...args: unknown[]) => acceptCoalitionInvite(...args),
  rejectCoalitionInvite: (...args: unknown[]) => rejectCoalitionInvite(...args),
  inviteToCoalition: (...args: unknown[]) => inviteToCoalition(...args),
  acceptCoalitionJoinRequest: (...args: unknown[]) => acceptCoalitionJoinRequest(...args),
  rejectCoalitionJoinRequest: (...args: unknown[]) => rejectCoalitionJoinRequest(...args),
  kickCoalitionMember: (...args: unknown[]) => kickCoalitionMember(...args),
  transferCoalitionLeadership: (...args: unknown[]) => transferCoalitionLeadership(...args),
  leaveCoalition: (...args: unknown[]) => leaveCoalition(...args),
  disbandCoalition: (...args: unknown[]) => disbandCoalition(...args),
  declareCoalitionWar: (...args: unknown[]) => declareCoalitionWar(...args),
  declareCoalitionPeace: (...args: unknown[]) => declareCoalitionPeace(...args),
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
    listOffers.mockReset().mockResolvedValue({
      data: [
        {
          id: 'peace-1',
          initiator_id: 'enemy-1',
          initiator_display_name: 'Král Jan',
          target_id: 'me',
          target_display_name: 'Já',
          kind: 'white_peace',
          offered_card_ids: [],
          offered_territory_id: null,
          offered_territory_name: null,
          offered_territory_x: null,
          offered_territory_y: null,
          status: 'pending',
          created_at: '2026-08-21T10:00:00.000Z',
          expires_at: '2026-08-22T10:00:00.000Z',
          resolved_at: null,
          offered_cards: [],
        },
        {
          id: 'pact-1',
          initiator_id: 'me',
          initiator_display_name: 'Já',
          target_id: 'player-3',
          target_display_name: 'Paktář',
          kind: 'non_aggression',
          offered_card_ids: [],
          offered_territory_id: null,
          offered_territory_name: null,
          offered_territory_x: null,
          offered_territory_y: null,
          status: 'pending',
          created_at: '2026-08-21T10:05:00.000Z',
          expires_at: '2026-08-22T10:05:00.000Z',
          resolved_at: null,
          offered_cards: [],
        },
      ],
      error: null,
    })
    listNonAggressionPacts.mockReset().mockResolvedValue({
      data: [
        {
          other_player_id: 'player-4',
          other_player_display_name: 'Spojenec',
          other_kingdom_name: 'Východ',
          other_home_x: 33,
          other_home_y: 44,
          pact_started_at: '2026-08-21T09:00:00.000Z',
        },
      ],
      error: null,
    })
    getMyCoalition.mockReset().mockResolvedValue({ data: [null], error: null })
    listCoalitions.mockReset().mockResolvedValue({
      data: [
        {
          id: 'coalition-1',
          name: 'Jantar',
          leader_id: 'leader-1',
          leader_display_name: 'Vůdce',
          member_count: 3,
        },
      ],
      error: null,
    })
    listCoalitionInvites.mockReset().mockResolvedValue({ data: [], error: null })
    listCoalitionJoinRequests.mockReset().mockResolvedValue({ data: [], error: null })
    proposePeace.mockReset().mockResolvedValue({ data: 'offer-1', error: null })
    acceptPeace.mockReset().mockResolvedValue({ data: null, error: null })
    rejectPeace.mockReset().mockResolvedValue({ data: null, error: null })
    cancelPeace.mockReset().mockResolvedValue({ data: null, error: null })
    proposeNonAggression.mockReset().mockResolvedValue({ data: 'offer-2', error: null })
    acceptNonAggression.mockReset().mockResolvedValue({ data: null, error: null })
    rejectNonAggression.mockReset().mockResolvedValue({ data: null, error: null })
    cancelNonAggression.mockReset().mockResolvedValue({ data: null, error: null })
    createCoalition.mockReset().mockResolvedValue({ data: 'coalition-2', error: null })
    requestJoinCoalition.mockReset().mockResolvedValue({ data: 'request-1', error: null })
    acceptCoalitionInvite.mockReset().mockResolvedValue({ data: null, error: null })
    rejectCoalitionInvite.mockReset().mockResolvedValue({ data: null, error: null })
    inviteToCoalition.mockReset().mockResolvedValue({ data: 'invite-1', error: null })
    acceptCoalitionJoinRequest.mockReset().mockResolvedValue({ data: null, error: null })
    rejectCoalitionJoinRequest.mockReset().mockResolvedValue({ data: null, error: null })
    kickCoalitionMember.mockReset().mockResolvedValue({ data: null, error: null })
    transferCoalitionLeadership.mockReset().mockResolvedValue({ data: null, error: null })
    leaveCoalition.mockReset().mockResolvedValue({ data: null, error: null })
    disbandCoalition.mockReset().mockResolvedValue({ data: null, error: null })
    declareCoalitionWar.mockReset().mockResolvedValue({ data: null, error: null })
    declareCoalitionPeace.mockReset().mockResolvedValue({ data: null, error: null })
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

  it('renders the tabbed diplomacy layout and keeps stacked mobile sections', async () => {
    render(<DiplomacyPage />)

    await waitFor(() => expect(listWars).toHaveBeenCalled())
    expect(screen.getByTestId('diplomacy-sections')).toHaveClass('flex-col')
    expect(screen.getByRole('button', { name: 'Moje války' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nabídky míru' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Koalice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pakty' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Moje války' })).toBeInTheDocument()
  })

  it('opens the fullscreen peace proposal overlay from a war card', async () => {
    render(<DiplomacyPage />)

    await waitFor(() => expect(screen.getByText('Král Jan')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Navrhnout mír' }))

    expect(screen.getByTestId('peace-proposal-overlay')).toBeInTheDocument()
  })

  it('switches to the coalition tab and calls createCoalition', async () => {
    render(<DiplomacyPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Koalice' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Koalice' }))
    fireEvent.change(screen.getByPlaceholderText('Název koalice'), { target: { value: 'Nová koalice' } })
    fireEvent.click(screen.getByRole('button', { name: '➕ Založit vlastní koalici' }))

    await waitFor(() => expect(createCoalition).toHaveBeenCalledWith('Nová koalice'))
  })

  it('switches to the pact tab and wires the pact proposal callback', async () => {
    render(<DiplomacyPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pakty' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Pakty' }))
    expect(screen.getByRole('link', { name: 'Spojenec' })).toHaveAttribute('href', '/map?x=33&y=44')

    fireEvent.change(screen.getByPlaceholderText('ID cílového hráče'), { target: { value: 'player-5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Navrhnout pakt' }))

    await waitFor(() => expect(proposeNonAggression).toHaveBeenCalledWith('player-5'))
  })
})
