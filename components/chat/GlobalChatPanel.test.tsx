import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GlobalChatPanel } from './GlobalChatPanel'

const listGlobalMessages = jest.fn()
const sendMessage = jest.fn()

jest.mock('@/lib/chat/api', () => ({
  listGlobalMessages: (...args: unknown[]) => listGlobalMessages(...args),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
  isValidMessageBody: (body: string) => body.trim().length >= 1 && body.trim().length <= 500,
}))

describe('GlobalChatPanel', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    listGlobalMessages.mockReset()
    sendMessage.mockReset()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('loads global messages and sends a new one', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    listGlobalMessages.mockResolvedValue({
      data: [
        {
          id: 1,
          sender_id: 'other',
          sender_display_name: 'Druhý',
          channel_type: 'global',
          conversation_id: null,
          recipient_id: null,
          body: 'Nazdar',
          created_at: '2026-08-20T10:00:00Z',
          deleted_at: null,
        },
      ],
      error: null,
    })
    sendMessage.mockResolvedValue({
      data: { id: 2, conversation_id: null },
      error: null,
    })

    render(<GlobalChatPanel currentPlayerId="me" />)

    expect(await screen.findByText('Nazdar')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Napiš do globálního chatu…'), 'Ahoj světe')
    await user.click(screen.getByRole('button', { name: 'Odeslat' }))

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        channelType: 'global',
        body: 'Ahoj světe',
      }),
    )
    await waitFor(() => expect(listGlobalMessages).toHaveBeenCalledTimes(2))
  })

  it('polls only while the document is visible', async () => {
    listGlobalMessages.mockResolvedValue({ data: [], error: null })

    render(<GlobalChatPanel currentPlayerId="me" />)
    await waitFor(() => expect(listGlobalMessages).toHaveBeenCalledTimes(1))

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })

    act(() => {
      jest.advanceTimersByTime(4000)
    })

    expect(listGlobalMessages).toHaveBeenCalledTimes(1)
  })
})
