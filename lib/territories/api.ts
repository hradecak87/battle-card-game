import { supabase } from '@/lib/supabase/client'

/**
 * Thin typed wrapper functions around the Territory Map RPCs (design spec
 * §3, §6, §7, §9.2). Centralizes `.rpc(...)` calls so components never
 * repeat the raw RPC name/argument shape (mirrors how subsystem #2's pages
 * call `complete_kingdom_onboarding`/`heartbeat`, just centralized here
 * since this subsystem has many more RPCs).
 */

export interface Territory {
  id: number
  x: number
  y: number
  difficulty: 1 | 2 | 3 | 4 | 5
  castle_rank: string | null
  village_rank: string | null
  owner_id: string | null
  is_home: boolean
  claim_locked_by: string | null
  claim_started_at: string | null
  claim_transfer_arrives_at: string | null
  claim_occupation_completes_at: string | null
}

export interface MinimapTile {
  x: number
  y: number
  owner_id: string | null
  castle_rank: string | null
  village_rank: string | null
  claim_locked_by: string | null
}

export interface TroopMovement {
  id: string
  player_id: string
  kind: 'transfer' | 'claim'
  origin_territory_id: number
  destination_territory_id: number
  started_at: string
  transfer_arrives_at: string
  status: 'in_transit' | 'occupying' | 'completed' | 'cancelled'
  cancelled_at: string | null
}

export async function getViewport(x1: number, y1: number, x2: number, y2: number) {
  return supabase.rpc('get_viewport', { x1, y1, x2, y2 }) as unknown as Promise<{
    data: Territory[] | null
    error: { message: string } | null
  }>
}

export async function getMinimapOverview() {
  return supabase.rpc('get_minimap_overview') as unknown as Promise<{
    data: MinimapTile[] | null
    error: { message: string } | null
  }>
}

export async function getTerritory(territoryId: number) {
  return supabase.rpc('get_territory', { territory_id: territoryId }) as unknown as Promise<{
    data: Territory[] | null
    error: { message: string } | null
  }>
}

export async function getMyMovements() {
  return supabase.rpc('get_my_movements') as unknown as Promise<{
    data: TroopMovement[] | null
    error: { message: string } | null
  }>
}

export interface CardInstanceWithTemplate {
  instance_id: string
  template_id: string
  owner_id: string | null
  stationed_territory_id: number | null
  status: 'stationed' | 'in_transit'
  card_templates: {
    id: string
    name: string
    flavor_text: string
    rank: string
    category: 'unit' | 'castle' | 'village'
    unit_type: string | null
    base_stats: { str: number; lng: number; def: number; hp: number } | null
    total_supply: number | null
    defense_bonus_pct: number | null
    attack_bonus_pct: number | null
  } | null
}

export async function getCardInstancesAtTerritory(territoryId: number) {
  return supabase
    .from('card_instances')
    .select(
      'instance_id, template_id, owner_id, stationed_territory_id, status, card_templates(id, name, flavor_text, rank, category, unit_type, base_stats, total_supply, defense_bonus_pct, attack_bonus_pct)'
    )
    .eq('stationed_territory_id', territoryId) as unknown as Promise<{
    data: CardInstanceWithTemplate[] | null
    error: { message: string } | null
  }>
}

export async function startClaim(
  originTerritoryId: number,
  destinationTerritoryId: number,
  cardInstanceIds: string[]
) {
  return supabase.rpc('start_claim', {
    origin_territory_id: originTerritoryId,
    destination_territory_id: destinationTerritoryId,
    card_instance_ids: cardInstanceIds,
  })
}

export async function startTransfer(
  originTerritoryId: number,
  destinationTerritoryId: number,
  cardInstanceIds: string[]
) {
  return supabase.rpc('start_transfer', {
    origin_territory_id: originTerritoryId,
    destination_territory_id: destinationTerritoryId,
    card_instance_ids: cardInstanceIds,
  })
}

export async function cancelClaim(territoryId: number) {
  return supabase.rpc('cancel_claim', { territory_id: territoryId })
}

export async function buildStructure(territoryId: number, cardInstanceId: string) {
  return supabase.rpc('build_structure', {
    territory_id: territoryId,
    card_instance_id: cardInstanceId,
  })
}
