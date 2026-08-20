import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatWidget } from './ChatWidget'

const listConversations = jest.fn()

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

jest.mock('@/lib/chat/api', () => ({
  listConversations: (...args: unknown[]) => listConversations(...args),
}))

jest.mock('./GlobalChatPanel', () => ({
  GlobalChatPanel: ({ currentPlayerId }: { currentPlayerId: string | null }) => (
    <div>GLOBAL:{currentPlayerId}</div>
  ),
}))

jest.mock('./DmChatPanel', () => ({
  DmChatPanel: ({
    recipientName,
  }: {
    recipientName: string | null
  }) => <div>DM:{recipientName}</div>,
}))

jest.mock('./ConversationList', () => ({
  ConversationList: ({
    onSelectConversation,
  }: {
    onSelectConversation: (conversationId: string) => void
  }) => <button onClick={() => onSelectConversation('conv-1')}>Vybrat konverzaci</button>,
}))

import { useSession } from '@/lib/supabase/useSession'

describe('ChatWidget', () => {
  beforeEach(() => {
    listConversations.mockReset().mockResolvedValue({
      data: [
        {
          conversation_id: 'conv-1',
          other_participant_id: 'player-2',
          other_participant_display_name: 'Druhý hráč',
          last_message_id: 10,
          last_message_sender_id: 'player-2',
          last_message_body: 'Ahoj',
          last_message_created_at: '2026-08-20T10:00:00Z',
          unread_count: 2,
        },
      ],
      error: null,
    })
    ;(useSession as jest.Mock).mockReturnValue({
      user: { id: 'me' },
      player: { onboarding_completed: true },
      loading: false,
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  it('shows the unread badge and opens a fullscreen/mobile-friendly panel', async () => {
    const user = userEvent.setup()
    render(<ChatWidget />)

    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Chat/ }))

    expect(screen.getByTestId('chat-widget-panel')).toHaveClass('fixed', 'inset-0')
    expect(screen.getByText('GLOBAL:me')).toBeInTheDocument()
  })

  it('switches to DM mode and opens the selected conversation', async () => {
    const user = userEvent.setup()
    render(<ChatWidget />)

    await user.click(screen.getByRole('button', { name: /Chat/ }))
    await user.click(screen.getAllByRole('button', { name: 'Zprávy' })[0])
    await user.click(screen.getByRole('button', { name: 'Vybrat konverzaci' }))

    expect(screen.getByText('DM:Druhý hráč')).toBeInTheDocument()
  })
})
