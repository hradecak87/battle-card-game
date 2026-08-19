import { fireEvent, render, screen, within } from '@testing-library/react'
import BattleHistoryList from './BattleHistoryList'

const getMyBattleHistory = jest.fn()

jest.mock('@/lib/battles/api', () => ({
  getMyBattleHistory: (...args: unknown[]) => getMyBattleHistory(...args),
}))

describe('BattleHistoryList', () => {
  beforeEach(() => {
    getMyBattleHistory.mockReset()
  })

  it('renders compact battle rows collapsed by default in Czech', async () => {
    getMyBattleHistory.mockResolvedValue({
      data: [
        {
          id: 'battle-win',
          territory_id: 11,
          territory: { x: 3, y: 4 },
          role: 'attacker',
          opponent_name: 'Nepřítel',
          outcome: 'won',
          round_count: 3,
          troops_gained: 2,
          troops_lost: 1,
          territory_change: 'gained',
          resolved_at: '2026-08-17T12:00:00.000Z',
          created_at: '2026-08-17T11:00:00.000Z',
        },
        {
          id: 'battle-loss',
          territory_id: 12,
          territory: { x: 5, y: 6 },
          role: 'defender',
          opponent_name: 'Vetřelec',
          outcome: 'lost',
          round_count: 2,
          troops_gained: 1,
          troops_lost: 2,
          territory_change: 'lost',
          resolved_at: '2026-08-16T12:00:00.000Z',
          created_at: '2026-08-16T11:00:00.000Z',
        },
        {
          id: 'battle-npc',
          territory_id: 13,
          territory: { x: 7, y: 8 },
          role: 'attacker',
          opponent_name: 'NPC',
          outcome: 'lost',
          round_count: 1,
          troops_gained: 0,
          troops_lost: 1,
          territory_change: 'none',
          resolved_at: '2026-08-15T12:00:00.000Z',
          created_at: '2026-08-15T11:00:00.000Z',
        },
        {
          id: 'battle-expired',
          territory_id: 14,
          territory: { x: 9, y: 10 },
          role: 'defender',
          opponent_name: 'Oblehatel',
          outcome: 'expired',
          round_count: 1,
          troops_gained: 0,
          troops_lost: 0,
          territory_change: 'none',
          resolved_at: '2026-08-14T12:00:00.000Z',
          created_at: '2026-08-14T11:00:00.000Z',
        },
      ],
      error: null,
    })

    render(<BattleHistoryList playerId="me" />)

    expect(await screen.findByText('Historie bitev')).toBeInTheDocument()
    expect(screen.getByTestId('battle-history-row-battle-win')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('battle-history-row-battle-loss')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('battle-history-row-battle-npc')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('battle-history-row-battle-expired')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByText('Útočník')).toHaveLength(2)
    expect(screen.getAllByText('Obránce')).toHaveLength(2)
    expect(screen.getByText('Nepřítel')).toBeInTheDocument()
    expect(screen.getByText('NPC')).toBeInTheDocument()
    expect(screen.getByText('Vyhráno')).toBeInTheDocument()
    expect(screen.getAllByText('Prohráno')).toHaveLength(2)
    expect(screen.getByText('Vypršelo bez vítěze')).toBeInTheDocument()
    expect(screen.getByText(new Date('2026-08-17T12:00:00.000Z').toLocaleString('cs-CZ'))).toBeInTheDocument()
    expect(screen.queryByText('+2 vojska / -1 vojsko')).not.toBeInTheDocument()
    expect(screen.queryByText('+1 vojsko / -2 vojska')).not.toBeInTheDocument()
    expect(screen.queryByText('Území beze změny')).not.toBeInTheDocument()
    expect(screen.queryByText('Území získáno')).not.toBeInTheDocument()
    expect(screen.queryByText('Území ztraceno')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Detail bitvy battle-win' })).not.toBeInTheDocument()
  })

  it('expands and collapses a battle row with details and battle link', async () => {
    getMyBattleHistory.mockResolvedValue({
      data: [
        {
          id: 'battle-win',
          territory_id: 11,
          territory: { x: 3, y: 4 },
          role: 'attacker',
          opponent_name: 'Nepřítel',
          outcome: 'won',
          round_count: 3,
          troops_gained: 2,
          troops_lost: 1,
          territory_change: 'gained',
          resolved_at: '2026-08-17T12:00:00.000Z',
          created_at: '2026-08-17T11:00:00.000Z',
        },
      ],
      error: null,
    })

    render(<BattleHistoryList playerId="me" />)

    const row = await screen.findByTestId('battle-history-row-battle-win')
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Území (3, 4)')).not.toBeInTheDocument()

    fireEvent.click(row)

    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('battle-history-details-battle-win')).toHaveTextContent('Území: (3, 4)')
    expect(screen.getByText('3 kola')).toBeInTheDocument()
    expect(screen.getByText('+2 vojska / -1 vojsko')).toBeInTheDocument()
    expect(screen.getByText('Území získáno')).toBeInTheDocument()
    expect(within(screen.getByTestId('battle-history-details-battle-win')).getByRole('link', { name: 'Detail bitvy battle-win' })).toHaveAttribute('href', '/battles/battle-win')

    fireEvent.click(row)

    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('battle-history-details-battle-win')).not.toBeInTheDocument()
  })

  it('shows an empty state when the player has no resolved battles yet', async () => {
    getMyBattleHistory.mockResolvedValue({ data: [], error: null })

    render(<BattleHistoryList playerId="me" />)

    expect(await screen.findByText('Historie bitev')).toBeInTheDocument()
    expect(screen.getByText('Zatím jsi neodehrál žádnou uzavřenou bitvu.')).toBeInTheDocument()
  })
})
