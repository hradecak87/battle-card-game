/**
 * Cumulative XP required to *reach* `level`, starting from level 1 = 0 XP
 * (design spec §5). Linear-growing per-level cost: level N -> N+1 costs
 * 100*N more XP than level N-1 -> N did.
 */
export function xpRequiredForLevel(level: number): number {
  return (100 * (level - 1) * level) / 2
}

/**
 * Derives the level for a given total XP. Levels are never stored — always
 * derived from `xp` so they can't drift out of sync (spec §2).
 */
export function levelForXp(xp: number): number {
  let level = 1
  while (xp >= xpRequiredForLevel(level + 1)) level++
  return level
}
