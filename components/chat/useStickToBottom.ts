'use client'

import { useCallback, useEffect, useRef } from 'react'

const BOTTOM_THRESHOLD_PX = 48

/**
 * Keeps a scrollable message list pinned to the bottom (newest message) whenever new
 * content arrives, unless the user has manually scrolled up to read older messages.
 * Returns a ref to attach to the scrollable container and an onScroll handler that
 * tracks whether the user is currently near the bottom.
 */
export function useStickToBottom<T>(items: T[]) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [items])

  const resetStickToBottom = useCallback(() => {
    stickToBottomRef.current = true
  }, [])

  return { containerRef, handleScroll, resetStickToBottom }
}
