import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MapPage from './page'

const mockTerritory = (x: number, y: number, overrides: Partial<Record<string, unknown>> = {}) => ({
  id: y * 256 + x + 1,
  x,
  y,
  difficulty: 1,
  castle_rank: null,
  village_rank: null,
  owner_id: null,
  is_home: false,
  claim_locked_by: null,
  claim_started_at: null,
  claim_transfer_arrives_at: null,
  claim_occupation_completes_at: null,
  ...overrides,
})

const getViewport = jest.fn().mockResolvedValue({
  data: [mockTerritory(128, 128, { is_home: true, owner_id: 'me' })],
  error: null,
})
const getMinimapOverview = jest.fn().mockResolvedValue({ data: [], error: null })

jest.mock('@/lib/territories/api', () => ({
  getViewport: (...args: unknown[]) => getViewport(...args),
  getMinimapOverview: (...args: unknown[]) => getMinimapOverview(...args),
}))

jest.mock('@/lib/supabase/useSession', () => ({
  useSession: () => ({ user: null, player: null, loading: false }),
}))

describe('MapPage', () => {
  beforeEach(() => {
    getViewport.mockClear()
  })

  it('renders the back-link and loads a viewport centered on (128,128)', async () => {
    render(<MapPage />)

    expect(screen.getByRole('link', { name: /Domů/ })).toHaveAttribute('href', '/')

    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    expect(getViewport).toHaveBeenCalledWith(121, 121, 135, 135)
  })

  it('updates the requested window when the coordinate-jump form is submitted', async () => {
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    getViewport.mockClear()

    fireEvent.change(screen.getByLabelText('Souřadnice X'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Souřadnice Y'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Přejít' }))

    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(3, 13, 17, 27))
  })

  it('re-requests a shifted window when a pan arrow is clicked', async () => {
    render(<MapPage />)
    await waitFor(() => expect(screen.getByTestId('map-viewport')).toBeInTheDocument())
    getViewport.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Posunout doprava' }))

    await waitFor(() => expect(getViewport).toHaveBeenCalledWith(122, 121, 136, 135))
  })

  it('surfaces an RPC error instead of silently failing', async () => {
    getViewport.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    render(<MapPage />)
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })
})
