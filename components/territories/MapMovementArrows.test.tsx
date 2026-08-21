import { fireEvent, render, screen } from '@testing-library/react'
import MapMovementArrows, { MapMovementArrow } from './MapMovementArrows'

const movementDetailModal = jest.fn((_props: unknown) => null)

jest.mock('@/components/territories/MovementDetailModal', () => ({
  __esModule: true,
  default: (props: unknown) => movementDetailModal(props),
}))

jest.mock('@/lib/territories/useMapMovementArrows', () => ({
  __esModule: true,
  useMapMovementArrows: () => ({ arrows: [], loading: false, error: null }),
}))

describe('MapMovementArrows', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-08-21T12:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
    movementDetailModal.mockClear()
  })

  it('renders one arrow per visible movement with category-specific colors', () => {
    const arrows: MapMovementArrow[] = [
      {
        id: 'transfer-1',
        category: 'transfer',
        movementId: 'transfer-1',
        movementKind: 'transfer',
        originTerritoryId: 1,
        destinationTerritoryId: 2,
        originX: 10,
        originY: 10,
        destX: 11,
        destY: 10,
        originName: null,
        destinationName: null,
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
      },
      {
        id: 'offensive-1',
        category: 'offensive',
        movementId: 'offensive-1',
        movementKind: 'attack',
        originTerritoryId: 3,
        destinationTerritoryId: 4,
        originX: 10,
        originY: 11,
        destX: 10,
        destY: 12,
        originName: null,
        destinationName: null,
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
      },
      {
        id: 'incoming-1',
        category: 'incoming',
        originX: 12,
        originY: 12,
        destX: 11,
        destY: 11,
        destinationName: 'Moje pole',
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
        attackerId: 'enemy-1',
        attackerDisplayName: 'Nepřítel',
        attackerKingdomName: 'Stín',
        attackerIsNpc: false,
        attackerHomeX: 12,
        attackerHomeY: 12,
      },
      {
        id: 'ally-transfer-1',
        category: 'ally-transfer',
        movementId: 'ally-transfer-1',
        movementKind: 'transfer',
        originTerritoryId: 20,
        destinationTerritoryId: 21,
        originX: 9,
        originY: 10,
        destX: 10,
        destY: 10,
        originName: 'Spojenecký tábor',
        destinationName: 'Přívoz',
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
        allyPlayerId: 'ally-1',
        allyDisplayName: 'Spojenec',
        allyKingdomName: 'Severní koruna',
        allyIsNpc: false,
      },
      {
        id: 'ally-offensive-1',
        category: 'ally-offensive',
        movementId: 'ally-offensive-1',
        movementKind: 'attack',
        originTerritoryId: 22,
        destinationTerritoryId: 23,
        originX: 9,
        originY: 8,
        destX: 9,
        destY: 9,
        originName: 'Hrad spojence',
        destinationName: 'Cizí kraj',
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
        allyPlayerId: 'ally-2',
        allyDisplayName: 'Druhý spojenec',
        allyKingdomName: 'Jižní koruna',
        allyIsNpc: false,
      },
      {
        id: 'ally-incoming-1',
        category: 'ally-incoming',
        originX: 13,
        originY: 13,
        destX: 10,
        destY: 9,
        destinationName: 'Spojenecká hranice',
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
        attackerId: 'enemy-2',
        attackerDisplayName: 'Vetřelec',
        attackerKingdomName: 'Bouře',
        attackerIsNpc: false,
        attackerHomeX: 13,
        attackerHomeY: 13,
        allyPlayerId: 'ally-2',
        allyDisplayName: 'Druhý spojenec',
        allyKingdomName: 'Jižní koruna',
        allyIsNpc: false,
      },
    ]

    render(
      <MapMovementArrows
        arrows={arrows}
        centerX={11}
        centerY={11}
        viewSize={5}
        onSelectArrow={jest.fn()}
      />
    )

    expect(screen.getAllByTestId(/movement-arrow-line-/)).toHaveLength(6)
    expect(screen.getByTestId('movement-arrow-line-transfer-1')).toHaveAttribute('stroke', '#f59e0b')
    expect(screen.getByTestId('movement-arrow-line-offensive-1')).toHaveAttribute('stroke', '#ef4444')
    expect(screen.getByTestId('movement-arrow-line-incoming-1')).toHaveAttribute('stroke', '#d946ef')
    expect(screen.getByTestId('movement-arrow-line-ally-transfer-1')).toHaveAttribute('stroke', '#22c55e')
    expect(screen.getByTestId('movement-arrow-line-ally-offensive-1')).toHaveAttribute('stroke', '#14b8a6')
    expect(screen.getByTestId('movement-arrow-line-ally-incoming-1')).toHaveAttribute('stroke', '#3b82f6')
  })

  it('suppresses the default browser focus outline on an arrow and instead thickens its own line when focused', () => {
    // Regression: the arrow's <g role="button"> wraps the whole diagonal
    // line, so the browser's default focus outline followed that huge
    // bounding box and looked like a giant rounded frame around the map.
    // The group must opt out of the native outline; the visible line
    // itself should thicken instead, scoped to the arrow.
    const arrows: MapMovementArrow[] = [
      {
        id: 'transfer-1',
        category: 'transfer',
        movementId: 'movement-1',
        movementKind: 'transfer',
        originTerritoryId: 1,
        destinationTerritoryId: 2,
        originX: 10,
        originY: 10,
        destX: 12,
        destY: 12,
        destinationName: 'Cíl',
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
      },
    ]

    render(
      <MapMovementArrows
        arrows={arrows}
        centerX={11}
        centerY={11}
        viewSize={5}
        onSelectArrow={jest.fn()}
      />
    )

    const group = screen.getByRole('button', { name: /Cíl/ })
    expect(group).toHaveClass('outline-none')

    const line = screen.getByTestId('movement-arrow-line-transfer-1')
    expect(line).toHaveAttribute('stroke-width', '0.08')
    fireEvent.focus(group)
    expect(line).toHaveAttribute('stroke-width', '0.16')
    fireEvent.blur(group)
    expect(line).toHaveAttribute('stroke-width', '0.08')
  })

  it('shows a hover tooltip with the origin, destination, kind and ETA when hovering an arrow', () => {
    const arrows: MapMovementArrow[] = [
      {
        id: 'transfer-1',
        category: 'transfer',
        movementId: 'movement-1',
        movementKind: 'transfer',
        originTerritoryId: 1,
        destinationTerritoryId: 2,
        originX: 10,
        originY: 10,
        destX: 12,
        destY: 12,
        originName: 'Domov',
        destinationName: 'Cíl',
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
      },
    ]

    render(
      <MapMovementArrows
        arrows={arrows}
        centerX={11}
        centerY={11}
        viewSize={5}
        onSelectArrow={jest.fn()}
      />
    )

    expect(screen.queryByText('Přesun')).not.toBeInTheDocument()

    const group = screen.getByRole('button', { name: /Cíl/ })
    fireEvent.mouseEnter(group)

    expect(screen.getByText('Přesun')).toBeInTheDocument()
    expect(screen.getByText('Domov → Cíl')).toBeInTheDocument()
    expect(screen.getByText('za 1 h 0 min')).toBeInTheDocument()

    fireEvent.mouseLeave(group)
    expect(screen.queryByText('Přesun')).not.toBeInTheDocument()
  })

  it('labels an offensive movement and an incoming attack correctly in the hover tooltip', () => {
    const arrows: MapMovementArrow[] = [
      {
        id: 'offensive-1',
        category: 'offensive',
        movementId: 'movement-2',
        movementKind: 'attack',
        originTerritoryId: 3,
        destinationTerritoryId: 4,
        originX: 10,
        originY: 11,
        destX: 10,
        destY: 12,
        originName: null,
        destinationName: null,
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
      },
      {
        id: 'incoming-1',
        category: 'incoming',
        originX: 12,
        originY: 12,
        destX: 11,
        destY: 11,
        destinationName: 'Moje pole',
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
        attackerId: 'enemy-1',
        attackerDisplayName: 'Nepřítel',
        attackerKingdomName: 'Stín',
        attackerIsNpc: false,
        attackerHomeX: 12,
        attackerHomeY: 12,
      },
    ]

    render(
      <MapMovementArrows
        arrows={arrows}
        centerX={11}
        centerY={11}
        viewSize={5}
        onSelectArrow={jest.fn()}
      />
    )

    fireEvent.mouseEnter(screen.getByTestId('movement-arrow-line-offensive-1').closest('g') as SVGGElement)
    expect(screen.getByText('Útok')).toBeInTheDocument()
    expect(screen.getByText('(10, 11) → (10, 12)')).toBeInTheDocument()

    fireEvent.mouseEnter(screen.getByTestId('movement-arrow-line-incoming-1').closest('g') as SVGGElement)
    expect(screen.getByText('Příchozí útok')).toBeInTheDocument()
    expect(screen.getByText('(12, 12) → Moje pole')).toBeInTheDocument()
  })

  it('shows ally identity in the hover tooltip and opens the movement detail modal for ally arrows', () => {
    const arrows: MapMovementArrow[] = [
      {
        id: 'ally-transfer-1',
        category: 'ally-transfer',
        movementId: 'ally-transfer-1',
        movementKind: 'transfer',
        originTerritoryId: 1,
        destinationTerritoryId: 2,
        originX: 10,
        originY: 10,
        destX: 12,
        destY: 10,
        originName: 'Spojenecký tábor',
        destinationName: 'Říční brod',
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
        allyPlayerId: 'ally-1',
        allyDisplayName: 'Spojenec',
        allyKingdomName: 'Severní koruna',
        allyIsNpc: false,
      },
    ]

    render(
      <MapMovementArrows
        arrows={arrows}
        centerX={11}
        centerY={11}
        viewSize={5}
        onSelectArrow={jest.fn()}
      />
    )

    const group = screen.getByRole('button', { name: /Říční brod/ })
    fireEvent.mouseEnter(group)

    expect(screen.getByText('Spojenec: Spojenec (Severní koruna)')).toBeInTheDocument()

    fireEvent.click(group)
    expect(movementDetailModal).toHaveBeenCalledWith(
      expect.objectContaining({
        arrow: expect.objectContaining({ id: 'ally-transfer-1', allyDisplayName: 'Spojenec' }),
      })
    )
  })

  it('clips an arrow to the viewport edge when only one endpoint is visible', () => {
    const arrows: MapMovementArrow[] = [
      {
        id: 'incoming-1',
        category: 'incoming',
        originX: 30,
        originY: 10,
        destX: 12,
        destY: 10,
        destinationName: 'Moje pole',
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
        attackerId: 'enemy-1',
        attackerDisplayName: 'Nepřítel',
        attackerKingdomName: 'Stín',
        attackerIsNpc: false,
        attackerHomeX: 30,
        attackerHomeY: 10,
      },
    ]

    render(
      <MapMovementArrows
        arrows={arrows}
        centerX={10}
        centerY={10}
        viewSize={5}
        onSelectArrow={jest.fn()}
      />
    )

    const line = screen.getByTestId('movement-arrow-line-incoming-1')
    expect(Number(line.getAttribute('x1'))).toBeLessThanOrEqual(100)
    expect(Number(line.getAttribute('x2'))).toBeLessThanOrEqual(100)
  })

  it('still draws an arrow clipped to the viewport edge even when BOTH endpoints are off-screen, as long as the path crosses the visible area', () => {
    // Regression: previously any movement where neither endpoint fell
    // inside the current viewport was skipped entirely, so panning away
    // from a visible destination made the whole arrow vanish even though
    // its path still crossed the viewport. Only a line that truly misses
    // the viewport rectangle should be omitted.
    const arrows: MapMovementArrow[] = [
      {
        id: 'transfer-far',
        category: 'transfer',
        movementId: 'transfer-far',
        movementKind: 'transfer',
        originTerritoryId: 1,
        destinationTerritoryId: 2,
        originX: -20,
        originY: 10,
        destX: 40,
        destY: 10,
        originName: null,
        destinationName: null,
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
      },
    ]

    render(
      <MapMovementArrows arrows={arrows} centerX={10} centerY={10} viewSize={5} onSelectArrow={jest.fn()} />
    )

    expect(screen.getByTestId('movement-arrow-line-transfer-far')).toBeInTheDocument()
  })

  it('omits an arrow whose path never crosses the visible viewport at all', () => {
    const arrows: MapMovementArrow[] = [
      {
        id: 'transfer-unrelated',
        category: 'transfer',
        movementId: 'transfer-unrelated',
        movementKind: 'transfer',
        originTerritoryId: 1,
        destinationTerritoryId: 2,
        originX: 100,
        originY: 100,
        destX: 120,
        destY: 100,
        originName: null,
        destinationName: null,
        startedAt: '2026-08-21T11:00:00.000Z',
        arrivesAt: '2026-08-21T13:00:00.000Z',
      },
    ]

    render(
      <MapMovementArrows arrows={arrows} centerX={10} centerY={10} viewSize={5} onSelectArrow={jest.fn()} />
    )

    expect(screen.queryByTestId('movement-arrow-line-transfer-unrelated')).not.toBeInTheDocument()
  })
})
