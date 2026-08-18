import { EffectiveCard } from '../cards/types'
import { NationId } from '../players/nations'

/**
 * Applies the owning nation's combat perk. `nation === null` represents an
 * NPC-owned card (no player, hence no perk) — mirrors the SQL
 * `_compute_effective_stats`'s `else null` branch for a null nation.
 */
export function applyNationCombatPerk(stats: EffectiveCard, nation: NationId | null): EffectiveCard {
  switch (nation) {
    case 'england':
      return { ...stats, lng: stats.lng * 1.15 }
    case 'francia':
      return { ...stats, str: stats.str * 1.15 }
    case 'hre':
      return { ...stats, def: stats.def * 1.15 }
    case 'byzantium':
      return { ...stats, hp: stats.hp * 1.15 }
    case 'mongol_horde':
    case 'scandinavia':
    case null:
      return { ...stats }
  }
}
