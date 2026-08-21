import { render, screen } from '@testing-library/react'
import MapMovementArrows, { MapMovementArrow } from './MapMovementArrows'

jest.mock('@/components/territories/MovementDetailModal', () => ({
  __esModule: true,
  default: () => null,
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

    expect(screen.getAllByTestId(/movement-arrow-line-/)).toHaveLength(3)
    expect(screen.getByTestId('movement-arrow-line-transfer-1')).toHaveAttribute('stroke', '#f59e0b')
    expect(screen.getByTestId('movement-arrow-line-offensive-1')).toHaveAttribute('stroke', '#ef4444')
    expect(screen.getByTestId('movement-arrow-line-incoming-1')).toHaveAttribute('stroke', '#d946ef')
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
