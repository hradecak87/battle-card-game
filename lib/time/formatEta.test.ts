import { formatEta } from './formatEta'

describe('formatEta', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('formats minutes only under an hour', () => {
    expect(formatEta('2026-01-01T00:14:00.000Z', now)).toBe('za 14 min')
  })

  it('formats hours and minutes under a day', () => {
    expect(formatEta('2026-01-01T02:05:00.000Z', now)).toBe('za 2 h 5 min')
  })

  it('formats days and hours at or beyond 24 hours', () => {
    expect(formatEta('2026-01-02T03:00:00.000Z', now)).toBe('za 1 d 3 h')
  })

  it('returns a neutral message for times already in the past', () => {
    expect(formatEta('2025-12-31T23:00:00.000Z', now)).toBe('již brzy')
  })
})
