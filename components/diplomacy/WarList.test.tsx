import { fireEvent, render, screen } from '@testing-library/react'
import { WarList } from './WarList'

describe('WarList', () => {
  it('renders wars with map links and propose action', () => {
    const onPropose = jest.fn()

    render(
      <WarList
        wars={[
          {
            other_player_id: 'player-2',
            other_player_display_name: 'Karel',
            other_kingdom_name: 'Koruna severu',
            other_home_x: 10,
            other_home_y: 20,
            war_started_at: '2026-08-20T10:00:00.000Z',
          },
        ]}
        onPropose={onPropose}
      />,
    )

    expect(screen.getByText('Karel')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Domov \(10, 20\)/ })).toHaveAttribute('href', '/map?x=10&y=20')

    fireEvent.click(screen.getByRole('button', { name: 'Navrhnout mír' }))
    expect(onPropose).toHaveBeenCalledWith('player-2')
  })

  it('shows pending state and full-width cards on mobile-first layout', () => {
    render(
      <WarList
        wars={[
          {
            other_player_id: 'player-2',
            other_player_display_name: 'Karel',
            other_kingdom_name: null,
            other_home_x: null,
            other_home_y: null,
            war_started_at: '2026-08-20T10:00:00.000Z',
          },
        ]}
        pendingTargetIds={['player-2']}
        onPropose={jest.fn()}
      />,
    )

    expect(screen.getByText('Nabídka čeká')).toBeDisabled()
    expect(screen.getByRole('article', { hidden: true })).toHaveClass('w-full')
  })
})
