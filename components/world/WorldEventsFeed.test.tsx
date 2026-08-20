import { fireEvent, render, screen } from '@testing-library/react'
import WorldEventsFeed, { formatWorldEventText } from './WorldEventsFeed'
import type { WorldEventRow } from '@/lib/world/api'

describe('formatWorldEventText', () => {
  const base = {
    created_at: '2026-08-20T12:00:00.000Z',
    total_count: 50,
  } as const

  it('formats all supported event types in Czech', () => {
    const cases: Array<[WorldEventRow, string]> = [
      [
        {
          ...base,
          event_type: 'attack_declared',
          payload: { attacker_display_name: 'A', territory_x: 1, territory_y: 2 },
        },
        'A zahájil tažení na území (1, 2)',
      ],
      [
        {
          ...base,
          event_type: 'territory_claimed',
          payload: { player_display_name: 'B', territory_x: 3, territory_y: 4 },
        },
        'B obsadil území (3, 4)',
      ],
      [
        {
          ...base,
          event_type: 'battle_won',
          payload: { winner_display_name: 'C', loser_display_name: 'D', territory_x: 5, territory_y: 6 },
        },
        'C vyhrál bitvu nad D o území (5, 6)',
      ],
      [
        {
          ...base,
          event_type: 'battle_surrendered',
          payload: { winner_display_name: 'E', loser_display_name: 'F', territory_x: 7, territory_y: 8 },
        },
        'F se vzdal v bitvě o území (7, 8) (E vyhrál)',
      ],
      [
        {
          ...base,
          event_type: 'territory_abandoned',
          payload: { player_display_name: 'G', territory_x: 9, territory_y: 10 },
        },
        'G se vzdal území (9, 10)',
      ],
      [
        {
          ...base,
          event_type: 'attack_recalled',
          payload: { attacker_display_name: 'H', territory_x: 11, territory_y: 12 },
        },
        'H odvolal útok na území (11, 12)',
      ],
      [
        {
          ...base,
          event_type: 'king_relocated',
          payload: { player_display_name: 'I', new_home_x: 13, new_home_y: 14 },
        },
        'I přenesl královské sídlo na území (13, 14)',
      ],
      [
        {
          ...base,
          event_type: 'player_leveled_up',
          payload: { player_display_name: 'J', new_level: 15 },
        },
        'J dosáhl levelu 15',
      ],
      [
        {
          ...base,
          event_type: 'player_joined',
          payload: { player_display_name: 'K' },
        },
        'K se připojil do hry',
      ],
    ]

    expect(cases.map(([event]) => formatWorldEventText(event))).toEqual(cases.map(([, text]) => text))
  })
})

describe('WorldEventsFeed', () => {
  it('renders feed links, relative timestamps and pagination controls', () => {
    const onPageChange = jest.fn()
    render(
      <WorldEventsFeed
        events={[
          {
            event_type: 'battle_won',
            created_at: '2026-08-20T11:55:00.000Z',
            payload: {
              winner_display_name: 'Král Artuš',
              winner_home_x: 12,
              winner_home_y: 34,
              loser_display_name: 'Nepřítel',
              loser_home_x: 55,
              loser_home_y: 66,
              territory_x: 7,
              territory_y: 8,
            },
            total_count: 50,
          },
        ]}
        page={1}
        pageSize={10}
        totalCount={50}
        now={new Date('2026-08-20T12:00:00.000Z')}
        onPageChange={onPageChange}
      />
    )

    expect(screen.getByRole('heading', { name: 'Události ve světě' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Král Artuš' })).toHaveAttribute('href', '/map?x=12&y=34')
    expect(screen.getByRole('link', { name: 'Nepřítel' })).toHaveAttribute('href', '/map?x=55&y=66')
    expect(screen.getByRole('link', { name: 'Území (7, 8)' })).toHaveAttribute('href', '/map?x=7&y=8')
    expect(screen.getByText('před 5 min')).toHaveAttribute('title', new Date('2026-08-20T11:55:00.000Z').toLocaleString('cs-CZ'))
    expect(screen.getByText('Strana 2 / 5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Předchozí' }))
    fireEvent.click(screen.getByRole('button', { name: 'Další' }))

    expect(onPageChange).toHaveBeenNthCalledWith(1, 0)
    expect(onPageChange).toHaveBeenNthCalledWith(2, 2)
  })

  it('disables pagination controls at the edges and shows an empty state', () => {
    const onPageChange = jest.fn()
    render(
      <WorldEventsFeed
        events={[]}
        page={0}
        pageSize={10}
        totalCount={0}
        onPageChange={onPageChange}
      />
    )

    expect(screen.getByText('Zatím se nic významného nestalo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Předchozí' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Další' })).toBeDisabled()
    expect(screen.getByText('Strana 1 / 1')).toBeInTheDocument()
  })
})
