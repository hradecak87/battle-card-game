import { render } from '@testing-library/react'
import { HeartbeatBeacon } from './HeartbeatBeacon'

const rpc = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}))

describe('HeartbeatBeacon', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    rpc.mockReset()
    rpc.mockResolvedValue({ error: null })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('calls heartbeat immediately on mount, unconditionally (no session gating)', () => {
    render(<HeartbeatBeacon />)
    expect(rpc).toHaveBeenCalledWith('heartbeat')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('calls heartbeat again every 30s on an interval', () => {
    render(<HeartbeatBeacon />)
    rpc.mockClear()
    jest.advanceTimersByTime(30_000)
    expect(rpc).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(30_000)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('calls heartbeat again when the tab becomes visible', () => {
    render(<HeartbeatBeacon />)
    rpc.mockClear()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(rpc).toHaveBeenCalledWith('heartbeat')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('logs (but does not throw) when the RPC call errors', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    render(<HeartbeatBeacon />)
    await Promise.resolve()
    await Promise.resolve()
    expect(consoleSpy).toHaveBeenCalledWith('heartbeat RPC failed:', 'boom')
    consoleSpy.mockRestore()
  })

  it('stops calling heartbeat after unmount', () => {
    const { unmount } = render(<HeartbeatBeacon />)
    rpc.mockClear()
    unmount()
    jest.advanceTimersByTime(60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(rpc).not.toHaveBeenCalled()
  })
})
