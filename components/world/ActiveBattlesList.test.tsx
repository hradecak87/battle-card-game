import { render, screen } from '@testing-library/react'
import ActiveBattlesList from './ActiveBattlesList'

describe('ActiveBattlesList', () => {
  it('renders attacker, defender and territory links with localized status', () => {
    render(
      <ActiveBattlesList
        battles={[
          {
            battle_id: 'battle-1',
            attacker_id: 'attacker-1',
            attacker_display_name: 'Útočník',
            attacker_home_x: 1,
            attacker_home_y: 2,
            defender_id: 'defender-1',
            defender_display_name: 'Obránce',
            defender_home_x: 3,
            defender_home_y: 4,
            territory_id: 77,
            territory_x: 5,
            territory_y: 6,
            status: 'active',
            current_round: 3,
          },
          {
            battle_id: 'battle-2',
            attacker_id: 'attacker-2',
            attacker_display_name: 'Nájezdník',
            attacker_home_x: 7,
            attacker_home_y: 8,
            defender_id: null,
            defender_display_name: null,
            defender_home_x: null,
            defender_home_y: null,
            territory_id: 88,
            territory_x: 9,
            territory_y: 10,
            status: 'awaiting_ready',
            current_round: 0,
          },
        ]}
      />
    )

    expect(screen.getByRole('heading', { name: 'Aktivní bitvy' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Útočník' })).toHaveAttribute('href', '/map?x=1&y=2')
    expect(screen.getByRole('link', { name: 'Obránce' })).toHaveAttribute('href', '/map?x=3&y=4')
    expect(screen.getByRole('link', { name: 'Území (5, 6)' })).toHaveAttribute('href', '/map?x=5&y=6')
    expect(screen.getByText('Probíhá kolo 3')).toBeInTheDocument()
    expect(screen.getByText('Čeká na ready')).toBeInTheDocument()
    expect(screen.getByText('NPC')).toBeInTheDocument()
  })

  it('shows an empty state when there are no active battles', () => {
    render(<ActiveBattlesList battles={[]} />)

    expect(screen.getByText('Žádné aktivní bitvy.')).toBeInTheDocument()
  })
})
