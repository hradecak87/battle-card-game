import { NATIONS } from './nations'

describe('NATIONS', () => {
  it('has exactly 6 entries', () => {
    expect(NATIONS).toHaveLength(6)
  })

  it('has a unique id for every entry', () => {
    const ids = NATIONS.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has non-empty name and perkDescription for every entry', () => {
    for (const nation of NATIONS) {
      expect(nation.name.length).toBeGreaterThan(0)
      expect(nation.perkDescription.length).toBeGreaterThan(0)
    }
  })
})
