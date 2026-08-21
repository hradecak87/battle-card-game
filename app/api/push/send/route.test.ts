/**
 * @jest-environment node
 */

export {}

const select = jest.fn()
const eq = jest.fn()
const deleteEq = jest.fn()
const deleteChain = jest.fn()
const from = jest.fn()
const createClient = jest.fn()
const sendPush = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))

jest.mock('@/lib/push/sendPush', () => ({
  sendPush: (...args: unknown[]) => sendPush(...args),
}))

describe('POST /api/push/send', () => {
  beforeEach(() => {
    jest.resetModules()
    select.mockReset()
    eq.mockReset()
    deleteEq.mockReset()
    deleteChain.mockReset()
    from.mockReset()
    createClient.mockReset()
    sendPush.mockReset()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    process.env.PUSH_WEBHOOK_SECRET = 'super-secret-value'

    eq.mockResolvedValue({
      data: [
        {
          id: 1,
          player_id: 'player-1',
          endpoint: 'https://example.com/sub-1',
          p256dh: 'p256dh-1',
          auth: 'auth-1',
          created_at: '2026-08-20T12:00:00.000Z',
        },
        {
          id: 2,
          player_id: 'player-1',
          endpoint: 'https://example.com/sub-2',
          p256dh: 'p256dh-2',
          auth: 'auth-2',
          created_at: '2026-08-20T12:00:00.000Z',
        },
      ],
      error: null,
    })

    select.mockReturnValue({ eq })
    deleteEq.mockResolvedValue({ error: null })
    deleteChain.mockReturnValue({ eq: deleteEq })

    from.mockImplementation((table: string) => {
      if (table === 'push_subscriptions') {
        return {
          select,
          delete: deleteChain,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    createClient.mockReturnValue({
      from,
    })
  })

  it('returns 401 when the webhook secret is missing or incorrect', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/push/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'INSERT',
          table: 'notifications',
          record: {
            id: 1,
            player_id: 'player-1',
            type: 'level_up',
            payload: { new_level: 2 },
            is_read: false,
            created_at: '2026-08-20T12:00:00.000Z',
          },
        }),
      }),
    )

    expect(response.status).toBe(401)
    expect(sendPush).not.toHaveBeenCalled()
  })

  it('sends one push per subscription for a valid webhook payload', async () => {
    sendPush.mockResolvedValue({ statusCode: 201 })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/push/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-push-webhook-secret': 'super-secret-value',
        },
        body: JSON.stringify({
          type: 'INSERT',
          table: 'notifications',
          record: {
            id: 1,
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
        }),
      }),
    )

    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'service-role-key',
      expect.any(Object),
    )
    expect(select).toHaveBeenCalledWith('id, player_id, endpoint, p256dh, auth, created_at')
    expect(eq).toHaveBeenCalledWith('player_id', 'player-1')
    expect(sendPush).toHaveBeenCalledTimes(2)
    expect(sendPush).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        title: 'Nová obchodní nabídka',
        body: 'Kupec',
        type: 'trade_offer_received',
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, delivered: 2 })
  })


  it('formats attack_cancelled pushes with the NPC attacker name and map payload', async () => {
    sendPush.mockResolvedValue({ statusCode: 201 })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/push/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-push-webhook-secret': 'super-secret-value',
        },
        body: JSON.stringify({
          type: 'INSERT',
          table: 'notifications',
          record: {
            id: 2,
            player_id: 'player-1',
            type: 'attack_cancelled',
            payload: {
              territory_id: 9,
              territory_x: 2,
              territory_y: 7,
              territory_name: 'Pohraničí',
              attacker_display_name: 'Severské NPC',
            },
            is_read: false,
            created_at: '2026-08-20T12:00:00.000Z',
          },
        }),
      }),
    )

    expect(sendPush).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        title: 'NPC útok zrušen',
        body: 'Severské NPC',
        type: 'attack_cancelled',
      }),
    )
    expect(response.status).toBe(200)
  })

  it('deletes only the expired subscription when a push service returns 410', async () => {
    sendPush
      .mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }))
      .mockResolvedValueOnce({ statusCode: 201 })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/push/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-push-webhook-secret': 'super-secret-value',
        },
        body: JSON.stringify({
          type: 'UPDATE',
          table: 'notifications',
          record: {
            id: 5,
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
        }),
      }),
    )

    expect(deleteChain).toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('id', 1)
    expect(sendPush).toHaveBeenCalledTimes(2)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, delivered: 1 })
  })
})
