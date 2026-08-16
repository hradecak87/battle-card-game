import { render, screen, fireEvent } from '@testing-library/react'
import MapViewport from './MapViewport'
import { Territory } from '@/lib/territories/api'

function makeTerritory(overrides: Partial<Territory> = {}): Territory {
  return {
    id: 1,
    x: 10,
    y: 10,
    difficulty: 2,
    castle_rank: null,
    village_rank: null,
    owner_id: null,
    is_home: false,
    claim_locked_by: null,
    claim_started_at: null,
    claim_transfer_arrives_at: null,
    claim_occupation_completes_at: null,
    ...overrides,
  }
}

function renderViewport(territories: Territory[], currentUserId?: string | null) {
  render(
    <MapViewport
      territories={territories}
      centerX={10}
      centerY={10}
      viewSize={3}
      currentUserId={currentUserId}
      onPan={jest.fn()}
      onJump={jest.fn()}
      onSelectTile={jest.fn()}
    />
  )
}

describe('MapViewport', () => {
  it('shows "Tvé území" when hovering a tile owned by the current user', () => {
    renderViewport([makeTerritory({ owner_id: 'me' })], 'me')

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Území 10,10' }))

    expect(screen.getByText('Tvé území')).toBeInTheDocument()
  })

  it('shows "Cizí hráč" when hovering a tile owned by someone else', () => {
    renderViewport([makeTerritory({ owner_id: 'other-player' })], 'me')

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Území 10,10' }))

    expect(screen.getByText('Cizí hráč')).toBeInTheDocument()
  })

  it('shows "Neobsazeno" and difficulty for an unclaimed tile', () => {
    renderViewport([makeTerritory({ difficulty: 3, owner_id: null })], 'me')

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Území 10,10' }))

    expect(screen.getByText('Neobsazeno')).toBeInTheDocument()
    expect(screen.getByText('Obtížnost: 3/5')).toBeInTheDocument()
  })

  it('marks tiles owned by the current user with a distinct attribute for highlighting', () => {
    renderViewport([makeTerritory({ owner_id: 'me' })], 'me')

    expect(screen.getByRole('button', { name: 'Území 10,10' })).toHaveAttribute('data-owned-by-me', 'true')
  })

  it('shows castle, village, and claim-in-progress details in the tooltip', () => {
    renderViewport(
      [
        makeTerritory({
          castle_rank: 'rare',
          village_rank: 'common',
          claim_locked_by: 'claimer',
        }),
      ],
      'me'
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Území 10,10' }))

    expect(screen.getByText('Hrad: rare')).toBeInTheDocument()
    expect(screen.getByText('Vesnice: common')).toBeInTheDocument()
    expect(screen.getByText('Probíhá zábor')).toBeInTheDocument()
  })
})
