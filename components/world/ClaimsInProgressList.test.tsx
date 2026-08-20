import { render, screen } from '@testing-library/react'
import ClaimsInProgressList from './ClaimsInProgressList'

describe('ClaimsInProgressList', () => {
  it('renders claimant and territory map links plus ETA', () => {
    render(
      <ClaimsInProgressList
        claims={[
          {
            territory_id: 55,
            claimant_id: 'player-1',
            claimant_display_name: 'Vévoda Jan',
            claimant_home_x: 10,
            claimant_home_y: 11,
            territory_x: 22,
            territory_y: 33,
            claim_completes_at: '2026-08-20T12:45:00.000Z',
          },
        ]}
        now={new Date('2026-08-20T12:00:00.000Z')}
      />
    )

    expect(screen.getByRole('heading', { name: 'Zábory v průběhu' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Vévoda Jan' })).toHaveAttribute('href', '/map?x=10&y=11')
    expect(screen.getByRole('link', { name: 'Území (22, 33)' })).toHaveAttribute('href', '/map?x=22&y=33')
    expect(screen.getByText('za 45 min')).toBeInTheDocument()
  })

  it('shows an empty state when no claims are running', () => {
    render(<ClaimsInProgressList claims={[]} />)

    expect(screen.getByText('Žádné probíhající zábory.')).toBeInTheDocument()
  })
})
