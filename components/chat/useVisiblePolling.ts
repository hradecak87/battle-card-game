'use client'

import { useEffect } from 'react'

export function useVisiblePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return

    const run = () => {
      if (document.visibilityState === 'visible') {
        void callback()
      }
    }

    run()
    const intervalId = window.setInterval(run, intervalMs)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void callback()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [callback, enabled, intervalMs])
}
