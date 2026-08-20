import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NotificationsPage from './page'

const listNotifications = jest.fn()
const push = jest.fn()
const router = { push }

jest.mock('next/navigation', () => ({
  useRouter: () => router,
}))

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

jest.mock('@/lib/notifications/api', () => ({
  listNotifications: (...args: unknown[]) => listNotifications(...args),
}))

jest.mock('@/components/notifications/NotificationList', () => ({
  NotificationList: ({
    notifications,
  }: {
    notifications: Array<{ id: number; type: string }>
  }) => (
    <div>
      {notifications.map((notification) => (
        <div key={notification.id}>{notification.type}</div>
      ))}
    </div>
  ),
}))

import { useSession } from '@/lib/supabase/useSession'

describe('NotificationsPage', () => {
  beforeEach(() => {
    listNotifications.mockReset()
    push.mockReset()
    listNotifications.mockResolvedValue({ data: [], error: null })
  })

  it('redirects to login when there is no user', () => {
    ;(useSession as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
    })

    render(<NotificationsPage />)

    expect(push).toHaveBeenCalledWith('/login')
  })

  it('loads notifications and paginates with the load-more button', async () => {
    const user = userEvent.setup()

    ;(useSession as jest.Mock).mockReturnValue({
      user: { id: 'player-1' },
      loading: false,
    })

    listNotifications
      .mockResolvedValueOnce({
        data: Array.from({ length: 40 }, (_, index) => ({
          id: 100 - index,
          player_id: 'player-1',
          type: 'attack_incoming',
          payload: {
            territory_id: 1,
            x: 4,
            y: 167,
            other_player_id: 'player-2',
            other_display_name: 'Nepřítel',
          },
          is_read: false,
          created_at: '2026-08-20T12:00:00.000Z',
        })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 60,
            player_id: 'player-1',
            type: 'level_up',
            payload: { new_level: 7 },
            is_read: true,
            created_at: '2026-08-20T12:10:00.000Z',
          },
        ],
        error: null,
      })

    render(<NotificationsPage />)

    await waitFor(() => expect(screen.getByText('Historie oznámení')).toBeInTheDocument())
    expect(listNotifications).toHaveBeenCalledWith(null, 40)
    expect(screen.getByRole('button', { name: 'Načíst další' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Načíst další' }))

    await waitFor(() => expect(listNotifications).toHaveBeenCalledWith(61, 40))
    expect(screen.getByText('level_up')).toBeInTheDocument()
  })
})
