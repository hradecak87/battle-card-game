import {
  getAllTemplates,
  getTemplateById,
  getTemplatesByRank,
  getTemplatesByType,
} from './catalog'
import { RANKS, UNIT_TYPES, VARIANTS_PER_RANK, SUPPLY_RANGE } from './types'

describe('catalog (real data.json)', () => {
  it('loads exactly 248 templates', () => {
    expect(getAllTemplates()).toHaveLength(248)
  })

  it('has the correct count of variants per unit type per rank', () => {
    for (const unitType of UNIT_TYPES) {
      for (const rank of RANKS) {
        const count = getAllTemplates().filter(
          (t) => t.unitType === unitType && t.rank === rank
        ).length
        expect(count).toBe(VARIANTS_PER_RANK[rank])
      }
    }
  })

  it('has unique ids and unique names across the whole catalog', () => {
    const all = getAllTemplates()
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length)
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length)
  })

  it('sets totalSupply=null for common/uncommon and an in-range number for rare/epic/legend', () => {
    for (const t of getAllTemplates()) {
      if (t.rank === 'common' || t.rank === 'uncommon') {
        expect(t.totalSupply).toBeNull()
      } else {
        const [min, max] = SUPPLY_RANGE[t.rank as 'rare' | 'epic' | 'legend']
        expect(t.totalSupply).not.toBeNull()
        expect(t.totalSupply as number).toBeGreaterThanOrEqual(min)
        expect(t.totalSupply as number).toBeLessThanOrEqual(max)
      }
    }
  })

  it('has no negative baseStats on any template', () => {
    for (const t of getAllTemplates()) {
      expect(t.baseStats.str).toBeGreaterThanOrEqual(0)
      expect(t.baseStats.lng).toBeGreaterThanOrEqual(0)
      expect(t.baseStats.def).toBeGreaterThanOrEqual(0)
      expect(t.baseStats.hp).toBeGreaterThanOrEqual(0)
    }
  })

  it('getTemplatesByType returns only templates of that unit type', () => {
    const archers = getTemplatesByType('archers')
    expect(archers.length).toBe(31)
    expect(archers.every((t) => t.unitType === 'archers')).toBe(true)
  })

  it('getTemplatesByRank returns only templates of that rank', () => {
    const legends = getTemplatesByRank('legend')
    expect(legends.length).toBe(24) // 3 per type x 8 types
    expect(legends.every((t) => t.rank === 'legend')).toBe(true)
  })

  it('getTemplateById finds a known template and returns undefined for unknown ids', () => {
    expect(getTemplateById('archers-common-01')?.name).toBe('Práčata')
    expect(getTemplateById('does-not-exist')).toBeUndefined()
  })
})

describe('catalog validation (malformed fixtures)', () => {
  // Each test re-imports the module fresh (jest.resetModules) with a mocked
  // catalog-data.json so the module-load-time validation throws as expected,
  // without affecting the real data used by other tests.

  it('throws when the total template count is wrong', () => {
    jest.resetModules()
    jest.doMock('./catalog-data.json', () => [
      {
        id: 'archers-common-01',
        unitType: 'archers',
        rank: 'common',
        name: 'Only One',
        flavorText: 'x',
        baseStats: { str: 1, lng: 1, def: 1, hp: 1 },
        totalSupply: null,
      },
    ])
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh re-import needed after jest.resetModules()
    expect(() => require('./catalog')).toThrow(/expected 248 templates/)
    jest.dontMock('./catalog-data.json')
  })

  it('throws when there is a duplicate id', () => {
    jest.resetModules()
    const full = jest.requireActual('./catalog-data.json') as unknown as Array<{ id: string }>
    const withDuplicate = full.map((t, i) => (i === 1 ? { ...t, id: full[0].id } : t))
    jest.doMock('./catalog-data.json', () => withDuplicate)
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh re-import needed after jest.resetModules()
    expect(() => require('./catalog')).toThrow(/duplicate id/)
    jest.dontMock('./catalog-data.json')
  })

  it('throws when totalSupply is out of range for a capped rank', () => {
    jest.resetModules()
    const full = jest.requireActual('./catalog-data.json') as unknown as Array<{
      rank: string
      totalSupply: number | null
    }>
    const withBadSupply = full.map((t) =>
      t.rank === 'legend' ? { ...t, totalSupply: 999 } : t
    )
    jest.doMock('./catalog-data.json', () => withBadSupply)
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh re-import needed after jest.resetModules()
    expect(() => require('./catalog')).toThrow(/totalSupply must be within/)
    jest.dontMock('./catalog-data.json')
  })

  it('throws when a template has a negative baseStats value', () => {
    jest.resetModules()
    const full = jest.requireActual('./catalog-data.json') as unknown as Array<{
      baseStats: { str: number }
    }>
    const withNegative = full.map((t, i) =>
      i === 0 ? { ...t, baseStats: { ...t.baseStats, str: -1 } } : t
    )
    jest.doMock('./catalog-data.json', () => withNegative)
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh re-import needed after jest.resetModules()
    expect(() => require('./catalog')).toThrow(/negative baseStats/)
    jest.dontMock('./catalog-data.json')
  })
})

