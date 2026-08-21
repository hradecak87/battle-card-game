export type NpcAction = 'expand' | 'attack' | 'idle'

export interface NpcActionChoiceInput {
  hasExpansionCandidates: boolean
  hasAttackCandidates: boolean
  rand: number
}

export interface NpcAttackThresholdInput {
  availablePower: number
  defenderPower: number
}

export interface NpcOwnedTerritoryRef {
  territoryId: number
  x: number
  y: number
}

export interface NpcTargetCoords {
  x: number
  y: number
}

export const NPC_ATTACK_POWER_RATIO = 1.2
export const NPC_ATTACK_CANCEL_RATIO = 11 / 9

export function chooseNpcAction({
  hasExpansionCandidates,
  hasAttackCandidates,
  rand,
}: NpcActionChoiceInput): NpcAction {
  if (hasExpansionCandidates && hasAttackCandidates) {
    return rand < 0.7 ? 'expand' : 'attack'
  }
  if (hasExpansionCandidates) return 'expand'
  if (hasAttackCandidates) return 'attack'
  return 'idle'
}

export function canNpcAttackTarget({ availablePower, defenderPower }: NpcAttackThresholdInput): boolean {
  return availablePower >= defenderPower * NPC_ATTACK_POWER_RATIO
}

export function attackerWinProbability(attackerPower: number, defenderPower: number): number {
  const totalPower = attackerPower + defenderPower
  if (totalPower === 0) return 1
  return attackerPower / totalPower
}

export function shouldNpcCancelAttack(attackerPower: number, defenderPower: number): boolean {
  return defenderPower > NPC_ATTACK_CANCEL_RATIO * attackerPower
}

/**
 * TS mirror of the adjacency-first tier gate from
 * docs/superpowers/specs/2026-08-20-npc-contiguous-expansion-design.md.
 */
export function shouldUseAdjacentTier(hasAdjacentCandidates: boolean, rand: number): boolean {
  return hasAdjacentCandidates && rand < 0.9
}

export function selectNearestOriginTerritory<T extends NpcOwnedTerritoryRef>(
  origins: T[],
  target: NpcTargetCoords
): T | null {
  if (origins.length === 0) return null

  return origins.reduce((best, candidate) => {
    const candidateDistance = Math.max(Math.abs(candidate.x - target.x), Math.abs(candidate.y - target.y))
    const bestDistance = Math.max(Math.abs(best.x - target.x), Math.abs(best.y - target.y))
    return candidateDistance < bestDistance ? candidate : best
  })
}

export function scheduleNpcNextActionAt(base: Date, rand: number): Date {
  return new Date(base.getTime() + (4 + rand * 8) * 60 * 60 * 1000)
}
