import { isTerritoryAttackable } from './attackReachability'

describe('isTerritoryAttackable', () => {
  const OWNER_A = 'player-a'
  const OWNER_B = 'player-b'

  it('is always attackable when the target has no owner (empty/NPC)', () => {
    expect(isTerritoryAttackable(null, [OWNER_A, OWNER_A, OWNER_A, OWNER_A])).toBe(true)
  })

  it('is not attackable when all 4 neighbors are owned by the same player', () => {
    expect(isTerritoryAttackable(OWNER_A, [OWNER_A, OWNER_A, OWNER_A, OWNER_A])).toBe(false)
  })

  it('is attackable when at least one neighbor is owned by a different player', () => {
    expect(isTerritoryAttackable(OWNER_A, [OWNER_A, OWNER_A, OWNER_A, OWNER_B])).toBe(true)
  })

  it('is attackable when at least one neighbor is unclaimed/NPC (null)', () => {
    expect(isTerritoryAttackable(OWNER_A, [OWNER_A, OWNER_A, OWNER_A, null])).toBe(true)
  })

  it('is attackable when at least one neighbor is off-grid (represented as null)', () => {
    // Edge-of-map territory: one of its 4 coordinates doesn't exist as a row.
    expect(isTerritoryAttackable(OWNER_A, [OWNER_A, OWNER_A, null])).toBe(true)
  })

  it('is not attackable with fewer than 4 neighbors only if all present ones match (defensive/unused case)', () => {
    expect(isTerritoryAttackable(OWNER_A, [OWNER_A, OWNER_A, OWNER_A])).toBe(false)
  })
})
