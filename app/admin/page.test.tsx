import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminPage from './page'

const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

const getAdminStatus = jest.fn()
const getAdminOnlinePlayers = jest.fn()
const getAdminActiveBattles = jest.fn()
const getAdminPlayerCards = jest.fn()
const getAdminCardTemplates = jest.fn()
const grantAdminCard = jest.fn()
const removeAdminCard = jest.fn()
const grantAdminXp = jest.fn()

jest.mock('@/lib/admin/api', () => ({
  getAdminStatus: (...args: unknown[]) => getAdminStatus(...args),
  getAdminOnlinePlayers: (...args: unknown[]) => getAdminOnlinePlayers(...args),
  getAdminActiveBattles: (...args: unknown[]) => getAdminActiveBattles(...args),
  getAdminPlayerCards: (...args: unknown[]) => getAdminPlayerCards(...args),
  getAdminCardTemplates: (...args: unknown[]) => getAdminCardTemplates(...args),
  grantAdminCard: (...args: unknown[]) => grantAdminCard(...args),
  removeAdminCard: (...args: unknown[]) => removeAdminCard(...args),
  grantAdminXp: (...args: unknown[]) => grantAdminXp(...args),
}))

import { useSession } from '@/lib/supabase/useSession'

const players = [
  {
    id: 'player-1',
    display_name: 'Král Artuš',
    nation: 'england',
    xp: 1250,
    kingdom_name: 'Camelot',
    last_seen_at: '2026-08-17T18:00:00.000Z',
    is_online: true,
    active_battle_id: 'battle-1',
    active_battle_role: 'attacker',
  },
  {
    id: 'player-2',
    display_name: 'Karel',
    nation: 'francia',
    xp: 90,
    kingdom_name: 'Paříž',
    last_seen_at: '2026-08-17T17:45:00.000Z',
    is_online: false,
    active_battle_id: null,
    active_battle_role: null,
  },
]

const activeBattles = [
  {
    id: 'battle-1',
    territory_id: 77,
    territory_x: 10,
    territory_y: 11,
    attacker_display_name: 'Král Artuš',
    defender_display_name: 'Karel',
    current_round: 3,
    status: 'active',
  },
]

const playerCards = [
  {
    instance_id: 'card-1',
    template_id: 'spearmen-common-1',
    template_name: 'Kopiníci',
    template_rank: 'common',
    template_category: 'unit',
    owner_id: 'player-1',
    stationed_territory_id: 77,
    territory_x: 10,
    territory_y: 11,
    status: 'stationed',
  },
]

const templates = [
  {
    id: 'spearmen-common-1',
    name: 'Kopiníci',
    rank: 'common',
    category: 'unit',
    unit_type: 'spearmen',
  },
  {
    id: 'village-common',
    name: 'Vesnice',
    rank: 'common',
    category: 'village',
    unit_type: null,
  },
]

describe('AdminPage', () => {
  beforeEach(() => {
    push.mockClear()
    getAdminStatus.mockReset()
    getAdminOnlinePlayers.mockReset()
    getAdminActiveBattles.mockReset()
    getAdminPlayerCards.mockReset()
    getAdminCardTemplates.mockReset()
    grantAdminCard.mockReset()
    removeAdminCard.mockReset()
    grantAdminXp.mockReset()
    ;(useSession as jest.Mock).mockReturnValue({ user: { id: 'me' }, player: null, loading: false })

    getAdminStatus.mockResolvedValue({ data: { is_admin: true }, error: null })
    getAdminOnlinePlayers.mockResolvedValue({ data: players, error: null })
    getAdminActiveBattles.mockResolvedValue({ data: activeBattles, error: null })
    getAdminPlayerCards.mockResolvedValue({ data: playerCards, error: null })
    getAdminCardTemplates.mockResolvedValue({ data: templates, error: null })
    grantAdminCard.mockResolvedValue({ data: 'new-card', error: null })
    removeAdminCard.mockResolvedValue({ data: null, error: null })
    grantAdminXp.mockResolvedValue({ data: 1400, error: null })
  })

  it('redirects to /login when there is no authenticated user', async () => {
    ;(useSession as jest.Mock).mockReturnValue({ user: null, player: null, loading: false })

    render(<AdminPage />)

    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
    expect(getAdminStatus).not.toHaveBeenCalled()
  })

  it('shows the permission-denied state and does not load admin data for non-admins', async () => {
    getAdminStatus.mockResolvedValue({ data: { is_admin: false }, error: null })

    render(<AdminPage />)

    expect(await screen.findByText('Nemáte oprávnění')).toBeInTheDocument()
    expect(getAdminOnlinePlayers).not.toHaveBeenCalled()
    expect(getAdminActiveBattles).not.toHaveBeenCalled()
    expect(screen.queryByText('Online hráči')).not.toBeInTheDocument()
  })

  it('renders online players and active battles for an admin', async () => {
    const user = userEvent.setup()
    render(<AdminPage />)

    // Section headers are always visible; expand the sections to see content
    expect(await screen.findByText('Online hráči')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Online hráči/i }))
    expect((await screen.findAllByText('Král Artuš')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Karel')).length).toBeGreaterThan(0)

    expect(screen.getByText('Aktivní bitvy')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Aktivní bitvy/i }))
    expect(screen.getByText('(10, 11)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Správa karet/i }))
    expect(await screen.findByText('Kopiníci')).toBeInTheDocument()
  })

  it('submits the card-grant form with the selected values', async () => {
    const user = userEvent.setup()
    render(<AdminPage />)

    expect(await screen.findByText('Správa karet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Správa karet/i }))
    await waitFor(() => expect(screen.getByLabelText('Hráč pro karty').querySelectorAll('option').length).toBeGreaterThan(1))

    await user.selectOptions(screen.getByLabelText('Hráč pro karty'), 'player-2')
    await waitFor(() => expect(getAdminPlayerCards).toHaveBeenLastCalledWith('player-2'))
    await user.selectOptions(screen.getByLabelText('Karta'), 'spearmen-common-1')
    await user.type(screen.getByLabelText('ID území (volitelné)'), '77')
    await user.click(screen.getByRole('button', { name: 'Přidat kartu' }))

    await waitFor(() =>
      expect(grantAdminCard).toHaveBeenCalledWith('player-2', 'spearmen-common-1', 77)
    )
  })

  it('confirms and removes a card instance from the selected player', async () => {
    const user = userEvent.setup()
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)

    render(<AdminPage />)

    await user.click(await screen.findByRole('button', { name: /Správa karet/i }))
    expect(await screen.findByText('Kopiníci')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Odebrat kartu Kopiníci/ }))

    await waitFor(() => expect(removeAdminCard).toHaveBeenCalledWith('card-1'))
    confirmSpy.mockRestore()
  })

  it('submits the XP grant form with the selected player and amount', async () => {
    const user = userEvent.setup()
    render(<AdminPage />)

    expect(await screen.findByText('Správa XP')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Správa XP/i }))
    await waitFor(() => expect(screen.getByLabelText('Hráč pro XP').querySelectorAll('option').length).toBeGreaterThan(1))

    await user.selectOptions(screen.getByLabelText('Hráč pro XP'), 'player-2')
    const input = screen.getByLabelText('XP částka')
    await user.clear(input)
    await user.type(input, '-50')
    await user.click(screen.getByRole('button', { name: 'Přidat XP' }))

    await waitFor(() => expect(grantAdminXp).toHaveBeenCalledWith('player-2', -50))
  })
})



