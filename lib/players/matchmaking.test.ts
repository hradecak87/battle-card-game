import { canPlayersFight, MAX_LEVEL_GAP } from './matchmaking'

describe('canPlayersFight', () => {
  it('allows a gap of exactly MAX_LEVEL_GAP', () => {
    expect(canPlayersFight(10, 10 + MAX_LEVEL_GAP)).toBe(true)
  })

  it('allows a gap of 0', () => {
    expect(canPlayersFight(5, 5)).toBe(true)
  })

  it('disallows a gap one above MAX_LEVEL_GAP', () => {
    expect(canPlayersFight(10, 10 + MAX_LEVEL_GAP + 1)).toBe(false)
  })

  it('is symmetric regardless of argument order', () => {
    expect(canPlayersFight(10, 7)).toBe(canPlayersFight(7, 10))
    expect(canPlayersFight(10, 20)).toBe(canPlayersFight(20, 10))
  })
})
