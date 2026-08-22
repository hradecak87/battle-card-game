'use client'

import { useEffect, useState } from 'react'
import {
  getCoalitionMovements,
  getIncomingAttacksOnCoalitionTerritories,
  getIncomingAttacksOnMyTerritories,
  getMyMovements,
  getTerritoriesByIds,
  type CoalitionMovement,
  type IncomingAttackOnCoalitionTerritory,
  type IncomingAttackOnMyTerritory,
  type TerritoryCoords,
  type TroopMovement,
} from '@/lib/territories/api'

export type MapMovementArrowCategory =
  | 'transfer'
  | 'offensive'
  | 'loan'
  | 'scout'
  | 'incoming'
  | 'ally-transfer'
  | 'ally-offensive'
  | 'ally-loan'
  | 'ally-scout'
  | 'ally-incoming'

type BaseArrow = {
  id: string
  category: MapMovementArrowCategory
  originX: number
  originY: number
  destX: number
  destY: number
  originName?: string | null
  destinationName?: string | null
  startedAt: string
  arrivesAt: string
}

export type MyMapMovementArrow = BaseArrow & {
  category: 'transfer' | 'offensive' | 'loan' | 'scout'
  movementId: string
  movementKind: TroopMovement['kind']
  originTerritoryId: number
  destinationTerritoryId: number
}

export type IncomingMapMovementArrow = BaseArrow & {
  category: 'incoming'
  movementId?: undefined
  movementKind?: undefined
  originTerritoryId?: undefined
  destinationTerritoryId?: number
  attackerId: string
  attackerDisplayName: string | null
  attackerKingdomName: string | null
  attackerIsNpc: boolean
  attackerHomeX: number | null
  attackerHomeY: number | null
}

type AllyIdentity = {
  allyPlayerId: string
  allyDisplayName: string | null
  allyKingdomName: string | null
  allyIsNpc: boolean
}

export type AllyMapMovementArrow = BaseArrow &
  AllyIdentity & {
    category: 'ally-transfer' | 'ally-offensive' | 'ally-loan' | 'ally-scout'
    movementId: string
    movementKind: TroopMovement['kind']
    originTerritoryId: number
    destinationTerritoryId: number
  }


export type AllyIncomingMapMovementArrow = BaseArrow &
  AllyIdentity & {
    category: 'ally-incoming'
    movementId?: undefined
    movementKind?: undefined
    originTerritoryId?: undefined
    destinationTerritoryId?: number
    attackerId: string
    attackerDisplayName: string | null
    attackerKingdomName: string | null
    attackerIsNpc: boolean
    attackerHomeX: number | null
    attackerHomeY: number | null
  }

export type MapMovementArrow =
  | MyMapMovementArrow
  | IncomingMapMovementArrow
  | AllyMapMovementArrow
  | AllyIncomingMapMovementArrow

export interface UseMapMovementArrowsOptions {
  myPlayerId: string | null
  refreshKey?: number
  enabled?: boolean
}

export interface UseMapMovementArrowsResult {
  arrows: MapMovementArrow[]
  loading: boolean
  error: string | null
}

function categoryForMovementKind(kind: TroopMovement['kind']): 'transfer' | 'offensive' | 'loan' | 'scout' {
  if (kind === 'transfer') return 'transfer'
  if (kind === 'loan') return 'loan'
  if (kind === 'scout' || kind === 'scout_return') return 'scout'
  return 'offensive'
}

function toMineArrow(movement: TroopMovement, territoriesById: Map<number, TerritoryCoords>): MyMapMovementArrow | null {
  const origin = territoriesById.get(movement.origin_territory_id)
  const destination = territoriesById.get(movement.destination_territory_id)
  if (!origin || !destination) return null

  return {
    id: `mine-${movement.id}`,
    movementId: movement.id,
    category: categoryForMovementKind(movement.kind),
    movementKind: movement.kind,
    originTerritoryId: movement.origin_territory_id,
    destinationTerritoryId: movement.destination_territory_id,
    originX: origin.x,
    originY: origin.y,
    destX: destination.x,
    destY: destination.y,
    originName: origin.name,
    destinationName: destination.name,
    startedAt: movement.started_at,
    arrivesAt: movement.transfer_arrives_at,
  }
}

function toIncomingArrow(attack: IncomingAttackOnMyTerritory): IncomingMapMovementArrow | null {
  if (attack.attacker_home_x === null || attack.attacker_home_y === null) return null

  return {
    id: `incoming-${attack.movement_id}`,
    category: 'incoming',
    originX: attack.attacker_home_x,
    originY: attack.attacker_home_y,
    destX: attack.territory_x,
    destY: attack.territory_y,
    destinationName: attack.territory_name,
    destinationTerritoryId: attack.territory_id,
    startedAt: attack.started_at,
    arrivesAt: attack.transfer_arrives_at,
    attackerId: attack.attacker_id,
    attackerDisplayName: attack.attacker_display_name,
    attackerKingdomName: attack.attacker_kingdom_name,
    attackerIsNpc: attack.attacker_is_npc,
    attackerHomeX: attack.attacker_home_x,
    attackerHomeY: attack.attacker_home_y,
  }
}

function toAllyArrow(
  movement: CoalitionMovement,
  territoriesById: Map<number, TerritoryCoords>
): AllyMapMovementArrow | null {
  const origin = territoriesById.get(movement.origin_territory_id)
  const destination = territoriesById.get(movement.destination_territory_id)
  if (!origin || !destination) return null

  return {
    id: `ally-${movement.id}`,
    movementId: movement.id,
    category: movement.kind === 'transfer'
      ? 'ally-transfer'
      : movement.kind === 'loan'
        ? 'ally-loan'
        : movement.kind === 'scout' || movement.kind === 'scout_return'
          ? 'ally-scout'
          : 'ally-offensive',
    movementKind: movement.kind,
    originTerritoryId: movement.origin_territory_id,
    destinationTerritoryId: movement.destination_territory_id,
    originX: origin.x,
    originY: origin.y,
    destX: destination.x,
    destY: destination.y,
    originName: origin.name,
    destinationName: destination.name,
    startedAt: movement.started_at,
    arrivesAt: movement.transfer_arrives_at,
    allyPlayerId: movement.player_id,
    allyDisplayName: movement.display_name,
    allyKingdomName: movement.kingdom_name,
    allyIsNpc: movement.is_npc,
  }
}

function toAllyIncomingArrow(attack: IncomingAttackOnCoalitionTerritory): AllyIncomingMapMovementArrow | null {
  if (attack.attacker_home_x === null || attack.attacker_home_y === null) return null

  return {
    id: `ally-incoming-${attack.movement_id}`,
    category: 'ally-incoming',
    originX: attack.attacker_home_x,
    originY: attack.attacker_home_y,
    destX: attack.territory_x,
    destY: attack.territory_y,
    destinationName: attack.territory_name,
    destinationTerritoryId: attack.territory_id,
    startedAt: attack.started_at,
    arrivesAt: attack.transfer_arrives_at,
    attackerId: attack.attacker_id,
    attackerDisplayName: attack.attacker_display_name,
    attackerKingdomName: attack.attacker_kingdom_name,
    attackerIsNpc: attack.attacker_is_npc,
    attackerHomeX: attack.attacker_home_x,
    attackerHomeY: attack.attacker_home_y,
    allyPlayerId: attack.defender_id,
    allyDisplayName: attack.defender_display_name,
    allyKingdomName: attack.defender_kingdom_name,
    allyIsNpc: attack.defender_is_npc,
  }
}

export function useMapMovementArrows({
  myPlayerId,
  refreshKey = 0,
  enabled = true,
}: UseMapMovementArrowsOptions): UseMapMovementArrowsResult {
  const [arrows, setArrows] = useState<MapMovementArrow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!myPlayerId || !enabled) {
      setArrows([])
      setLoading(false)
      setError(null)
      return
    }

    const cancelledRef = { current: false }

    async function load() {
      setLoading(true)
      const [
        { data: myMovements, error: myMovementsError },
        { data: incomingAttacks, error: incomingAttacksError },
        { data: coalitionMovements, error: coalitionMovementsError },
        { data: coalitionIncomingAttacks, error: coalitionIncomingAttacksError },
      ] = await Promise.all([
        getMyMovements(),
        getIncomingAttacksOnMyTerritories(),
        getCoalitionMovements(),
        getIncomingAttacksOnCoalitionTerritories(),
      ])
      if (cancelledRef.current) return

      if (myMovementsError) {
        setError(myMovementsError.message)
        setLoading(false)
        return
      }
      if (incomingAttacksError) {
        setError(incomingAttacksError.message)
        setLoading(false)
        return
      }
      if (coalitionMovementsError) {
        setError(coalitionMovementsError.message)
        setLoading(false)
        return
      }
      if (coalitionIncomingAttacksError) {
        setError(coalitionIncomingAttacksError.message)
        setLoading(false)
        return
      }

      const inTransitMine = (myMovements ?? []).filter(
        (movement) => movement.status === 'in_transit' && movement.kind !== 'scout_peek'
      )
      const inTransitCoalition = (coalitionMovements ?? []).filter(
        (movement) => movement.status === 'in_transit' && movement.kind !== 'scout_peek'
      )
      const territoryIds = Array.from(
        new Set(
          [...inTransitMine, ...inTransitCoalition].flatMap((movement) => [
            movement.origin_territory_id,
            movement.destination_territory_id,
          ])
        )
      )

      const { data: territoryRows, error: territoryError } = await getTerritoriesByIds(territoryIds)
      if (cancelledRef.current) return
      if (territoryError) {
        setError(territoryError.message)
        setLoading(false)
        return
      }

      const territoriesById = new Map((territoryRows ?? []).map((territory) => [territory.id, territory]))
      const nextArrows: MapMovementArrow[] = [
        ...inTransitMine
          .map((movement) => toMineArrow(movement, territoriesById))
          .filter((arrow): arrow is MyMapMovementArrow => arrow !== null),
        ...inTransitCoalition
          .map((movement) => toAllyArrow(movement, territoriesById))
          .filter((arrow): arrow is AllyMapMovementArrow => arrow !== null),
        ...(incomingAttacks ?? [])
          .map(toIncomingArrow)
          .filter((arrow): arrow is IncomingMapMovementArrow => arrow !== null),
        ...(coalitionIncomingAttacks ?? [])
          .map(toAllyIncomingArrow)
          .filter((arrow): arrow is AllyIncomingMapMovementArrow => arrow !== null),
      ]

      setArrows(nextArrows)
      setError(null)
      setLoading(false)
    }

    load()
    const interval = setInterval(load, 15000)
    return () => {
      cancelledRef.current = true
      clearInterval(interval)
    }
  }, [enabled, myPlayerId, refreshKey])

  return { arrows, loading, error }
}
