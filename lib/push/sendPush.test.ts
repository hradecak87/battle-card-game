import type { PushSubscriptionRow } from './sendPush'

const setVapidDetails = jest.fn()
const sendNotification = jest.fn()

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}))

describe('sendPush', () => {
  beforeEach(() => {
    jest.resetModules()
    setVapidDetails.mockReset()
    sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
    process.env.VAPID_PUBLIC_KEY = 'public-key'
    process.env.VAPID_PRIVATE_KEY = 'private-key'
    process.env.VAPID_SUBJECT = 'mailto:test@example.com'
  })

  it('configures web-push and sends the serialized payload', async () => {
    const { sendPush } = await import('./sendPush')
    const subscription: PushSubscriptionRow = {
      id: 1,
      player_id: 'player-1',
      endpoint: 'https://example.com/push',
      p256dh: 'p256dh-key',
      auth: 'auth-key',
      created_at: '2026-08-20T12:00:00.000Z',
    }
    const payload = {
      title: 'Nová zpráva',
      body: 'Posel',
      type: 'dm_message' as const,
      payload: {
        conversation_id: 'conv-1',
        other_player_id: 'player-2',
        other_display_name: 'Posel',
      },
    }

    await sendPush(subscription, payload)

    expect(setVapidDetails).toHaveBeenCalledWith(
      'mailto:test@example.com',
      'public-key',
      'private-key',
    )
    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: 'https://example.com/push',
        keys: {
          p256dh: 'p256dh-key',
          auth: 'auth-key',
        },
      },
      JSON.stringify(payload),
    )
  })
})
