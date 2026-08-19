import { levelForXp } from './leveling'

export const KING_RELOCATION_REQUIRED_LEVEL = 15

export const KING_ABILITY = {
  id: 'king-home-relocation',
  name: 'Král',
  description: 'Jednorázově přesune tvoje domovské území na jiné území, které právě vlastníš.',
  requiredLevel: KING_RELOCATION_REQUIRED_LEVEL,
} as const

export function canUseKingRelocation(xp: number, usedAt: string | null | undefined): boolean {
  return levelForXp(xp) >= KING_RELOCATION_REQUIRED_LEVEL && !usedAt
}

export function kingRelocationStatus(xp: number, usedAt: string | null | undefined) {
  const level = levelForXp(xp)
  return {
    level,
    requiredLevel: KING_RELOCATION_REQUIRED_LEVEL,
    used: Boolean(usedAt),
    eligible: canUseKingRelocation(xp, usedAt),
  }
}
