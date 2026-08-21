import { getDeepLink } from './deepLink'
import type { NotificationRow } from './types'

describe('getDeepLink', () => {
  it.each([
    [
      'attack_incoming',
      {
        id: 1,
        player_id: 'player-1',
        type: 'attack_incoming',
        payload: {
          territory_id: 4,
          x: 9,
          y: 13,
          other_player_id: 'player-2',
          other_display_name: 'Útočník',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/map?x=9&y=13',
    ],
    [
      'war_declared',
      {
        id: 2,
        player_id: 'player-1',
        type: 'war_declared',
        payload: {
          other_player_id: 'player-2',
          other_display_name: 'Rival',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/diplomacy',
    ],
    [
      'battle_resolved',
      {
        id: 3,
        player_id: 'player-1',
        type: 'battle_resolved',
        payload: {
          territory_id: 4,
          x: 9,
          y: 13,
          outcome: 'won',
          other_player_id: 'player-2',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/map?x=9&y=13',
    ],
    [
      'territory_lost',
      {
        id: 4,
        player_id: 'player-1',
        type: 'territory_lost',
        payload: {
          territory_id: 4,
          x: 9,
          y: 13,
          other_player_id: 'player-2',
          other_display_name: 'Rival',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/map?x=9&y=13',
    ],
    [
      'attack_cancelled',
      {
        id: 41,
        player_id: 'player-1',
        type: 'attack_cancelled',
        payload: {
          territory_id: 4,
          territory_x: 9,
          territory_y: 13,
          territory_name: 'Pevnost',
          attacker_display_name: 'Severské NPC',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/map?x=9&y=13',
    ],
    [
      'trade_offer_received',
      {
        id: 5,
        player_id: 'player-1',
        type: 'trade_offer_received',
        payload: {
          offer_id: 'offer-1',
          other_player_id: 'player-2',
          other_display_name: 'Kupec',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/exchange',
    ],
    [
      'trade_offer_accepted',
      {
        id: 6,
        player_id: 'player-1',
        type: 'trade_offer_accepted',
        payload: {
          offer_id: 'offer-1',
          other_player_id: 'player-2',
          other_display_name: 'Kupec',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/exchange',
    ],
    [
      'trade_offer_rejected',
      {
        id: 7,
        player_id: 'player-1',
        type: 'trade_offer_rejected',
        payload: {
          offer_id: 'offer-1',
          other_player_id: 'player-2',
          other_display_name: 'Kupec',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/exchange',
    ],
    [
      'peace_offer_received',
      {
        id: 8,
        player_id: 'player-1',
        type: 'peace_offer_received',
        payload: {
          offer_id: 'offer-2',
          other_player_id: 'player-2',
          other_display_name: 'Vyjednavač',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/diplomacy',
    ],
    [
      'level_up',
      {
        id: 9,
        player_id: 'player-1',
        type: 'level_up',
        payload: {
          new_level: 7,
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/profile/me',
    ],
    [
      'dm_message',
      {
        id: 10,
        player_id: 'player-1',
        type: 'dm_message',
        payload: {
          conversation_id: 'conv-1',
          other_player_id: 'player-2',
          other_display_name: 'Posel',
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      },
      '/chat',
    ],
  ] as const)('links %s notifications to the expected route', (_type, notification, expected) => {
    expect(getDeepLink(notification)).toBe(expected)
  })

  it('falls back to /notifications for an unsupported payload shape', () => {
    expect(
      getDeepLink({
        id: 11,
        player_id: 'player-1',
        type: 'attack_incoming',
        payload: {
          territory_id: 4,
        },
        is_read: false,
        created_at: '2026-08-20T12:00:00.000Z',
      } as unknown as NotificationRow),
    ).toBe('/notifications')
  })
})
