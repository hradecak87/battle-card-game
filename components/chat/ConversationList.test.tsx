import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConversationList } from './ConversationList'

describe('ConversationList', () => {
  it('renders unread badges and notifies selection', async () => {
    const user = userEvent.setup()
    const onSelectConversation = jest.fn()

    render(
      <ConversationList
        activeConversationId={null}
        onSelectConversation={onSelectConversation}
        conversations={[
          {
            conversation_id: 'conv-1',
            other_participant_id: 'player-2',
            other_participant_display_name: 'Druhý hráč',
            last_message_id: 10,
            last_message_sender_id: 'player-2',
            last_message_body: 'Ahoj',
            last_message_created_at: '2026-08-20T10:00:00Z',
            unread_count: 3,
          },
        ]}
      />,
    )

    expect(screen.getByText('3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Druhý hráč/ }))
    expect(onSelectConversation).toHaveBeenCalledWith('conv-1')
  })

  it('keeps a mobile-friendly full-width list container', () => {
    render(
      <ConversationList
        activeConversationId={null}
        onSelectConversation={jest.fn()}
        conversations={[
          {
            conversation_id: 'conv-1',
            other_participant_id: 'player-2',
            other_participant_display_name: 'Druhý hráč',
            last_message_id: 10,
            last_message_sender_id: 'player-2',
            last_message_body: 'Ahoj',
            last_message_created_at: '2026-08-20T10:00:00Z',
            unread_count: 0,
          },
        ]}
      />,
    )

    expect(screen.getByTestId('conversation-list')).toHaveClass('w-full')
  })
})
