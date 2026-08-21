import {
  attackerWinProbability,
  canNpcAttackTarget,
  chooseNpcAction,
  NPC_ATTACK_CANCEL_RATIO,
  scheduleNpcNextActionAt,
  shouldNpcCancelAttack,
  shouldUseAdjacentTier,
  selectNearestOriginTerritory,
} from './kingdoms'

describe('chooseNpcAction', () => {
  it('prefers expansion 70% of the time when both expansion and attack are available', () => {
    expect(chooseNpcAction({ hasExpansionCandidates: true, hasAttackCandidates: true, rand: 0.69 })).toBe(
      'expand'
    )
    expect(chooseNpcAction({ hasExpansionCandidates: true, hasAttackCandidates: true, rand: 0.7 })).toBe(
      'attack'
    )
  })

  it('falls back to the only available action type', () => {
    expect(chooseNpcAction({ hasExpansionCandidates: true, hasAttackCandidates: false, rand: 0.95 })).toBe(
      'expand'
    )
    expect(chooseNpcAction({ hasExpansionCandidates: false, hasAttackCandidates: true, rand: 0.05 })).toBe(
      'attack'
    )
    expect(chooseNpcAction({ hasExpansionCandidates: false, hasAttackCandidates: false, rand: 0.05 })).toBe(
      'idle'
    )
  })
})

describe('canNpcAttackTarget', () => {
  it('requires the attacker to be meaningfully stronger than the defender', () => {
    expect(canNpcAttackTarget({ availablePower: 120, defenderPower: 100 })).toBe(true)
    expect(canNpcAttackTarget({ availablePower: 119, defenderPower: 100 })).toBe(false)
  })
})

describe('attackerWinProbability', () => {
  it('treats zero total power as a certain attacker win to avoid NaN', () => {
    expect(attackerWinProbability(0, 0)).toBe(1)
  })

  it('matches the simple attacker-share formula', () => {
    expect(attackerWinProbability(9, 11)).toBeCloseTo(0.45)
    expect(attackerWinProbability(55, 45)).toBeCloseTo(0.55)
  })
})

describe('shouldNpcCancelAttack', () => {
  it('does not cancel exactly at the 45% threshold', () => {
    expect(shouldNpcCancelAttack(90, NPC_ATTACK_CANCEL_RATIO * 90)).toBe(false)
  })

  it('cancels once the defender power rises just above the threshold', () => {
    expect(shouldNpcCancelAttack(90, NPC_ATTACK_CANCEL_RATIO * 90 + 0.001)).toBe(true)
  })

  it('never cancels when there are no defenders', () => {
    expect(shouldNpcCancelAttack(90, 0)).toBe(false)
    expect(shouldNpcCancelAttack(0, 0)).toBe(false)
  })

  it('is true exactly when the attacker win probability drops below 45%', () => {
    expect(shouldNpcCancelAttack(100, 122.2)).toBe(false)
    expect(attackerWinProbability(100, 122.2)).toBeCloseTo(0.45)

    expect(shouldNpcCancelAttack(100, 123)).toBe(true)
    expect(attackerWinProbability(100, 123)).toBeLessThan(0.45)
  })
})

describe('shouldUseAdjacentTier', () => {
  it('falls back to map-wide search when there are no adjacent candidates', () => {
    expect(shouldUseAdjacentTier(false, 0)).toBe(false)
    expect(shouldUseAdjacentTier(false, 0.89)).toBe(false)
  })

  it('uses the adjacent tier only below the 90% boundary when candidates exist', () => {
    expect(shouldUseAdjacentTier(true, 0)).toBe(true)
    expect(shouldUseAdjacentTier(true, 0.89)).toBe(true)
    expect(shouldUseAdjacentTier(true, 0.9)).toBe(false)
  })
})

describe('selectNearestOriginTerritory', () => {
  it('picks the nearest owned territory to the target', () => {
    expect(
      selectNearestOriginTerritory(
        [
          { territoryId: 1, x: 10, y: 10 },
          { territoryId: 2, x: 14, y: 10 },
          { territoryId: 3, x: 20, y: 20 },
        ],
        { x: 15, y: 10 }
      )
    ).toEqual({ territoryId: 2, x: 14, y: 10 })
  })
})

describe('scheduleNpcNextActionAt', () => {
  it('schedules the next action 4-12 hours ahead using the same uniform formula as SQL', () => {
    const base = new Date('2026-08-19T10:00:00.000Z')

    expect(scheduleNpcNextActionAt(base, 0).toISOString()).toBe('2026-08-19T14:00:00.000Z')
    expect(scheduleNpcNextActionAt(base, 0.25).toISOString()).toBe('2026-08-19T16:00:00.000Z')
    expect(scheduleNpcNextActionAt(base, 0.999).toISOString()).toBe('2026-08-19T21:59:31.200Z')
  })
})
