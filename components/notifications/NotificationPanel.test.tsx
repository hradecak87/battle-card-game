import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NotificationRow } from '@/lib/notifications/types'
import { NotificationPanel } from './NotificationPanel'

const markRead = jest.fn()
const markAllRead = jest.fn()
const getDeepLink = jest.fn()
const push = jest.fn()

jest.mock('@/lib/notifications/api', () => ({
  markRead: (...args: unknown[]) => markRead(...args),
  markAllRead: (...args: unknown[]) => markAllRead(...args),
}))

jest.mock('@/lib/notifications/deepLink', () => ({
  getDeepLink: (...args: unknown[]) => getDeepLink(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
  }),
}))

function createNotification(overrides: Partial<NotificationRow>): NotificationRow {
  return {
    id: 1,
    player_id: 'player-1',
    type: 'attack_incoming',
    payload: {
      territory_id: 12,
      x: 4,
      y: 167,
      other_player_id: 'player-2',
      other_display_name: 'Nepřítel',
    },
    is_read: false,
    created_at: '2026-08-20T12:00:00.000Z',
    ...overrides,
  } as NotificationRow
}

describe('NotificationPanel', () => {
  beforeEach(() => {
    markRead.mockReset().mockResolvedValue({ data: null, error: null })
    markAllRead.mockReset().mockResolvedValue({ data: null, error: null })
    getDeepLink.mockReset().mockReturnValue('/map?x=4&y=167')
    push.mockReset()
  })

  it('renders Czech labels and carries the mobile-sheet and desktop-dropdown responsive classes', () => {
    render(
      <NotificationPanel
        notifications={[
        createNotification({ id: 11, type: 'attack_incoming' }),
        createNotification({
          id: 12,
          type: 'trade_offer_accepted',
          payload: {
            offer_id: 'offer-1',
            other_player_id: 'player-3',
            other_display_name: 'Spojenec',
          },
          is_read: true,
        }),
        createNotification({
          id: 13,
          type: 'attack_cancelled',
          payload: {
            territory_id: 44,
            territory_x: 8,
            territory_y: 12,
            territory_name: 'Hraniční pevnost',
            attacker_display_name: 'Severské NPC',
          },
        }),
        ]}
        refresh={jest.fn()}
        onClose={jest.fn()}
      />,
    )

    expect(screen.getByText('Útok na tvé území')).toBeInTheDocument()
    expect(screen.getByText('Obchodní nabídka přijata')).toBeInTheDocument()
    expect(screen.getByText('NPC útok zrušen')).toBeInTheDocument()
    expect(screen.getByText('Severské NPC')).toBeInTheDocument()
    expect(screen.getByTestId('notification-panel')).toHaveClass(
      'fixed',
      'inset-0',
      'md:absolute',
      'md:inset-auto',
      'md:right-0',
      'md:top-full',
    )
  })

  it('marks a clicked notification as read, refreshes, and navigates to its deep link', async () => {
    const user = userEvent.setup()
    const refresh = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()

    render(<NotificationPanel notifications={[createNotification({ id: 15 })]} refresh={refresh} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /Útok na tvé území/i }))

    expect(markRead).toHaveBeenCalledWith(15)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(push).toHaveBeenCalledWith('/map?x=4&y=167')
    expect(onClose).toHaveBeenCalled()
  })

  it('marks all notifications as read and refreshes the list', async () => {
    const user = userEvent.setup()
    const refresh = jest.fn().mockResolvedValue(undefined)

    render(<NotificationPanel notifications={[createNotification({ id: 20 })]} refresh={refresh} onClose={jest.fn()} />)

    await user.click(screen.getByRole('button', { name: /Označit vše jako přečtené/i }))

    expect(markAllRead).toHaveBeenCalledWith()
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('does not navigate or close the panel when marking a notification read fails', async () => {
    const user = userEvent.setup()
    const refresh = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()

    markRead.mockResolvedValue({ data: null, error: { message: 'selhalo' } })

    render(<NotificationPanel notifications={[createNotification({ id: 21 })]} refresh={refresh} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /Útok na tvé území/i }))

    expect(refresh).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not refresh when marking all notifications read fails', async () => {
    const user = userEvent.setup()
    const refresh = jest.fn().mockResolvedValue(undefined)

    markAllRead.mockResolvedValue({ data: null, error: { message: 'selhalo' } })

    render(<NotificationPanel notifications={[createNotification({ id: 22 })]} refresh={refresh} onClose={jest.fn()} />)

    await user.click(screen.getByRole('button', { name: /Označit vše jako přečtené/i }))

    expect(refresh).not.toHaveBeenCalled()
  })
})
