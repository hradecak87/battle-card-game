/**
 * @jest-environment node
 */

export {}

const getUser = jest.fn()
const upsert = jest.fn()
const from = jest.fn()
const createClient = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))

describe('POST /api/push/subscribe', () => {
  beforeEach(() => {
    jest.resetModules()
    getUser.mockReset()
    upsert.mockReset()
    from.mockReset()
    createClient.mockReset()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

    from.mockReturnValue({
      upsert,
    })

    createClient.mockReturnValue({
      auth: {
        getUser,
      },
      from,
    })
  })

  it('returns 401 when the caller is unauthenticated', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/push/subscribe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          endpoint: 'https://example.com/push',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        }),
      }),
    )

    expect(response.status).toBe(401)
  })

  it('upserts the subscription for the authenticated player', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'player-1' } },
      error: null,
    })
    upsert.mockResolvedValue({ error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/push/subscribe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          endpoint: 'https://example.com/push',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        }),
      }),
    )

    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({
        global: {
          headers: {
            Authorization: 'Bearer test-token',
          },
        },
      }),
    )
    expect(from).toHaveBeenCalledWith('push_subscriptions')
    expect(upsert).toHaveBeenCalledWith(
      {
        player_id: 'player-1',
        endpoint: 'https://example.com/push',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
      },
      {
        onConflict: 'endpoint',
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('returns 400 for an invalid subscription payload', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'player-1' } },
      error: null,
    })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/push/subscribe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          endpoint: 'https://example.com/push',
          keys: { p256dh: 'p256dh-key' },
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })
})
