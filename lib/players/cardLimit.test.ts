import { deckLimit, depositLimit } from './cardLimit'

describe('cardLimit helpers', () => {
  it('computes the deck limit for representative levels', () => {
    expect(deckLimit(1)).toBe(100)
    expect(deckLimit(10)).toBe(280)
    expect(deckLimit(30)).toBe(680)
  })

  it('computes the deposit limit for representative levels', () => {
    expect(depositLimit(1)).toBe(50)
    expect(depositLimit(10)).toBe(140)
  })
})
