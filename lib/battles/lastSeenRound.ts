/**
 * Per-battle "last seen round" tracking (spec:
 * docs/superpowers/specs/2026-08-17-battle-round-result-popup-design.md
 * §2.5) — backed by localStorage so a page reload doesn't replay round
 * popups already shown to that browser, but any round resolved after the
 * stored marker (one at a time in live PvP, or a whole batch at once for
 * an NPC battle played out server-side in one call) still queues up.
 */
function keyFor(battleId: string): string {
  return `battle-${battleId}-last-seen-round`
}

export function getLastSeenRound(battleId: string): number {
  if (typeof window === 'undefined') return 0
  const raw = window.localStorage.getItem(keyFor(battleId))
  return raw ? Number(raw) : 0
}

export function setLastSeenRound(battleId: string, roundNumber: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(keyFor(battleId), String(roundNumber))
}
