import { KING_RELOCATION_REQUIRED_LEVEL, canUseKingRelocation, kingRelocationStatus } from './king'

describe('canUseKingRelocation', () => {
  it('returns false below the unlock level', () => {
    expect(canUseKingRelocation(10499, null)).toBe(false)
  })

  it('returns true exactly at the unlock threshold when unused', () => {
    expect(canUseKingRelocation(10500, null)).toBe(true)
  })

  it('returns false after the player has already used the ability', () => {
    expect(canUseKingRelocation(40000, '2026-08-19T12:00:00Z')).toBe(false)
  })
})

describe('kingRelocationStatus', () => {
  it('reports the derived level, required level, and eligibility together', () => {
    expect(kingRelocationStatus(10500, null)).toEqual({
      level: KING_RELOCATION_REQUIRED_LEVEL,
      requiredLevel: KING_RELOCATION_REQUIRED_LEVEL,
      used: false,
      eligible: true,
    })
  })
})
