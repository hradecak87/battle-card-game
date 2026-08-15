export const MAX_LEVEL_GAP = 3

/**
 * Pure "are these two players close enough in level to fight" rule (design
 * spec §5). Used by later subsystems to gate territory-battle matchmaking;
 * not enforced by any UI in this subsystem, since there's no battle UI yet.
 */
export function canPlayersFight(levelA: number, levelB: number): boolean {
  return Math.abs(levelA - levelB) <= MAX_LEVEL_GAP
}
