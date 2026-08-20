describe('getVapidConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns the configured VAPID values', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public-key'
    process.env.VAPID_PRIVATE_KEY = 'private-key'
    process.env.VAPID_SUBJECT = 'mailto:test@example.com'

    const { getVapidConfig } = await import('./vapid')

    expect(getVapidConfig()).toEqual({
      publicKey: 'public-key',
      privateKey: 'private-key',
      subject: 'mailto:test@example.com',
    })
  })

  it('throws a clear error when a required env var is missing', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    process.env.VAPID_PUBLIC_KEY = 'public-key'
    process.env.VAPID_SUBJECT = 'mailto:test@example.com'

    const { getVapidConfig } = await import('./vapid')

    expect(() => getVapidConfig()).toThrow('Missing required env var: VAPID_PRIVATE_KEY')
  })
})
