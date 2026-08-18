import { supabase } from '@/lib/supabase/client'

/**
 * Thin typed wrapper functions around the Multi-Army RTS Battle RPCs
 * (design spec §3.6). Mirrors `lib/territories/api.ts`'s
 * one-function-per-RPC pattern.
 */

export type BattleStatus = 'awaiting_ready' | 'active' | 'resolved' | 'expired'

export interface BattleRow {
  id: string
  territory_id: number
  attacker_id: string
  defender_id: string | null
  is_home_target: boolean
  movement_id: string
  status: BattleStatus
  attacker_ready_at: string | null
  defender_ready_at: string | null
  ready_deadline: string
  current_round: number
  round_deadline: string | null
  winner_side: 'attacker' | 'defender' | null
  resolved_at: string | null
  created_at: string
}

export interface BattleCardTemplate {
  id: string
  category: 'unit' | 'castle' | 'village'
  unit_type: string | null
  rank: string
  name: string
  flavor_text: string
  base_stats: { str: number; lng: number; def: number; hp: number } | null
  defense_bonus_pct: number | null
  attack_bonus_pct: number | null
  total_supply: number | null
  minted_count: number
}

export interface BattleCard {
  instance_id: string
  owner_id: string | null
  status: 'stationed' | 'in_transit'
  template: BattleCardTemplate
  is_resting: boolean
  times_used: number
}

export interface BattleRoundRow {
  id: string
  battle_id: string
  round_number: number
  attacker_card_instance_id: string | null
  defender_card_instance_id: string | null
  winner_card_instance_id: string | null
  auto_picked: boolean
  skipped: boolean
  resolved_at: string | null
  // Populated by _resolve_round (0005_battle_round_breakdown.sql); null for
  // skipped rounds and for rounds resolved before that migration existed.
  attacker_atk: number | null
  attacker_dmg_dealt: number | null
  attacker_ttk: number | null // null also means "infinite" (0 damage dealt)
  defender_atk: number | null
  defender_dmg_dealt: number | null
  defender_ttk: number | null
  attacker_win_probability: number | null
  flavor_text: string | null
  // Resolved straight from card_instances/card_templates by id (get_battle),
  // independent of the live attacker_roster/defender_pool arrays — stays
  // correct even after the card is captured or dies in a later round.
  attacker_card: { instance_id: string; template: BattleCardTemplate } | null
  defender_card: { instance_id: string; template: BattleCardTemplate } | null
}

export interface GetBattleResult {
  battle: BattleRow
  attacker_roster: BattleCard[]
  defender_pool: BattleCard[]
  rounds: BattleRoundRow[]
}

export interface BattleHistoryEntry {
  id: string
  territory_id: number
  territory: { x: number; y: number } | null
  role: 'attacker' | 'defender'
  opponent_id: string | null
  opponent_name: string
  outcome: 'won' | 'lost' | 'expired'
  round_count: number
  troops_gained: number
  troops_lost: number
  territory_change: 'gained' | 'lost' | 'none'
  resolved_at: string | null
  created_at: string
}

interface BattleHistoryRoundRow {
  round_number: number
  attacker_card_instance_id: string | null
  defender_card_instance_id: string | null
  winner_card_instance_id: string | null
  skipped: boolean
}

interface BattleHistorySelectRow {
  id: string
  territory_id: number
  attacker_id: string
  defender_id: string | null
  is_home_target: boolean
  status: 'resolved' | 'expired'
  winner_side: 'attacker' | 'defender' | null
  resolved_at: string | null
  created_at: string
  territories: { x: number; y: number } | { x: number; y: number }[] | null
  attacker:
    | { id: string; display_name: string }
    | { id: string; display_name: string }[]
    | null
  defender:
    | { id: string; display_name: string }
    | { id: string; display_name: string }[]
    | null
  battle_rounds: BattleHistoryRoundRow[] | null
}

function firstRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function countTroopDelta(role: 'attacker' | 'defender', rounds: BattleHistoryRoundRow[]) {
  let troopsGained = 0
  let troopsLost = 0

  for (const round of rounds) {
    if (round.skipped || !round.winner_card_instance_id) continue

    const myCardId =
      role === 'attacker' ? round.attacker_card_instance_id : round.defender_card_instance_id

    if (myCardId && round.winner_card_instance_id === myCardId) {
      troopsGained++
    } else {
      troopsLost++
    }
  }

  return { troopsGained, troopsLost }
}

function inferTerritoryChange(
  role: 'attacker' | 'defender',
  winnerSide: 'attacker' | 'defender' | null,
  isHomeTarget: boolean,
): BattleHistoryEntry['territory_change'] {
  if (winnerSide !== 'attacker' || isHomeTarget) return 'none'
  // Battle rows don't record the rare "attacker won, but capture was blocked
  // by the 32-territory cap" exception, so we follow the normal finalize path:
  // any non-home attacker win is treated as a territory swing.
  return role === 'attacker' ? 'gained' : 'lost'
}

export async function getMyBattleHistory(playerId: string) {
  const { data, error } = await supabase
    .from('battles')
    .select(
      'id, territory_id, attacker_id, defender_id, is_home_target, status, winner_side, resolved_at, created_at, territories(x, y), attacker:players!battles_attacker_id_fkey(id, display_name), defender:players!battles_defender_id_fkey(id, display_name), battle_rounds(round_number, attacker_card_instance_id, defender_card_instance_id, winner_card_instance_id, skipped)'
    )
    .or(`attacker_id.eq.${playerId},defender_id.eq.${playerId}`)
    .in('status', ['resolved', 'expired'])
    .order('resolved_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) {
    return { data: null, error: error as { message: string } | null }
  }

  const history = ((data ?? []) as unknown as BattleHistorySelectRow[]).map((battle) => {
    const role = battle.attacker_id === playerId ? 'attacker' : 'defender'
    const rounds = battle.battle_rounds ?? []
    const { troopsGained, troopsLost } = countTroopDelta(role, rounds)
    const territory = firstRelation(battle.territories)
    const attacker = firstRelation(battle.attacker)
    const defender = firstRelation(battle.defender)

    return {
      id: battle.id,
      territory_id: battle.territory_id,
      territory,
      role,
      opponent_id: role === 'attacker' ? battle.defender_id : battle.attacker_id,
      opponent_name:
        role === 'attacker'
          ? defender?.display_name ?? 'NPC'
          : attacker?.display_name ?? 'Neznámý hráč',
      outcome:
        battle.winner_side == null
          ? 'expired'
          : battle.winner_side === role
            ? 'won'
            : 'lost',
      round_count: rounds.length,
      troops_gained: troopsGained,
      troops_lost: troopsLost,
      territory_change: inferTerritoryChange(role, battle.winner_side, battle.is_home_target),
      resolved_at: battle.resolved_at,
      created_at: battle.created_at,
    } satisfies BattleHistoryEntry
  })

  return {
    data: history,
    error: null,
  }
}

export async function declareAttack(
  originTerritoryId: number,
  targetTerritoryId: number,
  cardInstanceIds: string[]
) {
  return supabase.rpc('declare_attack', {
    origin_territory_id: originTerritoryId,
    target_territory_id: targetTerritoryId,
    card_instance_ids: cardInstanceIds,
  }) as unknown as Promise<{ data: string | null; error: { message: string } | null }>
}

export async function getBattle(battleId: string) {
  const { data, error } = await supabase.rpc('get_battle', { p_battle_id: battleId })
  // get_battle is a `returns table (...)` function — Postgres/PostgREST
  // returns it as an array of (one) row; unwrap to a single object like
  // the rest of this file's callers expect.
  const row = (data as GetBattleResult[] | null)?.[0] ?? null
  return { data: row, error: error as { message: string } | null }
}

export async function markReady(battleId: string) {
  return supabase.rpc('mark_ready', { p_battle_id: battleId })
}

export async function pickDefenderCard(battleId: string, cardInstanceId: string) {
  return supabase.rpc('pick_defender_card', {
    p_battle_id: battleId,
    p_card_instance_id: cardInstanceId,
  })
}
