import { EffectiveCard } from '../cards/types'
import { NationId } from '../players/nations'

export function applyNationCombatPerk(stats: EffectiveCard, nation: NationId): EffectiveCard {
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
      return { ...stats }
  }
}
