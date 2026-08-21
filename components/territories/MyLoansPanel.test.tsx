import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MyLoansPanel from './MyLoansPanel'

const getMyLoans = jest.fn()
const recallLoan = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getMyLoans: (...args: unknown[]) => getMyLoans(...args),
  recallLoan: (...args: unknown[]) => recallLoan(...args),
}))

describe('MyLoansPanel', () => {
  beforeEach(() => {
    getMyLoans.mockReset()
    recallLoan.mockReset()
  })

  it('renders grouped active loans and recalls every card in the batch', async () => {
    getMyLoans
      .mockResolvedValueOnce({
        data: [
          {
            destination_territory_id: 22,
            destination_territory_x: 7,
            destination_territory_y: 8,
            destination_territory_name: 'Hraniční pevnost',
            borrower_id: 'ally-1',
            borrower_display_name: 'Spojenec',
            loan_return_at: new Date(Date.now() + 60_000).toISOString(),
            card_instance_ids: ['card-1', 'card-2'],
            card_names: ['Rytíři', 'Lučištníci'],
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [],
        error: null,
      })

    recallLoan.mockResolvedValue({ data: null, error: null })

    render(<MyLoansPanel myPlayerId="me" />)

    expect(await screen.findByText('Moje půjčky')).toBeInTheDocument()
    expect(screen.getByText(/Spojenec/)).toBeInTheDocument()
    expect(screen.getByText(/Rytíři, Lučištníci/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Odvolat půjčku/ }))

    await waitFor(() => expect(recallLoan).toHaveBeenNthCalledWith(1, 'card-1'))
    await waitFor(() => expect(recallLoan).toHaveBeenNthCalledWith(2, 'card-2'))
  })

  it('returns null when the player has no active loans', async () => {
    getMyLoans.mockResolvedValue({ data: [], error: null })

    const { container } = render(<MyLoansPanel myPlayerId="me" />)

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
