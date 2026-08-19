import {
  chebyshevDistance,
  DIFFICULTY_MULTIPLIER,
  Difficulty,
  occupationHours,
  transferHours,
} from './formulas'

describe('chebyshevDistance', () => {
  it('is 0 for the same tile', () => {
    expect(chebyshevDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0)
  })

  it('is the max axis delta for adjacent and far tiles', () => {
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1)
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1)
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 255, y: 255 })).toBe(255)
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 255, y: 10 })).toBe(255)
  })
})

describe('transferHours', () => {
  it('floors distance 0 to the minimum 0.25h', () => {
    expect(transferHours(0)).toBe(0.25)
  })

  it('is ~18 minutes (0.3h) for an adjacent tile', () => {
    expect(transferHours(1)).toBeCloseTo(0.3, 5)
  })

  it('is ~76.5h (~3.2 days) for the maximum map distance', () => {
    expect(transferHours(255)).toBeCloseTo(76.5, 5)
  })

  it('applies the Mongol Horde -25% discount', () => {
    expect(transferHours(255, 'mongol_horde')).toBeCloseTo(76.5 * 0.75, 5)
  })

  it('does not discount other nations', () => {
    expect(transferHours(255, 'england')).toBeCloseTo(76.5, 5)
  })

  it('still applies the floor under the Mongol discount', () => {
    expect(transferHours(0, 'mongol_horde')).toBeCloseTo(0.25 * 0.75, 5)
  })

  it('is unaffected by groupSpeed when omitted (today\'s behavior)', () => {
    expect(transferHours(255)).toBeCloseTo(76.5, 5)
  })

  it('is unaffected by the baseline speed of 5 (no-op reference point)', () => {
    expect(transferHours(255, undefined, 5)).toBeCloseTo(76.5, 5)
  })

  it('takes longer for a slower group (below baseline speed)', () => {
    expect(transferHours(255, undefined, 2.5)).toBeCloseTo(76.5 * 2, 5)
  })

  it('takes less time for a faster group (above baseline speed)', () => {
    expect(transferHours(255, undefined, 10)).toBeCloseTo(76.5 * 0.5, 5)
  })

  it('clamps the speed multiplier for an extremely slow group', () => {
    // 5 / 0.5 = 10x, clamped down to the 3.0x ceiling
    expect(transferHours(255, undefined, 0.5)).toBeCloseTo(76.5 * 3.0, 5)
  })

  it('clamps the speed multiplier for an extremely fast group', () => {
    // 5 / 100 = 0.05x, clamped up to the 0.4x floor
    expect(transferHours(255, undefined, 100)).toBeCloseTo(76.5 * 0.4, 5)
  })

  it('combines groupSpeed with the Mongol Horde discount', () => {
    expect(transferHours(255, 'mongol_horde', 10)).toBeCloseTo(76.5 * 0.5 * 0.75, 5)
  })

  it('still floors distance 0 to 0.25h even with a fast group', () => {
    expect(transferHours(0, undefined, 10)).toBe(0.25)
  })
})

describe('DIFFICULTY_MULTIPLIER', () => {
  it('matches the 5-level scale from spec §9.1', () => {
    expect(DIFFICULTY_MULTIPLIER).toEqual({ 1: 1.0, 2: 1.5, 3: 2.25, 4: 3.4, 5: 5.0 })
  })
})

describe('occupationHours', () => {
  it('matches the worked example: modest army (~120 power), easy tile', () => {
    expect(occupationHours(120, 1)).toBeCloseTo(13.7, 1)
  })

  it('matches the worked example: modest army (~120 power), extreme tile', () => {
    expect(occupationHours(120, 5)).toBeCloseTo(68.5, 1)
  })

  it('hits the 10h floor for a large army (~1000 power) on an easy tile', () => {
    expect(occupationHours(1000, 1)).toBe(10)
  })

  it('is still meaningful for a large army (~1000 power) on an extreme tile', () => {
    expect(occupationHours(1000, 5)).toBeCloseTo(23.7, 1)
  })

  it('applies the Scandinavia -20% discount after the floor (effective floor 8h)', () => {
    expect(occupationHours(1000, 1, 'scandinavia')).toBeCloseTo(8, 5)
  })

  it('does not discount other nations', () => {
    expect(occupationHours(1000, 1, 'england')).toBe(10)
  })

  it('applies the Scandinavia discount on top of a non-floored value too', () => {
    const base = occupationHours(120, 5)
    expect(occupationHours(120, 5, 'scandinavia')).toBeCloseTo(base * 0.8, 5)
  })

  it.each([1, 2, 3, 4, 5] as Difficulty[])(
    'never returns less than the 10h floor for difficulty %i without a nation perk',
    (difficulty) => {
      expect(occupationHours(1_000_000, difficulty)).toBeGreaterThanOrEqual(10)
    }
  )
})
