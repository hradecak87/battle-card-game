export function deckLimit(level: number): number {
  return 100 + 20 * (Math.max(level, 1) - 1)
}

export function depositLimit(level: number): number {
  return Math.floor(deckLimit(level) / 2)
}
