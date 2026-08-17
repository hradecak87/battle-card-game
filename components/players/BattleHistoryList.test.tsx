import { render, screen } from '@testing-library/react'
import BattleHistoryList from './BattleHistoryList'

const getMyBattleHistory = jest.fn()

jest.mock('@/lib/battles/api', () => ({
  getMyBattleHistory: (...args: unknown[]) => getMyBattleHistory(...args),
}))

describe('BattleHistoryList', () => {
  beforeEach(() => {
    getMyBattleHistory.mockReset()
  })

  it('renders wins, losses, NPC battles and expired battles in Czech', async () => {
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
    expect(screen.getByText('Území (3, 4)')).toBeInTheDocument()
    expect(screen.getAllByText('Útočník')).toHaveLength(2)
    expect(screen.getAllByText('Obránce')).toHaveLength(2)
    expect(screen.getByText('Nepřítel')).toBeInTheDocument()
    expect(screen.getByText('NPC')).toBeInTheDocument()
    expect(screen.getByText('Vyhráno')).toBeInTheDocument()
    expect(screen.getAllByText('Prohráno')).toHaveLength(2)
    expect(screen.getByText('Vypršelo bez vítěze')).toBeInTheDocument()
    expect(screen.getByText('+2 vojska / -1 vojsko')).toBeInTheDocument()
    expect(screen.getByText('+1 vojsko / -2 vojska')).toBeInTheDocument()
    expect(screen.getAllByText('Území beze změny')).toHaveLength(2)
    expect(screen.getByText('Území získáno')).toBeInTheDocument()
    expect(screen.getByText('Území ztraceno')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Detail bitvy battle-win' })).toHaveAttribute('href', '/battles/battle-win')
  })

  it('shows an empty state when the player has no resolved battles yet', async () => {
    getMyBattleHistory.mockResolvedValue({ data: [], error: null })

    render(<BattleHistoryList playerId="me" />)

    expect(await screen.findByText('Historie bitev')).toBeInTheDocument()
    expect(screen.getByText('Zatím jsi neodehrál žádnou uzavřenou bitvu.')).toBeInTheDocument()
  })
})
