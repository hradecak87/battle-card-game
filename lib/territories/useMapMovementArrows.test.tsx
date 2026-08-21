import { act, renderHook, waitFor } from '@testing-library/react'
import { useMapMovementArrows } from './useMapMovementArrows'

const getMyMovements = jest.fn()
const getIncomingAttacksOnMyTerritories = jest.fn()
const getTerritoriesByIds = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getMyMovements: (...args: unknown[]) => getMyMovements(...args),
  getIncomingAttacksOnMyTerritories: (...args: unknown[]) => getIncomingAttacksOnMyTerritories(...args),
  getTerritoriesByIds: (...args: unknown[]) => getTerritoriesByIds(...args),
}))

describe('useMapMovementArrows', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-08-21T12:00:00.000Z'))
    getMyMovements.mockReset()
    getIncomingAttacksOnMyTerritories.mockReset()
    getTerritoriesByIds.mockReset()
    getMyMovements.mockResolvedValue({ data: [], error: null })
    getIncomingAttacksOnMyTerritories.mockResolvedValue({ data: [], error: null })
    getTerritoriesByIds.mockResolvedValue({ data: [], error: null })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('combines my in-transit movements and incoming attacks into unified arrow descriptors', async () => {
    getMyMovements.mockResolvedValue({
      data: [
        {
          id: 'transfer-1',
          player_id: 'me',
          kind: 'transfer',
          origin_territory_id: 10,
          destination_territory_id: 11,
          started_at: '2026-08-21T11:00:00.000Z',
          transfer_arrives_at: '2026-08-21T13:00:00.000Z',
          status: 'in_transit',
          cancelled_at: null,
        },
        {
          id: 'claim-1',
          player_id: 'me',
          kind: 'claim',
          origin_territory_id: 12,
          destination_territory_id: 13,
          started_at: '2026-08-21T11:15:00.000Z',
          transfer_arrives_at: '2026-08-21T13:15:00.000Z',
          status: 'in_transit',
          cancelled_at: null,
        },
        {
          id: 'completed-1',
          player_id: 'me',
          kind: 'attack',
          origin_territory_id: 99,
          destination_territory_id: 100,
          started_at: '2026-08-21T11:15:00.000Z',
          transfer_arrives_at: '2026-08-21T13:15:00.000Z',
          status: 'completed',
          cancelled_at: null,
        },
      ],
      error: null,
    })
    getIncomingAttacksOnMyTerritories.mockResolvedValue({
      data: [
        {
          movement_id: 'incoming-1',
          territory_id: 15,
          territory_x: 9,
          territory_y: 8,
          territory_name: 'Moje hranice',
          attacker_id: 'enemy-1',
          attacker_display_name: 'Nepřítel',
          attacker_kingdom_name: 'Temný hvozd',
          attacker_is_npc: false,
          attacker_home_x: 20,
          attacker_home_y: 21,
          started_at: '2026-08-21T11:30:00.000Z',
          transfer_arrives_at: '2026-08-21T12:45:00.000Z',
        },
      ],
      error: null,
    })
    getTerritoriesByIds.mockResolvedValue({
      data: [
        { id: 10, x: 1, y: 2, name: 'Sever' },
        { id: 11, x: 3, y: 4, name: 'Jih' },
        { id: 12, x: 5, y: 6, name: null },
        { id: 13, x: 7, y: 8, name: 'Pustina' },
      ],
      error: null,
    })

    let result!: { current: ReturnType<typeof useMapMovementArrows> }
    await act(async () => {
      ;({ result } = renderHook(() => useMapMovementArrows({ myPlayerId: 'me', refreshKey: 0 })))
    })

    await waitFor(() => expect(result.current.arrows).toHaveLength(3))
    expect(getTerritoriesByIds).toHaveBeenCalledWith([10, 11, 12, 13])
    expect(result.current.arrows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mine-transfer-1',
          movementId: 'transfer-1',
          category: 'transfer',
          movementKind: 'transfer',
          originX: 1,
          originY: 2,
          destX: 3,
          destY: 4,
          originName: 'Sever',
          destinationName: 'Jih',
        }),
        expect.objectContaining({
          id: 'mine-claim-1',
          movementId: 'claim-1',
          category: 'offensive',
          movementKind: 'claim',
          originX: 5,
          originY: 6,
          destX: 7,
          destY: 8,
          originName: null,
          destinationName: 'Pustina',
        }),
        expect.objectContaining({
          id: 'incoming-incoming-1',
          category: 'incoming',
          originX: 20,
          originY: 21,
          destX: 9,
          destY: 8,
          destinationName: 'Moje hranice',
          attackerDisplayName: 'Nepřítel',
          attackerKingdomName: 'Temný hvozd',
        }),
      ])
    )
  })

  it('polls every 15 seconds and reloads immediately when refreshKey changes', async () => {
    getMyMovements.mockResolvedValue({
      data: [
        {
          id: 'transfer-1',
          player_id: 'me',
          kind: 'transfer',
          origin_territory_id: 10,
          destination_territory_id: 11,
          started_at: '2026-08-21T11:00:00.000Z',
          transfer_arrives_at: '2026-08-21T13:00:00.000Z',
          status: 'in_transit',
          cancelled_at: null,
        },
      ],
      error: null,
    })

    let rerender!: (props: { refreshKey: number }) => void
    await act(async () => {
      ;({ rerender } = renderHook(
        ({ refreshKey }) => useMapMovementArrows({ myPlayerId: 'me', refreshKey }),
        { initialProps: { refreshKey: 0 } }
      ))
    })

    await waitFor(() => expect(getMyMovements).toHaveBeenCalledTimes(1))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000)
    })
    await waitFor(() => expect(getMyMovements).toHaveBeenCalledTimes(2))

    await act(async () => {
      rerender({ refreshKey: 1 })
    })
    await waitFor(() => expect(getMyMovements).toHaveBeenCalledTimes(3))
  })
})
