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
