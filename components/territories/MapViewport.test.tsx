import type { ComponentProps } from 'react'
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
    battle_locked_by: null,
    ...overrides,
  }
}

function renderViewport(
  territories: Territory[],
  currentUserId?: string | null,
  overrides: Partial<ComponentProps<typeof MapViewport>> = {}
) {
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
      {...overrides}
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

  it('merges the owned highlight border with adjacent territories of the same owner', () => {
    renderViewport(
      [
        makeTerritory({ x: 10, y: 10, owner_id: 'me' }),
        makeTerritory({ id: 2, x: 11, y: 10, owner_id: 'me' }),
      ],
      'me'
    )

    const tile1010 = screen.getByRole('button', { name: 'Území 10,10' }).style.boxShadow
    const tile1110 = screen.getByRole('button', { name: 'Území 11,10' }).style.boxShadow

    // Shared (inner) edge between the two owned tiles keeps just the plain
    // grid border (no colored shadow on that side); only the outer/perimeter
    // sides get the sky highlight.
    expect(tile1010).not.toContain('inset -2px 0 0 0 #38bdf8')
    expect(tile1010).toContain('inset 2px 0 0 0 #38bdf8')
    expect(tile1110).not.toContain('inset 2px 0 0 0 #38bdf8')
    expect(tile1110).toContain('inset -2px 0 0 0 #38bdf8')
  })

  it('renders out-of-bounds cells as inert void tiles instead of clickable territory buttons', () => {
    render(
      <MapViewport
        territories={[makeTerritory({ x: 0, y: 0 })]}
        centerX={0}
        centerY={0}
        viewSize={3}
        currentUserId="me"
        onPan={jest.fn()}
        onJump={jest.fn()}
        onSelectTile={jest.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Území -1,-1' })).not.toBeInTheDocument()
    expect(screen.getByTestId('void-tile--1,-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Území 0,0' })).toBeInTheDocument()
  })

  it('scales icon size down when zoomed farther out', () => {
    const homeTile = [makeTerritory({ is_home: true, owner_id: 'me' })]
    const { rerender } = render(
      <MapViewport
        territories={homeTile}
        centerX={10}
        centerY={10}
        viewSize={7}
        currentUserId="me"
        onPan={jest.fn()}
        onJump={jest.fn()}
        onSelectTile={jest.fn()}
      />
    )

    const zoomedInIcon = screen.getByTitle('Domov')

    rerender(
      <MapViewport
        territories={homeTile}
        centerX={10}
        centerY={10}
        viewSize={27}
        currentUserId="me"
        onPan={jest.fn()}
        onJump={jest.fn()}
        onSelectTile={jest.fn()}
      />
    )

    const zoomedOutIcon = screen.getByTitle('Domov')

    expect(Number.parseFloat(zoomedInIcon instanceof HTMLElement ? zoomedInIcon.style.fontSize : '')).toBeGreaterThan(
      Number.parseFloat(zoomedOutIcon instanceof HTMLElement ? zoomedOutIcon.style.fontSize : '')
    )
  })

  it('clamps jump input values to the valid map bounds before calling onJump', () => {
    const onJump = jest.fn()
    renderViewport([], 'me', { onJump })

    fireEvent.change(screen.getByLabelText('Souřadnice X'), { target: { value: '-5' } })
    fireEvent.change(screen.getByLabelText('Souřadnice Y'), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Přejít' }))

    expect(onJump).toHaveBeenCalledWith(0, 255)
  })

  it('uses a compact single-row toolbar layout with narrow coordinate inputs', () => {
    renderViewport([])

    expect(screen.getByTestId('map-toolbar').className).toContain('flex-row')
    expect(screen.getByLabelText('Souřadnice X').className).toContain('w-11')
    expect(screen.getByLabelText('Souřadnice Y').className).toContain('w-11')
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
