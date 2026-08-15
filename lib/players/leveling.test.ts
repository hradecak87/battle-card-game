import { xpRequiredForLevel, levelForXp } from './leveling'

describe('xpRequiredForLevel', () => {
  it.each([
    [1, 0],
    [2, 100],
    [3, 300],
    [10, 4500],
    [20, 19000],
  ])('level %i requires %i XP', (level, expected) => {
    expect(xpRequiredForLevel(level)).toBe(expected)
  })
})

describe('levelForXp', () => {
  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [299, 2],
    [300, 3],
    [4499, 9],
    [4500, 10],
    [18999, 19],
    [19000, 20],
  ])('xp %i maps to level %i', (xp, expected) => {
    expect(levelForXp(xp)).toBe(expected)
  })
})
