import { supabase } from '@/lib/supabase/client'

export type WorldEventType =
  | 'attack_declared'
  | 'territory_claimed'
  | 'battle_won'
  | 'battle_surrendered'
  | 'territory_abandoned'
  | 'attack_recalled'
  | 'king_relocated'
  | 'player_leveled_up'
  | 'player_joined'
  | 'war_declared'
  | 'peace_signed'

export interface AttackInTransitRow {
  movement_id: string
  attacker_id: string
  attacker_display_name: string
  attacker_home_x: number | null
  attacker_home_y: number | null
  target_territory_id: number
  target_x: number
  target_y: number
  target_owner_id: string | null
  target_owner_display_name: string | null
  target_owner_is_npc: boolean
  target_owner_home_x: number | null
  target_owner_home_y: number | null
  arrives_at: string
}

export interface ClaimInProgressRow {
  territory_id: number
  claimant_id: string
  claimant_display_name: string
  claimant_home_x: number | null
  claimant_home_y: number | null
  territory_x: number
  territory_y: number
  claim_completes_at: string
}

export interface ActiveBattleRow {
  battle_id: string
  attacker_id: string
  attacker_display_name: string
  attacker_home_x: number | null
  attacker_home_y: number | null
  defender_id: string | null
  defender_display_name: string | null
  defender_home_x: number | null
  defender_home_y: number | null
  territory_id: number
  territory_x: number
  territory_y: number
  status: 'awaiting_ready' | 'active'
  current_round: number
}

export interface WorldEventRow {
  event_type: WorldEventType
  created_at: string
  payload: Record<string, unknown>
  total_count: number
}

export async function listAttacksInTransit() {
  return supabase.rpc('world_list_attacks_in_transit') as unknown as Promise<{
    data: AttackInTransitRow[] | null
    error: { message: string } | null
  }>
}

export async function listClaimsInProgress() {
  return supabase.rpc('world_list_claims_in_progress') as unknown as Promise<{
    data: ClaimInProgressRow[] | null
    error: { message: string } | null
  }>
}

export async function listActiveBattles() {
  return supabase.rpc('world_list_active_battles') as unknown as Promise<{
    data: ActiveBattleRow[] | null
    error: { message: string } | null
  }>
}

export async function listWorldEvents(page: number, pageSize: number) {
  return supabase.rpc('world_list_events', {
    p_page: page,
    p_page_size: pageSize,
  }) as unknown as Promise<{
    data: WorldEventRow[] | null
    error: { message: string } | null
  }>
}
