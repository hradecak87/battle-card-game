import { resolveDuel } from '../cards/combat'
import { EffectiveCard } from '../cards/types'

export function pickNpcDefenderCard<T>(
  attackerEffective: EffectiveCard,
  candidates: { id: T; effective: EffectiveCard }[],
  rand: () => number
): T {
  if (candidates.length === 0) {
    throw new Error('pickNpcDefenderCard requires at least one candidate')
  }

  const winningCandidate = candidates.find(
    (candidate) => resolveDuel(attackerEffective, candidate.effective) === 'defender'
  )
  if (winningCandidate) return winningCandidate.id

  return candidates[Math.floor(rand() * candidates.length)].id
}
