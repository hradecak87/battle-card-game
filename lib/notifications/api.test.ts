import {
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
} from './api'

const rpc = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

describe('notifications api wrappers', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('calls list_notifications with nullable cursor pagination', async () => {
    const response = { data: [], error: null }
    rpc.mockResolvedValue(response)

    await expect(listNotifications()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('list_notifications', {
      p_before_id: null,
      p_limit: 20,
    })
  })

  it('passes through a beforeId override for list_notifications', async () => {
    const response = { data: [], error: null }
    rpc.mockResolvedValue(response)

    await expect(listNotifications(55)).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('list_notifications', {
      p_before_id: 55,
      p_limit: 20,
    })
  })

  it('calls get_unread_notification_count without arguments', async () => {
    const response = { data: 3, error: null }
    rpc.mockResolvedValue(response)

    await expect(getUnreadCount()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('get_unread_notification_count')
  })

  it('calls mark_notification_read with the notification id', async () => {
    const response = { data: null, error: null }
    rpc.mockResolvedValue(response)

    await expect(markRead(17)).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('mark_notification_read', {
      p_id: 17,
    })
  })

  it('calls mark_all_notifications_read without arguments', async () => {
    const response = { data: null, error: null }
    rpc.mockResolvedValue(response)

    await expect(markAllRead()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('mark_all_notifications_read')
  })
})
