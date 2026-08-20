import { render, screen } from '@testing-library/react'
import AttacksInTransitList from './AttacksInTransitList'

describe('AttacksInTransitList', () => {
  it('renders attacker and target map links plus ETA', () => {
    render(
      <AttacksInTransitList
        attacks={[
          {
            movement_id: 'move-1',
            attacker_id: 'player-1',
            attacker_display_name: 'Král Artuš',
            attacker_home_x: 12,
            attacker_home_y: 34,
            target_territory_id: 99,
            target_x: 56,
            target_y: 78,
            arrives_at: '2026-08-20T12:14:00.000Z',
          },
        ]}
        now={new Date('2026-08-20T12:00:00.000Z')}
      />
    )

    expect(screen.getByRole('heading', { name: 'Útoky na cestě' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Král Artuš' })).toHaveAttribute('href', '/map?x=12&y=34')
    expect(screen.getByRole('link', { name: 'Území (56, 78)' })).toHaveAttribute('href', '/map?x=56&y=78')
    expect(screen.getByText('za 14 min')).toBeInTheDocument()
  })

  it('shows an empty state when no attacks are in transit', () => {
    render(<AttacksInTransitList attacks={[]} />)

    expect(screen.getByText('Žádné útoky na cestě.')).toBeInTheDocument()
  })
})
