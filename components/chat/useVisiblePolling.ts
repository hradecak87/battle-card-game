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

    // Always fire the very first call unconditionally (matching HeartbeatBeacon's
    // pattern). Browsers can mount/hydrate a page while document.visibilityState is
    // still 'hidden' (e.g. Chrome's prerender-on-hover/predicted-navigation), and
    // since nothing else re-triggers a call until a real visibility change happens,
    // gating the initial call too meant it could silently never run at all.
    void callback()
    const intervalId = window.setInterval(run, intervalMs)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void callback()
      }
    }
    // Browsers throttle setInterval heavily in background/unfocused windows, so the
    // interval alone can lag far behind intervalMs. Also refresh on window focus,
    // which fires immediately (untouched by timer throttling) when the user switches
    // back to the tab - the moment they're most likely to check for updates anyway.
    const handleFocus = () => {
      void callback()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [callback, enabled, intervalMs])
}
