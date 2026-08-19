import { render, screen } from '@testing-library/react'
import { PlayerProfileCard } from './PlayerProfileCard'

const basePlayer = {
  id: 'player-1',
  display_name: 'Sir Testalot',
  nation: 'england' as const,
  kingdom_name: 'Albion',
  coat_of_arms_id: 'lion-gold',
  onboarding_completed: true,
  is_npc: false,
  npc_next_action_at: null,
  xp: 900,
  king_relocation_used_at: null,
  daily_reward_streak: 0,
  last_daily_reward_at: null,
  created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  last_seen_at: new Date().toISOString(),
  total_playtime_seconds: 3600,
}

describe('PlayerProfileCard', () => {
  it('shows online/offline status for human players', () => {
    render(<PlayerProfileCard player={basePlayer} />)

    expect(screen.getByTestId('online-badge')).toHaveTextContent('Online')
    expect(screen.queryByTestId('npc-badge')).not.toBeInTheDocument()
  })

  it('shows an NPC badge instead of online status for NPC kingdoms', () => {
    render(
      <PlayerProfileCard
        player={{
          ...basePlayer,
          id: 'npc-1',
          display_name: 'NPC Francia',
          is_npc: true,
          last_seen_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        }}
      />
    )

    expect(screen.getByTestId('npc-badge')).toHaveTextContent('NPC')
    expect(screen.queryByText('Online')).not.toBeInTheDocument()
    expect(screen.queryByText('Offline')).not.toBeInTheDocument()
  })
})
