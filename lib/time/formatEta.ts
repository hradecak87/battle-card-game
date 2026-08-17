/**
 * Formats the remaining time until `targetIso` as a short Czech string
 * (e.g. "za 14 min", "za 2 h 5 min", "za 1 d 3 h"). Shared by
 * MyMovementsPanel and GarrisonModal so both show ETAs the same way.
 * If the target is already in the past (a lazy-resolution RPC just
 * hasn't run yet to flip the row's status), returns a neutral message
 * instead of a negative/nonsensical duration.
 */
export function formatEta(targetIso: string, now: Date = new Date()): string {
  const targetMs = new Date(targetIso).getTime()
  const diffMs = targetMs - now.getTime()
  if (diffMs <= 0) return 'již brzy'

  const totalMinutes = Math.ceil(diffMs / 60000)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `za ${days} d ${hours} h`
  if (hours > 0) return `za ${hours} h ${minutes} min`
  return `za ${minutes} min`
}
