import { EffectiveCard } from '../cards/types'
import { pickNpcDefenderCard } from './npcAi'

describe('pickNpcDefenderCard', () => {
  const attacker: EffectiveCard = { str: 5, lng: 0, def: 0, hp: 10 }

  it('picks the only candidate that would win the simulated duel', () => {
    expect(
      pickNpcDefenderCard(
        attacker,
        [
          { id: 'loser-a', effective: { str: 1, lng: 0, def: 0, hp: 2 } },
          { id: 'winner', effective: { str: 10, lng: 0, def: 5, hp: 10 } },
          { id: 'loser-b', effective: { str: 2, lng: 0, def: 0, hp: 3 } },
        ],
        () => 0.9
      )
    ).toBe('winner')
  })

  it('returns one of the winning candidates when multiple defenders would win', () => {
    expect(
      ['winner-a', 'winner-b'].includes(
        pickNpcDefenderCard(
          attacker,
          [
            { id: 'winner-a', effective: { str: 10, lng: 0, def: 5, hp: 10 } },
            { id: 'winner-b', effective: { str: 8, lng: 0, def: 4, hp: 10 } },
            { id: 'loser', effective: { str: 1, lng: 0, def: 0, hp: 2 } },
          ],
          () => 0.2
        )
      )
    ).toBe(true)
  })

  it('falls back to a rand-selected candidate when no defender would win', () => {
    expect(
      pickNpcDefenderCard(
        attacker,
        [
          { id: 'first', effective: { str: 1, lng: 0, def: 0, hp: 2 } },
          { id: 'second', effective: { str: 2, lng: 0, def: 0, hp: 3 } },
          { id: 'third', effective: { str: 3, lng: 0, def: 0, hp: 4 } },
        ],
        () => 0.6
      )
    ).toBe('second')
  })

  it('returns the only candidate even when that defender would lose', () => {
    expect(
      pickNpcDefenderCard(attacker, [{ id: 'only', effective: { str: 1, lng: 0, def: 0, hp: 2 } }], () => 0)
    ).toBe('only')
  })

  it('throws when called with no candidates', () => {
    expect(() => pickNpcDefenderCard(attacker, [], () => 0)).toThrow()
  })
})
