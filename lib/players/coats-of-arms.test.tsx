import { render } from '@testing-library/react'
import { COATS_OF_ARMS } from './coats-of-arms'

describe('COATS_OF_ARMS', () => {
  it('has at least 20 entries', () => {
    expect(COATS_OF_ARMS.length).toBeGreaterThanOrEqual(20)
  })

  it('has a unique id for every entry', () => {
    const ids = COATS_OF_ARMS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a non-empty label for every entry', () => {
    for (const coat of COATS_OF_ARMS) {
      expect(coat.label.length).toBeGreaterThan(0)
    }
  })

  it('renders every Svg component without throwing', () => {
    for (const coat of COATS_OF_ARMS) {
      const { container } = render(<coat.Svg />)
      expect(container.querySelector('svg')).not.toBeNull()
    }
  })
})
