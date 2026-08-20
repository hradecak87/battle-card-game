import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageInput } from './MessageInput'

describe('MessageInput', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-08-20T10:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('submits a trimmed message body', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    const onSend = jest.fn().mockResolvedValue(undefined)

    render(<MessageInput onSend={onSend} />)

    await user.type(screen.getByPlaceholderText('Napiš zprávu…'), '  Ahoj  ')
    await user.click(screen.getByRole('button', { name: 'Odeslat' }))

    expect(onSend).toHaveBeenCalledWith('Ahoj')
  })

  it('shows the cooldown countdown after a recent send', () => {
    render(<MessageInput onSend={jest.fn()} lastSentAt={Date.now()} />)

    expect(screen.getByText('Počkej 2 s')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(1100)
    })

    expect(screen.getByText('Počkej 1 s')).toBeInTheDocument()
  })
})
