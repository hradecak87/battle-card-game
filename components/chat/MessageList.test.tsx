import { render, screen } from '@testing-library/react'
import { MessageList } from './MessageList'

describe('MessageList', () => {
  it('renders messages oldest-to-newest', () => {
    render(
      <MessageList
        currentPlayerId="me"
        messages={[
          {
            id: 2,
            sender_id: 'other',
            sender_display_name: 'Druhý',
            channel_type: 'global',
            conversation_id: null,
            recipient_id: null,
            body: 'Druhá',
            created_at: '2026-08-20T10:01:00Z',
            deleted_at: null,
          },
          {
            id: 1,
            sender_id: 'me',
            sender_display_name: 'Já',
            channel_type: 'global',
            conversation_id: null,
            recipient_id: null,
            body: 'První',
            created_at: '2026-08-20T10:00:00Z',
            deleted_at: null,
          },
        ]}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('První')
    expect(items[1]).toHaveTextContent('Druhá')
  })

  it('shows a placeholder body for a deleted own message', () => {
    render(
      <MessageList
        currentPlayerId="me"
        messages={[
          {
            id: 1,
            sender_id: 'me',
            sender_display_name: 'Já',
            channel_type: 'dm',
            conversation_id: 'conv',
            recipient_id: 'other',
            body: 'Skrytá',
            created_at: '2026-08-20T10:00:00Z',
            deleted_at: '2026-08-20T10:05:00Z',
          },
        ]}
      />,
    )

    expect(screen.getByText('Zpráva byla odstraněna.')).toBeInTheDocument()
  })
})
