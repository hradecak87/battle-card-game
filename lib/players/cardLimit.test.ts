import { deckLimit, depositLimit } from './cardLimit'

describe('cardLimit helpers', () => {
  it('computes the deck limit for representative levels', () => {
    expect(deckLimit(1)).toBe(80)
    expect(deckLimit(10)).toBe(170)
    expect(deckLimit(30)).toBe(370)
  })

  it('computes the deposit limit for representative levels', () => {
    expect(depositLimit(1)).toBe(40)
    expect(depositLimit(10)).toBe(85)
  })
})
