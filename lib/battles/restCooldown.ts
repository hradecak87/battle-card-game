export function isAvailable(
  restingUntilRound: number | undefined,
  currentRound: number
): boolean {
  return restingUntilRound === undefined || restingUntilRound < currentRound
}

export function nextRestingUntilRound(currentRound: number): number {
  return currentRound + 2
}
