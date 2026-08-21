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
      [
        {
          ...base,
          event_type: 'war_declared',
          payload: { attacker_display_name: 'L', defender_display_name: 'M' },
        },
        'L vyhlásil válku hráči M',
      ],
      [
        {
          ...base,
          event_type: 'peace_signed',
          payload: { player_a_display_name: 'N', player_b_display_name: 'O', had_tribute: true },
        },
        'N a O uzavřeli mír za tribut',
      ],
      [
        {
          ...base,
          event_type: 'claim_started',
          payload: { player_display_name: 'P', territory_x: 16, territory_y: 17 },
        },
        'P zahájil zábor území (16, 17)',
      ],
      [
        {
          ...base,
          event_type: 'coalition_created',
          payload: { leader_display_name: 'Q', coalition_name: 'Jantar' },
        },
        'Q založil koalici Jantar',
      ],
      [
        {
          ...base,
          event_type: 'coalition_member_joined',
          payload: { player_display_name: 'R', coalition_name: 'Jantar' },
        },
        'R vstoupil do koalice Jantar',
      ],
      [
        {
          ...base,
          event_type: 'coalition_member_left',
          payload: { player_display_name: 'S', coalition_name: 'Jantar' },
        },
        'S opustil koalici Jantar',
      ],
      [
        {
          ...base,
          event_type: 'coalition_member_kicked',
          payload: { player_display_name: 'T', coalition_name: 'Jantar' },
        },
        'T byl vyhozen z koalice Jantar',
      ],
      [
        {
          ...base,
          event_type: 'coalition_leadership_transferred',
          payload: { old_leader_display_name: 'U', coalition_name: 'Jantar', new_leader_display_name: 'V' },
        },
        'U předal vedení koalice Jantar hráči V',
      ],
      [
        {
          ...base,
          event_type: 'coalition_disbanded',
          payload: { leader_display_name: 'W', coalition_name: 'Jantar' },
        },
        'W rozpustil koalici Jantar',
      ],
      [
        {
          ...base,
          event_type: 'coalition_war_declared',
          payload: { coalition_name: 'Jantar', target_display_name: 'X' },
        },
        'Koalice Jantar vyhlásila válku hráči X',
      ],
      [
        {
          ...base,
          event_type: 'coalition_peace_signed',
          payload: { coalition_name: 'Jantar', target_display_name: 'Y' },
        },
        'Koalice Jantar navrhla mír hráči Y',
      ],
      [
        {
          ...base,
          event_type: 'non_aggression_signed',
          payload: { player_a_display_name: 'Z', player_b_display_name: 'AA' },
        },
        'Z uzavřel pakt o neútočení s hráčem AA',
      ],
      [
        {
          ...base,
          event_type: 'non_aggression_broken',
          payload: { player_a_display_name: 'AB', player_b_display_name: 'AC' },
        },
        'AB zrušil pakt o neútočení s hráčem AC',
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

  it('renders diplomacy event links with correct wording', () => {
    render(
      <WorldEventsFeed
        events={[
          {
            event_type: 'war_declared',
            created_at: '2026-08-20T11:55:00.000Z',
            payload: {
              attacker_display_name: 'Král Artuš',
              attacker_home_x: 12,
              attacker_home_y: 34,
              defender_display_name: 'Král Jan',
              defender_home_x: 56,
              defender_home_y: 78,
            },
            total_count: 2,
          },
          {
            event_type: 'peace_signed',
            created_at: '2026-08-20T11:50:00.000Z',
            payload: {
              player_a_display_name: 'Král Artuš',
              player_a_home_x: 12,
              player_a_home_y: 34,
              player_b_display_name: 'Král Jan',
              player_b_home_x: 56,
              player_b_home_y: 78,
              had_tribute: false,
            },
            total_count: 2,
          },
        ]}
        page={0}
        pageSize={10}
        totalCount={2}
        now={new Date('2026-08-20T12:00:00.000Z')}
        onPageChange={jest.fn()}
      />
    )

    expect(screen.getAllByRole('link', { name: 'Král Artuš' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'Král Jan' })).toHaveLength(2)
    expect(screen.getByText('vyhlásil válku hráči', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('uzavřeli bílý mír', { exact: false })).toBeInTheDocument()
  })

  it('renders a claim_started event with links to the claimant and the claimed territory', () => {
    render(
      <WorldEventsFeed
        events={[
          {
            event_type: 'claim_started',
            created_at: '2026-08-20T11:55:00.000Z',
            payload: {
              player_display_name: 'NPC Král',
              player_home_x: 20,
              player_home_y: 30,
              territory_id: 99,
              territory_x: 40,
              territory_y: 50,
            },
            total_count: 1,
          },
        ]}
        page={0}
        pageSize={10}
        totalCount={1}
        now={new Date('2026-08-20T12:00:00.000Z')}
        onPageChange={jest.fn()}
      />
    )

    expect(screen.getByRole('link', { name: 'NPC Král' })).toHaveAttribute('href', '/map?x=20&y=30')
    expect(screen.getByRole('link', { name: 'Území (40, 50)' })).toHaveAttribute('href', '/map?x=40&y=50')
    expect(screen.getByText('zahájil zábor', { exact: false })).toBeInTheDocument()
  })

  it('renders coalition and pact events with the expected Czech wording and links', () => {
    render(
      <WorldEventsFeed
        events={[
          {
            event_type: 'coalition_created',
            created_at: '2026-08-20T11:55:00.000Z',
            payload: {
              coalition_name: 'Jantar',
              leader_display_name: 'Zakladatel',
              leader_home_x: 1,
              leader_home_y: 2,
            },
            total_count: 10,
          },
          {
            event_type: 'coalition_member_joined',
            created_at: '2026-08-20T11:54:00.000Z',
            payload: {
              coalition_name: 'Jantar',
              player_display_name: 'Nový člen',
              player_home_x: 3,
              player_home_y: 4,
            },
            total_count: 10,
          },
          {
            event_type: 'coalition_member_left',
            created_at: '2026-08-20T11:53:00.000Z',
            payload: {
              coalition_name: 'Jantar',
              player_display_name: 'Odcházející',
              player_home_x: 5,
              player_home_y: 6,
            },
            total_count: 10,
          },
          {
            event_type: 'coalition_member_kicked',
            created_at: '2026-08-20T11:52:00.000Z',
            payload: {
              coalition_name: 'Jantar',
              player_display_name: 'Vyhozený',
              player_home_x: 7,
              player_home_y: 8,
            },
            total_count: 10,
          },
          {
            event_type: 'coalition_leadership_transferred',
            created_at: '2026-08-20T11:51:00.000Z',
            payload: {
              coalition_name: 'Jantar',
              old_leader_display_name: 'Starý vůdce',
              old_leader_home_x: 9,
              old_leader_home_y: 10,
              new_leader_display_name: 'Nový vůdce',
              new_leader_home_x: 11,
              new_leader_home_y: 12,
            },
            total_count: 10,
          },
          {
            event_type: 'coalition_disbanded',
            created_at: '2026-08-20T11:50:00.000Z',
            payload: {
              coalition_name: 'Jantar',
              leader_display_name: 'Poslední vůdce',
              leader_home_x: 13,
              leader_home_y: 14,
            },
            total_count: 10,
          },
          {
            event_type: 'coalition_war_declared',
            created_at: '2026-08-20T11:49:00.000Z',
            payload: {
              coalition_name: 'Jantar',
              target_display_name: 'Nepřítel',
              target_home_x: 15,
              target_home_y: 16,
            },
            total_count: 10,
          },
          {
            event_type: 'coalition_peace_signed',
            created_at: '2026-08-20T11:48:00.000Z',
            payload: {
              coalition_name: 'Jantar',
              target_display_name: 'Vyjednavač',
              target_home_x: 17,
              target_home_y: 18,
            },
            total_count: 10,
          },
          {
            event_type: 'non_aggression_signed',
            created_at: '2026-08-20T11:47:00.000Z',
            payload: {
              player_a_display_name: 'Pakt A',
              player_a_home_x: 19,
              player_a_home_y: 20,
              player_b_display_name: 'Pakt B',
              player_b_home_x: 21,
              player_b_home_y: 22,
            },
            total_count: 10,
          },
          {
            event_type: 'non_aggression_broken',
            created_at: '2026-08-20T11:46:00.000Z',
            payload: {
              player_a_display_name: 'Rozvraceč',
              player_a_home_x: 23,
              player_a_home_y: 24,
              player_b_display_name: 'Bývalý spojenec',
              player_b_home_x: 25,
              player_b_home_y: 26,
            },
            total_count: 10,
          },
        ]}
        page={0}
        pageSize={10}
        totalCount={10}
        now={new Date('2026-08-20T12:00:00.000Z')}
        onPageChange={jest.fn()}
      />
    )

    expect(screen.getByRole('link', { name: 'Zakladatel' })).toHaveAttribute('href', '/map?x=1&y=2')
    expect(screen.getByText('založil koalici Jantar', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nový člen' })).toHaveAttribute('href', '/map?x=3&y=4')
    expect(screen.getByText('vstoupil do koalice Jantar', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Odcházející' })).toHaveAttribute('href', '/map?x=5&y=6')
    expect(screen.getByText('opustil koalici Jantar', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Vyhozený' })).toHaveAttribute('href', '/map?x=7&y=8')
    expect(screen.getByText('byl vyhozen z koalice Jantar', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Starý vůdce' })).toHaveAttribute('href', '/map?x=9&y=10')
    expect(screen.getByRole('link', { name: 'Nový vůdce' })).toHaveAttribute('href', '/map?x=11&y=12')
    expect(screen.getByText('předal vedení koalice Jantar hráči', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Poslední vůdce' })).toHaveAttribute('href', '/map?x=13&y=14')
    expect(screen.getByText('rozpustil koalici Jantar', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nepřítel' })).toHaveAttribute('href', '/map?x=15&y=16')
    expect(screen.getByText('Koalice Jantar vyhlásila válku hráči', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Vyjednavač' })).toHaveAttribute('href', '/map?x=17&y=18')
    expect(screen.getByText('Koalice Jantar navrhla mír hráči', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pakt A' })).toHaveAttribute('href', '/map?x=19&y=20')
    expect(screen.getByRole('link', { name: 'Pakt B' })).toHaveAttribute('href', '/map?x=21&y=22')
    expect(screen.getByText('uzavřel pakt o neútočení s hráčem', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rozvraceč' })).toHaveAttribute('href', '/map?x=23&y=24')
    expect(screen.getByRole('link', { name: 'Bývalý spojenec' })).toHaveAttribute('href', '/map?x=25&y=26')
    expect(screen.getByText('zrušil pakt o neútočení s hráčem', { exact: false })).toBeInTheDocument()
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
