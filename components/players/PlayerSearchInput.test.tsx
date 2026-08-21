import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlayerSearchInput } from './PlayerSearchInput'

const searchPlayers = jest.fn()

jest.mock('@/lib/players/api', () => ({
  searchPlayers: (...args: unknown[]) => searchPlayers(...args),
}))

describe('PlayerSearchInput', () => {
  beforeEach(() => {
    searchPlayers.mockReset()
  })

  it('shows a selected player as a chip with a clear button', async () => {
    const onChange = jest.fn()
    render(<PlayerSearchInput value={{ id: 'p1', label: 'Marty (Kingdomia)' }} onChange={onChange} />)

    expect(screen.getByText('Marty (Kingdomia)')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Zrušit výběr hráče' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('searches after typing 2+ characters and selects a result', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    searchPlayers.mockResolvedValue({
      data: [
        { id: 'p2', display_name: 'Findme Player', kingdom_name: 'Kingdomia', nation: 'francia', is_online: true },
      ],
      error: null,
    })

    const onChange = jest.fn()
    const user = userEvent.setup()
    render(<PlayerSearchInput value={null} onChange={onChange} />)

    await user.type(screen.getByPlaceholderText(/Hledej hráče/), 'Fin')

    await waitFor(() => expect(searchPlayers).toHaveBeenCalledWith('Fin'))
    await waitFor(() => expect(screen.getByText('Findme Player (Kingdomia)')).toBeInTheDocument())

    await user.click(screen.getByText('Findme Player (Kingdomia)'))
    expect(onChange).toHaveBeenCalledWith({ id: 'p2', label: 'Findme Player (Kingdomia)' })

    jest.useRealTimers()
  })

  it('does not search below the 2-character minimum', async () => {
    const user = userEvent.setup()
    render(<PlayerSearchInput value={null} onChange={jest.fn()} />)

    await user.type(screen.getByPlaceholderText(/Hledej hráče/), 'F')

    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(searchPlayers).not.toHaveBeenCalled()
  })

  it('shows a "not found" message when the search returns no results', async () => {
    jest.useFakeTimers({ advanceTimers: true })
    searchPlayers.mockResolvedValue({ data: [], error: null })

    const user = userEvent.setup()
    render(<PlayerSearchInput value={null} onChange={jest.fn()} />)

    await user.type(screen.getByPlaceholderText(/Hledej hráče/), 'Zzz')

    await waitFor(() => expect(screen.getByText('Žádný hráč nenalezen.')).toBeInTheDocument())

    jest.useRealTimers()
  })
})
