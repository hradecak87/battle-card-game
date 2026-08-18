/**
 * Backlog #10: a territory owned by a player can only be attacked if it sits
 * on the border of that player's contiguous land — i.e. at least one of its
 * 4 orthogonal neighbors (up/down/left/right, not diagonals) is not owned by
 * the same player. This mirrors the server-side check added to
 * `declare_attack()` in `0017_attack_adjacency.sql`.
 *
 * Territories with no owner (`ownerId === null`, whether truly empty or
 * NPC-garrisoned) are exempt and always attackable.
 */
export function isTerritoryAttackable(
  targetOwnerId: string | null,
  neighborOwnerIds: (string | null)[]
): boolean {
  if (targetOwnerId === null) return true
  return neighborOwnerIds.some((ownerId) => ownerId !== targetOwnerId)
}
