import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PushNotificationsButton } from './PushNotificationsButton'

const getSession = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
    },
  },
}))

describe('PushNotificationsButton', () => {
  const originalFetch = global.fetch
  const originalNotification = global.Notification
  const originalServiceWorker = navigator.serviceWorker
  const originalPushManager = window.PushManager

  function setNotificationApi(value: typeof Notification | undefined) {
    ;(global as { Notification?: typeof Notification }).Notification = value
    ;(window as unknown as { Notification?: typeof Notification }).Notification = value
  }

  beforeEach(() => {
    getSession.mockReset().mockResolvedValue({
      data: { session: { access_token: 'session-token' } },
    })
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY =
      'BJjQcFizmtP_KH9ot0Cq54QpqSlktPJhKHOouJNs_B6XlbnvQbNyRd9wpc9408ZZNMWwZLxX6DaEBYqNdI4m9wI'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
    } as Response)
  })

  afterEach(() => {
    global.fetch = originalFetch
    setNotificationApi(originalNotification)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: originalServiceWorker,
    })
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: originalPushManager,
    })
    Object.defineProperty(globalThis, 'PushManager', {
      configurable: true,
      value: originalPushManager,
    })
  })

  it('shows an unsupported-browser message when Push API is unavailable', async () => {
    const user = userEvent.setup()
    setNotificationApi(undefined)
    Reflect.deleteProperty(navigator, 'serviceWorker')
    Reflect.deleteProperty(window, 'PushManager')
    Reflect.deleteProperty(globalThis, 'PushManager')

    render(<PushNotificationsButton />)
    await user.click(screen.getByRole('button', { name: 'Povolit oznámení' }))

    expect(await screen.findByText('Tento prohlížeč nepodporuje push oznámení.')).toBeInTheDocument()
  })

  it('shows a denied-permission message when the user blocks notifications', async () => {
    const user = userEvent.setup()
    const notificationApi = {
      requestPermission: jest.fn().mockResolvedValue('denied'),
    } as unknown as typeof Notification
    setNotificationApi(notificationApi)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: jest.fn() },
    })
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    })
    Object.defineProperty(globalThis, 'PushManager', {
      configurable: true,
      value: window.PushManager,
    })
    expect('serviceWorker' in navigator).toBe(true)
    expect('PushManager' in window).toBe(true)
    expect(global.Notification).toBeDefined()

    render(<PushNotificationsButton />)
    await user.click(screen.getByRole('button', { name: 'Povolit oznámení' }))

    expect(await screen.findByText('Oznámení byla v prohlížeči zablokována.')).toBeInTheDocument()
  })

  it('registers the service worker and posts the subscription after permission is granted', async () => {
    const user = userEvent.setup()
    const subscribe = jest.fn().mockResolvedValue({
      toJSON: () => ({
        endpoint: 'https://example.com/push',
        keys: {
          p256dh: 'p256dh-key',
          auth: 'auth-key',
        },
      }),
    })
    const getSubscription = jest.fn().mockResolvedValue(null)
    const register = jest.fn().mockResolvedValue({
      pushManager: {
        getSubscription,
        subscribe,
      },
    })

    const notificationApi = {
      requestPermission: jest.fn().mockResolvedValue('granted'),
    } as unknown as typeof Notification
    setNotificationApi(notificationApi)
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    })
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    })
    Object.defineProperty(globalThis, 'PushManager', {
      configurable: true,
      value: window.PushManager,
    })
    expect('serviceWorker' in navigator).toBe(true)
    expect('PushManager' in window).toBe(true)
    expect(global.Notification).toBeDefined()

    render(<PushNotificationsButton />)
    await user.click(screen.getByRole('button', { name: 'Povolit oznámení' }))

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith('/sw.js')
      expect(subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          userVisibleOnly: true,
          applicationServerKey: expect.any(Uint8Array),
        }),
      )
      expect(global.fetch).toHaveBeenCalledWith('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session-token',
        },
        body: JSON.stringify({
          endpoint: 'https://example.com/push',
          keys: {
            p256dh: 'p256dh-key',
            auth: 'auth-key',
          },
        }),
      })
    })

    expect(screen.getByText('Oznámení byla povolena.')).toBeInTheDocument()
  })
})
