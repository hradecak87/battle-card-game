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

/**
 * Short, human-readable label for a nation's *combat* perk (the 4 nations
 * whose perk actually affects battle stats — mongol_horde/scandinavia's
 * perks are transfer/occupation-speed only and have no combat label).
 * Used by the pre-attack defender-bonuses preview so a player can see the
 * defender's nation combat perk alongside castle/village/wall bonuses.
 */
const NATION_COMBAT_PERK_LABEL: Partial<Record<NationId, string>> = {
  england: 'Anglické království: +15 % útok na dálku (LNG)',
  francia: 'Franská říše: +15 % útok zblízka (STR)',
  hre: 'Svatá říše římská: +15 % obrana (DEF)',
  byzantium: 'Byzantská říše: +15 % zdraví (HP)',
}

export function nationCombatPerkLabel(nation: NationId | null): string | null {
  if (!nation) return null
  return NATION_COMBAT_PERK_LABEL[nation] ?? null
}
