import {
  canNpcAttackTarget,
  chooseNpcAction,
  scheduleNpcNextActionAt,
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
