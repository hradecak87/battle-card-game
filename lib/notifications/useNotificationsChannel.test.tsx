import { act, render, screen, waitFor } from '@testing-library/react'
import { useNotificationsChannel } from './useNotificationsChannel'
import type { NotificationRow } from './types'

const listNotifications = jest.fn()
const getUnreadCount = jest.fn()
const removeChannel = jest.fn()
const subscribe = jest.fn()
const on = jest.fn()
const channel = jest.fn()
const callbacks: Array<() => void> = []

jest.mock('./api', () => ({
  listNotifications: (...args: unknown[]) => listNotifications(...args),
  getUnreadCount: (...args: unknown[]) => getUnreadCount(...args),
}))

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: () => ({
    user: { id: 'player-1' },
  }),
}))

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    channel: (...args: unknown[]) => channel(...args),
    removeChannel: (...args: unknown[]) => removeChannel(...args),
  },
}))

function Harness() {
  const { unreadCount, notifications } = useNotificationsChannel()

  return (
    <div>
      <span data-testid="count">{unreadCount}</span>
      <span data-testid="ids">{notifications.map((notification) => notification.id).join(',')}</span>
    </div>
  )
}

function createNotification(id: number): NotificationRow {
  return {
    id,
    player_id: 'player-1',
    type: 'level_up',
    payload: {
      new_level: id,
    },
    is_read: false,
    created_at: '2026-08-20T12:00:00.000Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('useNotificationsChannel', () => {
  beforeEach(() => {
    callbacks.length = 0
    listNotifications.mockReset()
    getUnreadCount.mockReset()
    channel.mockReset()
    on.mockReset()
    subscribe.mockReset()
    removeChannel.mockReset()

    on.mockImplementation((_event, _filter, callback) => {
      callbacks.push(callback as () => void)
      return { on, subscribe }
    })
    subscribe.mockReturnValue('channel-instance')
    channel.mockReturnValue({ on, subscribe })
  })

  it('loads initial data and subscribes to notification inserts and updates', async () => {
    listNotifications.mockResolvedValue({ data: [createNotification(1)], error: null })
    getUnreadCount.mockResolvedValue({ data: 4, error: null })

    render(<Harness />)

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('4'))
    expect(screen.getByTestId('ids')).toHaveTextContent('1')
    expect(listNotifications).toHaveBeenCalledWith(null, 20)
    expect(getUnreadCount).toHaveBeenCalledWith()
    expect(channel).toHaveBeenCalledWith('notifications-player-1')
    expect(on).toHaveBeenNthCalledWith(
      1,
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: 'player_id=eq.player-1',
      },
      expect.any(Function),
    )
    expect(on).toHaveBeenNthCalledWith(
      2,
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: 'player_id=eq.player-1',
      },
      expect.any(Function),
    )
  })

  it('coalesces overlapping refresh requests from realtime events', async () => {
    listNotifications.mockResolvedValueOnce({ data: [createNotification(1)], error: null })
    getUnreadCount.mockResolvedValueOnce({ data: 1, error: null })

    const notificationsDeferred = deferred<{ data: NotificationRow[]; error: null }>()
    const unreadDeferred = deferred<{ data: number; error: null }>()
    listNotifications.mockReturnValueOnce(notificationsDeferred.promise)
    getUnreadCount.mockReturnValueOnce(unreadDeferred.promise)

    listNotifications.mockResolvedValueOnce({ data: [createNotification(2)], error: null })
    getUnreadCount.mockResolvedValueOnce({ data: 2, error: null })

    render(<Harness />)

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))

    await act(async () => {
      callbacks[0]?.()
      callbacks[1]?.()
    })

    expect(listNotifications).toHaveBeenCalledTimes(2)
    expect(getUnreadCount).toHaveBeenCalledTimes(2)

    await act(async () => {
      notificationsDeferred.resolve({ data: [createNotification(1)], error: null })
      unreadDeferred.resolve({ data: 1, error: null })
      await Promise.resolve()
    })

    await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(getUnreadCount).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'))
    expect(screen.getByTestId('ids')).toHaveTextContent('2')
  })

  it('removes the channel on unmount', async () => {
    listNotifications.mockResolvedValue({ data: [], error: null })
    getUnreadCount.mockResolvedValue({ data: 0, error: null })

    const { unmount } = render(<Harness />)

    await waitFor(() => expect(channel).toHaveBeenCalled())
    unmount()

    expect(removeChannel).toHaveBeenCalledWith('channel-instance')
  })
})
