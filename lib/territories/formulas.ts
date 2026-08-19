/**
 * Transfer/occupation timing formulas for the Territory Map subsystem.
 * See docs/superpowers/specs/2026-08-15-territory-map-design.md §9.1.
 */

import { NationId } from '@/lib/players/nations'
import { EffectiveCard } from '@/lib/cards/types'

export interface GridPoint {
  x: number
  y: number
}

/** Chebyshev (chessboard) distance — max of the x and y deltas. */
export function chebyshevDistance(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

export type Difficulty = 1 | 2 | 3 | 4 | 5

/** Difficulty multiplier table (spec §9.1, mirrors the card-rank scale). */
export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  1: 1.0,
  2: 1.5,
  3: 2.25,
  4: 3.4,
  5: 5.0,
}

const TRANSFER_RATE_HOURS_PER_TILE = 0.3
const TRANSFER_FLOOR_HOURS = 0.25
const OCCUPATION_CONSTANT = 150
const OCCUPATION_FLOOR_HOURS = 10

const MONGOL_TRANSFER_MULTIPLIER = 0.75 // Mongol Horde: -25% transfer time
const SCANDINAVIA_OCCUPATION_MULTIPLIER = 0.8 // Scandinavia: -20% occupation time

/** Reference speed (0-10 scale) at which the speed multiplier is a no-op. */
const BASELINE_SPEED = 5
const SPEED_MULTIPLIER_MIN = 0.4
const SPEED_MULTIPLIER_MAX = 3.0

/**
 * Hours for troops to physically travel `distance` tiles. Mongol Horde's
 * -25% perk (spec/subsystem #2 §3, applied here per that spec's explicit
 * deferral to "whichever subsystem owns the mechanic") is applied after
 * the floor.
 *
 * `groupSpeed` (backlog #12) is the minimum `speed` stat among the moving
 * card selection — the slowest unit sets the pace for the whole group.
 * Omit it (or pass the baseline `5`) to get today's unmodified duration.
 * The resulting multiplier is clamped to [0.4, 3.0] so no future speed
 * value can produce a degenerate duration.
 */
export function transferHours(distance: number, nation?: NationId, groupSpeed?: number): number {
  const speedMultiplier =
    groupSpeed === undefined
      ? 1
      : Math.min(SPEED_MULTIPLIER_MAX, Math.max(SPEED_MULTIPLIER_MIN, BASELINE_SPEED / groupSpeed))
  const base = Math.max(TRANSFER_FLOOR_HOURS, distance * TRANSFER_RATE_HOURS_PER_TILE * speedMultiplier)
  return nation === 'mongol_horde' ? base * MONGOL_TRANSFER_MULTIPLIER : base
}

/**
 * Sums rank-scaled str+lng+def+hp across a set of already rank-scaled
 * (`applyRank`-processed) cards — the client-side mirror of the
 * `_army_power()` SQL helper (0002_territories.sql §8), used to preview
 * `occupationHours()` before a claim is submitted (backlog: occupation
 * ETA preview). Must stay in sync with that SQL helper's definition.
 */
export function armyPower(cards: EffectiveCard[]): number {
  return cards.reduce((sum, c) => sum + c.str + c.lng + c.def + c.hp, 0)
}

/**
 * Hours to occupy an empty territory once troops have arrived. Rewards a
 * stronger `armyPower` (sum of str+lng+def+hp over the effective stats of
 * the sent instances) with a lower duration, but never below the 10-hour
 * floor — Scandinavia's -20% perk is applied *after* that floor is
 * enforced, so a Viking's effective floor is 8 hours, intentionally lower
 * than the baseline (spec §9.1).
 */
export function occupationHours(
  armyPower: number,
  difficulty: Difficulty,
  nation?: NationId
): number {
  const base = Math.max(
    OCCUPATION_FLOOR_HOURS,
    (OCCUPATION_CONSTANT * DIFFICULTY_MULTIPLIER[difficulty]) / Math.sqrt(armyPower)
  )
  return nation === 'scandinavia' ? base * SCANDINAVIA_OCCUPATION_MULTIPLIER : base
}
