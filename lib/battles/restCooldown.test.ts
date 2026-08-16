import { isAvailable, nextRestingUntilRound } from './restCooldown'

describe('isAvailable', () => {
  it('keeps a card resting when currentRound equals restingUntilRound', () => {
    expect(isAvailable(3, 3)).toBe(false)
  })

  it('makes a card available again on the round after restingUntilRound', () => {
    expect(isAvailable(3, 4)).toBe(true)
  })

  it('always returns true when restingUntilRound is undefined', () => {
    expect(isAvailable(undefined, 1)).toBe(true)
    expect(isAvailable(undefined, 99)).toBe(true)
  })

  it('makes a round-1 fighter unavailable for rounds 2 and 3, then available in round 4', () => {
    const restingUntilRound = nextRestingUntilRound(1)
    expect(restingUntilRound).toBe(3)
    expect(isAvailable(restingUntilRound, 2)).toBe(false)
    expect(isAvailable(restingUntilRound, 3)).toBe(false)
    expect(isAvailable(restingUntilRound, 4)).toBe(true)
  })
})

describe('nextRestingUntilRound', () => {
  it('returns currentRound + 2', () => {
    expect(nextRestingUntilRound(0)).toBe(2)
    expect(nextRestingUntilRound(5)).toBe(7)
  })
})
