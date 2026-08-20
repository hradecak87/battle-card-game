import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DmChatPanel } from './DmChatPanel'

const listDmMessages = jest.fn()
const markRead = jest.fn()
const sendMessage = jest.fn()

jest.mock('@/lib/chat/api', () => ({
  listDmMessages: (...args: unknown[]) => listDmMessages(...args),
  markRead: (...args: unknown[]) => markRead(...args),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
  isValidMessageBody: (body: string) => body.trim().length >= 1 && body.trim().length <= 500,
}))

describe('DmChatPanel', () => {
  beforeEach(() => {
    listDmMessages.mockReset()
    markRead.mockReset()
    sendMessage.mockReset()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  it('shows a placeholder when no conversation is selected', () => {
    render(<DmChatPanel currentPlayerId="me" conversationId={null} recipientId={null} />)

    expect(screen.getByText('Vyber konverzaci.')).toBeInTheDocument()
  })

  it('loads, marks read, and sends a DM', async () => {
    const user = userEvent.setup()
    const onConversationCreated = jest.fn()
    listDmMessages.mockResolvedValue({
      data: [
        {
          id: 5,
          sender_id: 'player-2',
          sender_display_name: 'Druhý',
          channel_type: 'dm',
          conversation_id: 'conv-1',
          recipient_id: 'me',
          body: 'Ahoj',
          created_at: '2026-08-20T10:00:00Z',
          deleted_at: null,
        },
      ],
      error: null,
    })
    markRead.mockResolvedValue({ data: null, error: null })
    sendMessage.mockResolvedValue({
      data: {
        id: 6,
        sender_id: 'me',
        channel_type: 'dm',
        conversation_id: 'conv-1',
        recipient_id: 'player-2',
        body: 'Nazdar',
        created_at: '2026-08-20T10:05:00Z',
        deleted_at: null,
        deleted_by: null,
      },
      error: null,
    })

    render(
      <DmChatPanel
        currentPlayerId="me"
        conversationId="conv-1"
        recipientId="player-2"
        recipientName="Druhý"
        onConversationCreated={onConversationCreated}
      />,
    )

    expect(await screen.findByText('Ahoj')).toBeInTheDocument()
    await waitFor(() => expect(markRead).toHaveBeenCalledWith('conv-1'))

    await user.type(screen.getByPlaceholderText('Napiš soukromou zprávu…'), 'Nazdar')
    await user.click(screen.getByRole('button', { name: 'Odeslat' }))

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        channelType: 'dm',
        recipientId: 'player-2',
        body: 'Nazdar',
      }),
    )
    expect(onConversationCreated).toHaveBeenCalledWith('conv-1')
  })
})
