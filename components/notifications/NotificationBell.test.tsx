import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NotificationRow } from '@/lib/notifications/types'
import { NotificationBell } from './NotificationBell'

const useNotificationsChannel = jest.fn()
const notificationPanel = jest.fn()

jest.mock('@/lib/notifications/useNotificationsChannel', () => ({
  useNotificationsChannel: () => useNotificationsChannel(),
}))

jest.mock('./NotificationPanel', () => ({
  NotificationPanel: (props: unknown) => {
    notificationPanel(props)
    const { notifications } = props as { notifications: NotificationRow[] }
    return <div data-testid="notification-panel">Panel:{notifications.length}</div>
  },
}))

describe('NotificationBell', () => {
  beforeEach(() => {
    notificationPanel.mockReset()
    useNotificationsChannel.mockReset().mockReturnValue({
      unreadCount: 0,
      notifications: [],
      refresh: jest.fn(),
    })
  })

  it('shows the unread badge only when there are unread notifications', () => {
    useNotificationsChannel.mockReturnValue({
      unreadCount: 3,
      notifications: [],
      refresh: jest.fn(),
    })

    const { rerender } = render(<NotificationBell />)

    expect(screen.getByText('3')).toBeInTheDocument()

    useNotificationsChannel.mockReturnValue({
      unreadCount: 0,
      notifications: [],
      refresh: jest.fn(),
    })

    rerender(<NotificationBell />)

    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('toggles the panel open and closed when the bell is clicked', async () => {
    const user = userEvent.setup()
    const refresh = jest.fn()
    useNotificationsChannel.mockReturnValue({
      unreadCount: 2,
      notifications: [
        {
          id: 1,
          player_id: 'player-1',
          type: 'level_up',
          payload: { new_level: 2 },
          is_read: false,
          created_at: '2026-08-20T12:00:00.000Z',
        },
      ],
      refresh,
    })

    render(<NotificationBell />)

    expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Oznámení' }))
    expect(screen.getByTestId('notification-panel')).toBeInTheDocument()
    expect(screen.getByText('Panel:1')).toBeInTheDocument()
    expect(notificationPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: expect.arrayContaining([expect.objectContaining({ id: 1 })]),
        refresh,
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Oznámení' }))
    expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument()
  })
})
