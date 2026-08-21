import { act, renderHook, waitFor } from '@testing-library/react'
import { useMapMovementArrows } from './useMapMovementArrows'

const getMyMovements = jest.fn()
const getIncomingAttacksOnMyTerritories = jest.fn()
const getCoalitionMovements = jest.fn()
const getIncomingAttacksOnCoalitionTerritories = jest.fn()
const getTerritoriesByIds = jest.fn()

jest.mock('@/lib/territories/api', () => ({
  getMyMovements: (...args: unknown[]) => getMyMovements(...args),
  getIncomingAttacksOnMyTerritories: (...args: unknown[]) => getIncomingAttacksOnMyTerritories(...args),
  getCoalitionMovements: (...args: unknown[]) => getCoalitionMovements(...args),
  getIncomingAttacksOnCoalitionTerritories: (...args: unknown[]) => getIncomingAttacksOnCoalitionTerritories(...args),
  getTerritoriesByIds: (...args: unknown[]) => getTerritoriesByIds(...args),
}))

describe('useMapMovementArrows', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-08-21T12:00:00.000Z'))
    getMyMovements.mockReset()
    getIncomingAttacksOnMyTerritories.mockReset()
    getCoalitionMovements.mockReset()
    getIncomingAttacksOnCoalitionTerritories.mockReset()
    getTerritoriesByIds.mockReset()
    getMyMovements.mockResolvedValue({ data: [], error: null })
    getIncomingAttacksOnMyTerritories.mockResolvedValue({ data: [], error: null })
    getCoalitionMovements.mockResolvedValue({ data: [], error: null })
    getIncomingAttacksOnCoalitionTerritories.mockResolvedValue({ data: [], error: null })
    getTerritoriesByIds.mockResolvedValue({ data: [], error: null })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('combines my, ally, and incoming coalition movements into unified arrow descriptors', async () => {
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
    getCoalitionMovements.mockResolvedValue({
      data: [
        {
          id: 'ally-transfer-1',
          player_id: 'ally-1',
          kind: 'transfer',
          origin_territory_id: 14,
          destination_territory_id: 15,
          started_at: '2026-08-21T11:10:00.000Z',
          transfer_arrives_at: '2026-08-21T13:10:00.000Z',
          status: 'in_transit',
          cancelled_at: null,
          display_name: 'Spojenec',
          kingdom_name: 'Severní koruna',
          is_npc: false,
        },
        {
          id: 'ally-claim-1',
          player_id: 'ally-2',
          kind: 'claim',
          origin_territory_id: 16,
          destination_territory_id: 17,
          started_at: '2026-08-21T11:20:00.000Z',
          transfer_arrives_at: '2026-08-21T13:20:00.000Z',
          status: 'in_transit',
          cancelled_at: null,
          display_name: 'Druhý spojenec',
          kingdom_name: 'Jižní koruna',
          is_npc: false,
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
    getIncomingAttacksOnCoalitionTerritories.mockResolvedValue({
      data: [
        {
          movement_id: 'ally-incoming-1',
          territory_id: 18,
          territory_x: 30,
          territory_y: 31,
          territory_name: 'Spojenecká hranice',
          defender_id: 'ally-2',
          defender_display_name: 'Druhý spojenec',
          defender_kingdom_name: 'Jižní koruna',
          defender_is_npc: false,
          attacker_id: 'enemy-2',
          attacker_display_name: 'Vetřelec',
          attacker_kingdom_name: 'Bouře',
          attacker_is_npc: false,
          attacker_home_x: 40,
          attacker_home_y: 41,
          started_at: '2026-08-21T11:40:00.000Z',
          transfer_arrives_at: '2026-08-21T12:50:00.000Z',
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
        { id: 14, x: 9, y: 10, name: 'Pevnost spojence' },
        { id: 15, x: 11, y: 12, name: 'Pomocná cesta' },
        { id: 16, x: 13, y: 14, name: 'Pochod' },
        { id: 17, x: 15, y: 16, name: 'Nová država' },
      ],
      error: null,
    })

    let result!: { current: ReturnType<typeof useMapMovementArrows> }
    await act(async () => {
      ;({ result } = renderHook(() => useMapMovementArrows({ myPlayerId: 'me', refreshKey: 0 })))
    })

    await waitFor(() => expect(result.current.arrows).toHaveLength(6))
    expect(getTerritoriesByIds).toHaveBeenCalledWith([10, 11, 12, 13, 14, 15, 16, 17])
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
        expect.objectContaining({
          id: 'ally-ally-transfer-1',
          movementId: 'ally-transfer-1',
          category: 'ally-transfer',
          movementKind: 'transfer',
          originX: 9,
          originY: 10,
          destX: 11,
          destY: 12,
          allyPlayerId: 'ally-1',
          allyDisplayName: 'Spojenec',
          allyKingdomName: 'Severní koruna',
        }),
        expect.objectContaining({
          id: 'ally-ally-claim-1',
          movementId: 'ally-claim-1',
          category: 'ally-offensive',
          movementKind: 'claim',
          originX: 13,
          originY: 14,
          destX: 15,
          destY: 16,
          allyPlayerId: 'ally-2',
          allyDisplayName: 'Druhý spojenec',
          allyKingdomName: 'Jižní koruna',
        }),
        expect.objectContaining({
          id: 'ally-incoming-ally-incoming-1',
          category: 'ally-incoming',
          originX: 40,
          originY: 41,
          destX: 30,
          destY: 31,
          destinationName: 'Spojenecká hranice',
          attackerDisplayName: 'Vetřelec',
          allyPlayerId: 'ally-2',
          allyDisplayName: 'Druhý spojenec',
          allyKingdomName: 'Jižní koruna',
        }),
      ])
    )
  })

  it('categorizes loan movements distinctly from attacks/transfers, for both mine and ally arrows', async () => {
    getMyMovements.mockResolvedValue({
      data: [
        {
          id: 'loan-1',
          player_id: 'me',
          kind: 'loan',
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
    getCoalitionMovements.mockResolvedValue({
      data: [
        {
          id: 'ally-loan-1',
          player_id: 'ally-1',
          kind: 'loan',
          origin_territory_id: 14,
          destination_territory_id: 15,
          started_at: '2026-08-21T11:10:00.000Z',
          transfer_arrives_at: '2026-08-21T13:10:00.000Z',
          status: 'in_transit',
          cancelled_at: null,
          display_name: 'Spojenec',
          kingdom_name: 'Severní koruna',
          is_npc: false,
        },
      ],
      error: null,
    })
    getTerritoriesByIds.mockResolvedValue({
      data: [
        { id: 10, x: 1, y: 2, name: 'Sever' },
        { id: 11, x: 3, y: 4, name: 'Jih' },
        { id: 14, x: 9, y: 10, name: 'Pevnost spojence' },
        { id: 15, x: 11, y: 12, name: 'Pomocná cesta' },
      ],
      error: null,
    })

    let result!: { current: ReturnType<typeof useMapMovementArrows> }
    await act(async () => {
      ;({ result } = renderHook(() => useMapMovementArrows({ myPlayerId: 'me', refreshKey: 0 })))
    })

    await waitFor(() => expect(result.current.arrows).toHaveLength(2))
    expect(result.current.arrows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mine-loan-1',
          movementId: 'loan-1',
          category: 'loan',
          movementKind: 'loan',
        }),
        expect.objectContaining({
          id: 'ally-ally-loan-1',
          movementId: 'ally-loan-1',
          category: 'ally-loan',
          movementKind: 'loan',
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
