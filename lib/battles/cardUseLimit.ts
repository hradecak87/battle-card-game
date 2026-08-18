export const MAX_CARD_USES_PER_BATTLE = 5

export function isExhausted(timesUsed: number): boolean {
  return timesUsed >= MAX_CARD_USES_PER_BATTLE
}
