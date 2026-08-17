import { getMyBattleHistory } from './api'

const builder: {
  select: jest.Mock
  or: jest.Mock
  in: jest.Mock
  order: jest.Mock
  limit: jest.Mock
} = {
  select: jest.fn(),
  or: jest.fn(),
  in: jest.fn(),
  order: jest.fn(),
  limit: jest.fn(),
}

builder.select.mockImplementation(() => builder)
builder.or.mockImplementation(() => builder)
builder.in.mockImplementation(() => builder)
builder.order.mockImplementation(() => builder)

const from = jest.fn((_table: string) => builder)

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => from(table),
  },
}))

describe('getMyBattleHistory', () => {
  beforeEach(() => {
    from.mockClear()
    builder.select.mockClear()
    builder.or.mockClear()
    builder.in.mockClear()
    builder.order.mockClear()
    builder.limit.mockReset()
  })

  it('loads the player battle history and maps role, opponent, outcome and gains/losses', async () => {
    builder.limit.mockResolvedValue({
      data: [
        {
          id: 'battle-win',
          territory_id: 11,
          attacker_id: 'me',
          defender_id: 'enemy-1',
          is_home_target: false,
          status: 'resolved',
          winner_side: 'attacker',
          resolved_at: '2026-08-17T12:00:00.000Z',
          created_at: '2026-08-17T11:00:00.000Z',
          territories: { x: 3, y: 4 },
          attacker: { id: 'me', display_name: 'Já' },
          defender: { id: 'enemy-1', display_name: 'Nepřítel' },
          battle_rounds: [
            {
              round_number: 1,
              attacker_card_instance_id: 'a1',
              defender_card_instance_id: 'd1',
              winner_card_instance_id: 'a1',
              skipped: false,
            },
            {
              round_number: 2,
              attacker_card_instance_id: 'a2',
              defender_card_instance_id: 'd2',
              winner_card_instance_id: 'd2',
              skipped: false,
            },
            {
              round_number: 3,
              attacker_card_instance_id: 'a3',
              defender_card_instance_id: 'd3',
              winner_card_instance_id: 'a3',
              skipped: false,
            },
          ],
        },
        {
          id: 'battle-loss',
          territory_id: 12,
          attacker_id: 'enemy-2',
          defender_id: 'me',
          is_home_target: false,
          status: 'resolved',
          winner_side: 'attacker',
          resolved_at: '2026-08-16T12:00:00.000Z',
          created_at: '2026-08-16T11:00:00.000Z',
          territories: { x: 5, y: 6 },
          attacker: { id: 'enemy-2', display_name: 'Vetřelec' },
          defender: { id: 'me', display_name: 'Já' },
          battle_rounds: [
            {
              round_number: 1,
              attacker_card_instance_id: 'a4',
              defender_card_instance_id: 'd4',
              winner_card_instance_id: 'a4',
              skipped: false,
            },
            {
              round_number: 2,
              attacker_card_instance_id: 'a5',
              defender_card_instance_id: 'd5',
              winner_card_instance_id: 'd5',
              skipped: false,
            },
          ],
        },
        {
          id: 'battle-npc',
          territory_id: 13,
          attacker_id: 'me',
          defender_id: null,
          is_home_target: false,
          status: 'resolved',
          winner_side: 'defender',
          resolved_at: '2026-08-15T12:00:00.000Z',
          created_at: '2026-08-15T11:00:00.000Z',
          territories: { x: 7, y: 8 },
          attacker: { id: 'me', display_name: 'Já' },
          defender: null,
          battle_rounds: [
            {
              round_number: 1,
              attacker_card_instance_id: 'a6',
              defender_card_instance_id: 'd6',
              winner_card_instance_id: 'd6',
              skipped: false,
            },
          ],
        },
        {
          id: 'battle-expired',
          territory_id: 14,
          attacker_id: 'enemy-3',
          defender_id: 'me',
          is_home_target: true,
          status: 'expired',
          winner_side: null,
          resolved_at: '2026-08-14T12:00:00.000Z',
          created_at: '2026-08-14T11:00:00.000Z',
          territories: { x: 9, y: 10 },
          attacker: { id: 'enemy-3', display_name: 'Oblehatel' },
          defender: { id: 'me', display_name: 'Já' },
          battle_rounds: [
            {
              round_number: 1,
              attacker_card_instance_id: 'a7',
              defender_card_instance_id: null,
              winner_card_instance_id: null,
              skipped: true,
            },
          ],
        },
      ],
      error: null,
    })

    const { data, error } = await getMyBattleHistory('me')

    expect(error).toBeNull()
    expect(from).toHaveBeenCalledWith('battles')
    expect(builder.select.mock.calls[0][0]).toContain('territories(x, y)')
    expect(builder.select.mock.calls[0][0]).toContain('attacker:players!battles_attacker_id_fkey')
    expect(builder.select.mock.calls[0][0]).toContain('defender:players!battles_defender_id_fkey')
    expect(builder.select.mock.calls[0][0]).toContain('battle_rounds(')
    expect(builder.or).toHaveBeenCalledWith('attacker_id.eq.me,defender_id.eq.me')
    expect(builder.in).toHaveBeenCalledWith('status', ['resolved', 'expired'])
    expect(builder.order).toHaveBeenNthCalledWith(1, 'resolved_at', { ascending: false })
    expect(builder.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false })
    expect(builder.limit).toHaveBeenCalledWith(25)

    expect(data).toEqual([
      expect.objectContaining({
        id: 'battle-win',
        role: 'attacker',
        opponent_name: 'Nepřítel',
        outcome: 'won',
        round_count: 3,
        troops_gained: 2,
        troops_lost: 1,
        territory_change: 'gained',
      }),
      expect.objectContaining({
        id: 'battle-loss',
        role: 'defender',
        opponent_name: 'Vetřelec',
        outcome: 'lost',
        round_count: 2,
        troops_gained: 1,
        troops_lost: 1,
        territory_change: 'lost',
      }),
      expect.objectContaining({
        id: 'battle-npc',
        opponent_name: 'NPC',
        outcome: 'lost',
        troops_gained: 0,
        troops_lost: 1,
        territory_change: 'none',
      }),
      expect.objectContaining({
        id: 'battle-expired',
        outcome: 'expired',
        round_count: 1,
        troops_gained: 0,
        troops_lost: 0,
        territory_change: 'none',
      }),
    ])
  })

  it('passes through supabase errors', async () => {
    builder.limit.mockResolvedValue({
      data: null,
      error: { message: 'selhalo' },
    })

    const result = await getMyBattleHistory('me')

    expect(result).toEqual({
      data: null,
      error: { message: 'selhalo' },
    })
  })
})
