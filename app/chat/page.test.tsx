import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPage from './page'

const listConversations = jest.fn()

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: jest.fn(),
}))

jest.mock('@/lib/chat/api', () => ({
  listConversations: (...args: unknown[]) => listConversations(...args),
}))

jest.mock('@/components/chat/GlobalChatPanel', () => ({
  GlobalChatPanel: ({ currentPlayerId }: { currentPlayerId: string | null }) => (
    <div>GLOBAL:{currentPlayerId}</div>
  ),
}))

jest.mock('@/components/chat/DmChatPanel', () => ({
  DmChatPanel: ({ recipientName }: { recipientName: string | null }) => <div>DM:{recipientName}</div>,
}))

jest.mock('@/components/chat/ConversationList', () => ({
  ConversationList: ({
    onSelectConversation,
  }: {
    onSelectConversation: (conversationId: string) => void
  }) => <button onClick={() => onSelectConversation('conv-1')}>Vybrat konverzaci</button>,
}))

import { useSession } from '@/lib/supabase/useSession'

describe('ChatPage', () => {
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
          unread_count: 1,
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

  it('renders a stacked full-width tab bar suitable for mobile portrait', () => {
    render(<ChatPage />)

    expect(screen.getByTestId('chat-tab-bar')).toHaveClass('flex-col')
    expect(screen.getByRole('button', { name: 'Globální' })).toHaveClass('w-full')
  })

  it('switches to DM mode and shows the selected conversation detail with a back button', async () => {
    const user = userEvent.setup()
    render(<ChatPage />)

    await user.click(screen.getByRole('button', { name: 'Zprávy' }))
    await waitFor(() => expect(listConversations).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Vybrat konverzaci' }))

    expect(screen.getByText('DM:Druhý hráč')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '← Zpět' })).toBeInTheDocument()
  })
})
