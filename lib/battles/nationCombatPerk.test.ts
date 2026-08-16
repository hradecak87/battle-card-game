import { EffectiveCard } from '../cards/types'
import { NationId } from '../players/nations'
import { applyNationCombatPerk } from './nationCombatPerk'

describe('applyNationCombatPerk', () => {
  const base: EffectiveCard = { str: 100, lng: 80, def: 60, hp: 40 }

  it.each([
    ['england', 'lng'],
    ['francia', 'str'],
    ['hre', 'def'],
    ['byzantium', 'hp'],
    ['mongol_horde', null],
    ['scandinavia', null],
  ] as const)('applies the %s combat perk to exactly one stat', (nation, boostedStat) => {
    const result = applyNationCombatPerk(base, nation as NationId)
    if (boostedStat === 'str') expect(result.str).toBeCloseTo(base.str * 1.15)
    else expect(result.str).toBe(base.str)

    if (boostedStat === 'lng') expect(result.lng).toBeCloseTo(base.lng * 1.15)
    else expect(result.lng).toBe(base.lng)

    if (boostedStat === 'def') expect(result.def).toBeCloseTo(base.def * 1.15)
    else expect(result.def).toBe(base.def)

    if (boostedStat === 'hp') expect(result.hp).toBeCloseTo(base.hp * 1.15)
    else expect(result.hp).toBe(base.hp)
  })

  it('returns a new object for non-combat nations while keeping the same values', () => {
    expect(applyNationCombatPerk(base, 'mongol_horde')).not.toBe(base)
    expect(applyNationCombatPerk(base, 'scandinavia')).not.toBe(base)
  })
})
