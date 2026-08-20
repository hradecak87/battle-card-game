import type { ComponentProps } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import MapViewport from './MapViewport'
import { Territory } from '@/lib/territories/api'

function makeTerritory(overrides: Partial<Territory> = {}): Territory {
  const territory: Territory = {
    id: 1,
    x: 10,
    y: 10,
    difficulty: 2,
    castle_rank: null,
    village_rank: null,
    wall_rank: null,
    owner_id: null,
    is_home: false,
    claim_locked_by: null,
    claim_started_at: null,
    claim_transfer_arrives_at: null,
    claim_occupation_completes_at: null,
    battle_locked_by: null,
    name: null,
    ...overrides,
  }
  return { ...territory, wall_rank: territory.wall_rank ?? null }
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
  it.each([
    [1, 'terrain-difficulty-1'],
    [2, 'terrain-difficulty-2'],
    [3, 'terrain-difficulty-3'],
    [4, 'terrain-difficulty-4'],
    [5, 'terrain-difficulty-5'],
  ] as const)('applies %s/5 terrain styling class to the tile background', (difficulty, terrainClass) => {
    renderViewport([makeTerritory({ difficulty })], 'me')

    expect(screen.getByRole('button', { name: 'Území 10,10' })).toHaveClass(terrainClass)
  })

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

  it('shows the owner display name when hovering a foreign-owned tile', () => {
    renderViewport(
      [makeTerritory({ owner_id: 'other-player', owner_display_name: 'Hráč XY' })],
      'me'
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Území 10,10' }))

    expect(screen.getByText('Vlastník: Hráč XY')).toBeInTheDocument()
  })

  it('shows NPC-owned tiles with an NPC label and badge on hover', () => {
    renderViewport([makeTerritory({ owner_id: 'npc-player', owner_is_npc: true })], 'me')

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Území 10,10' }))

    expect(screen.getByText('NPC říše')).toBeInTheDocument()
    expect(screen.getByTestId('npc-badge-10,10')).toBeInTheDocument()
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

    // The shared (inner) edge between the two owned tiles keeps just the
    // plain grid border (no colored overlay bar on that side); only the
    // outer/perimeter sides get the sky highlight overlay bar.
    expect(screen.queryByTestId('highlight-right-10,10')).not.toBeInTheDocument()
    expect(screen.getByTestId('highlight-top-10,10')).toBeInTheDocument()
    expect(screen.getByTestId('highlight-left-10,10')).toBeInTheDocument()
    expect(screen.getByTestId('highlight-bottom-10,10')).toBeInTheDocument()

    expect(screen.queryByTestId('highlight-left-11,10')).not.toBeInTheDocument()
    expect(screen.getByTestId('highlight-top-11,10')).toBeInTheDocument()
    expect(screen.getByTestId('highlight-right-11,10')).toBeInTheDocument()
    expect(screen.getByTestId('highlight-bottom-11,10')).toBeInTheDocument()
  })

  it('highlights foreign-owned territory with a distinct per-owner color instead of a flag icon', () => {
    renderViewport(
      [
        makeTerritory({ x: 10, y: 10, owner_id: 'other-player' }),
        makeTerritory({ id: 2, x: 11, y: 10, owner_id: 'other-player' }),
      ],
      'me'
    )

    // No flag icon anymore for foreign-owned tiles.
    expect(screen.queryByTitle('Vlastník')).not.toBeInTheDocument()

    // Foreign tiles get their own perimeter highlight bars, merged the same
    // way owned territory is (shared edge has no bar, perimeter edges do).
    expect(screen.queryByTestId('highlight-right-10,10')).not.toBeInTheDocument()
    expect(screen.getByTestId('highlight-top-10,10')).toBeInTheDocument()
    expect(screen.queryByTestId('highlight-left-11,10')).not.toBeInTheDocument()
    expect(screen.getByTestId('highlight-top-11,10')).toBeInTheDocument()
  })

  it('renders combined castle + village icons compactly instead of overlapping', () => {
    renderViewport([makeTerritory({ castle_rank: 'common', village_rank: 'common' })], 'me')

    expect(screen.getByRole('img', { name: 'Hrad' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Vesnice' })).toBeInTheDocument()
  })

  it('shows the battle icon as a blinking overlay on top of structure icons', () => {
    renderViewport([makeTerritory({ castle_rank: 'common', battle_locked_by: 'battle-1' })], 'me')

    const battleIcon = screen.getByTitle('Probíhá boj')
    expect(battleIcon.className).toContain('animate-pulse')
    expect(battleIcon.className).toContain('absolute')
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

    const zoomedInIcon = screen.getByRole('img', { name: 'Domov' })

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

    const zoomedOutIcon = screen.getByRole('img', { name: 'Domov' })

    expect(Number.parseFloat((zoomedInIcon as HTMLElement).style.width)).toBeGreaterThan(
      Number.parseFloat((zoomedOutIcon as HTMLElement).style.width)
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

  it('calls onPan with correct tile delta on mouse drag', () => {
    const onPan = jest.fn()
    renderViewport([], 'me', { onPan })

    const grid = screen.getByTestId('map-grid')
    fireEvent.mouseDown(grid, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(grid, { clientX: 48, clientY: -24 })

    // 48px right → tileDx = -2, 24px up → tileDy = +1
    expect(onPan).toHaveBeenCalledWith(-2, 1)
  })

  it('keeps the outer map frame static while the inner grid translates during a drag', () => {
    renderViewport([], 'me')

    const frame = screen.getByTestId('map-frame')
    const grid = screen.getByTestId('map-grid')

    fireEvent.mouseDown(grid, { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(grid, { clientX: 16, clientY: 6 })

    expect(frame).not.toHaveStyle({ transform: 'translate(6px,-4px)' })
    expect(grid).toHaveStyle({ transform: 'translate(6px,-4px)' })
  })

  it('clamps only the visual drag translate so large drags do not expose blank space', () => {
    renderViewport([], 'me')

    const grid = screen.getByTestId('map-grid')
    fireEvent.mouseDown(grid, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(grid, { clientX: 200, clientY: -200 })

    expect(grid).toHaveStyle({ transform: 'translate(11px,-11px)' })
  })

  it('does NOT call onPan for a near-zero mouse drag (tile click)', () => {
    const onPan = jest.fn()
    const onSelectTile = jest.fn()
    renderViewport([makeTerritory()], 'me', { onPan, onSelectTile })

    const grid = screen.getByTestId('map-grid')
    fireEvent.mouseDown(grid, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(grid, { clientX: 2, clientY: 2 })

    expect(onPan).not.toHaveBeenCalled()
  })

  it('calls onSelectTile when clicking a tile with no significant drag', () => {
    const onSelectTile = jest.fn()
    const tile = makeTerritory()
    renderViewport([tile], 'me', { onSelectTile })

    fireEvent.click(screen.getByRole('button', { name: 'Území 10,10' }))

    expect(onSelectTile).toHaveBeenCalledWith(tile)
  })

  it('calls onPan with correct tile delta on touch drag', () => {
    const onPan = jest.fn()
    renderViewport([], 'me', { onPan })

    const grid = screen.getByTestId('map-grid')
    fireEvent.touchStart(grid, { touches: [{ clientX: 0, clientY: 0 }] })
    fireEvent.touchEnd(grid, { changedTouches: [{ clientX: -24, clientY: 48 }] })

    // 24px left → tileDx = +1, 48px down → tileDy = -2
    expect(onPan).toHaveBeenCalledWith(1, -2)
  })

  it('does NOT call onPan for a near-zero touch (tap)', () => {
    const onPan = jest.fn()
    renderViewport([], 'me', { onPan })

    const grid = screen.getByTestId('map-grid')
    fireEvent.touchStart(grid, { touches: [{ clientX: 0, clientY: 0 }] })
    fireEvent.touchEnd(grid, { changedTouches: [{ clientX: 1, clientY: 1 }] })

    expect(onPan).not.toHaveBeenCalled()
  })

  it('ignores multi-touch touchStart', () => {
    const onPan = jest.fn()
    renderViewport([], 'me', { onPan })

    const grid = screen.getByTestId('map-grid')
    // Two touches — should be ignored
    fireEvent.touchStart(grid, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 50, clientY: 50 }] })
    fireEvent.touchEnd(grid, { changedTouches: [{ clientX: 100, clientY: 100 }] })

    expect(onPan).not.toHaveBeenCalled()
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

  it('shows the territory name in the tooltip when set', () => {
    renderViewport(
      [makeTerritory({ name: 'Hrad Blaník' })],
      'me'
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Území 10,10' }))

    expect(screen.getByText('Hrad Blaník')).toBeInTheDocument()
  })

  it('does not show a name line in the tooltip when name is null', () => {
    renderViewport([makeTerritory()], 'me')

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Území 10,10' }))

    expect(screen.queryByText('Hrad Blaník')).not.toBeInTheDocument()
  })
})
