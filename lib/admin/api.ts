import type { NationId } from '@/lib/players/nations'
import { supabase } from '@/lib/supabase/client'

export type AdminBattleStatus = 'awaiting_ready' | 'active' | 'resolved' | 'expired'

export interface AdminStatusRow {
  is_admin: boolean
}

export interface AdminOnlinePlayerRow {
  id: string
  display_name: string
  nation: NationId
  xp: number
  kingdom_name: string | null
  last_seen_at: string
  is_online: boolean
  active_battle_id: string | null
  active_battle_role: 'attacker' | 'defender' | null
}

export interface AdminActiveBattleRow {
  id: string
  territory_id: number
  territory_x: number
  territory_y: number
  attacker_id: string
  attacker_display_name: string
  defender_id: string | null
  defender_display_name: string | null
  current_round: number
  status: AdminBattleStatus
}

export interface AdminPlayerCardRow {
  instance_id: string
  template_id: string
  template_name: string
  template_rank: string
  template_category: 'unit' | 'castle' | 'village' | 'boost'
  owner_id: string | null
  stationed_territory_id: number | null
  territory_x: number | null
  territory_y: number | null
  status: 'stationed' | 'in_transit'
}

export interface AdminCardTemplateOption {
  id: string
  name: string
  rank: string
  category: 'unit' | 'castle' | 'village' | 'boost'
  unit_type: string | null
}

/**
 * Lightweight self-check for `/admin`: the page must know whether the
 * currently authenticated player may load any admin RPC data at all,
 * without firing those heavier requests first.
 */
export async function getAdminStatus(playerId: string) {
  return supabase
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .single() as unknown as Promise<{
    data: AdminStatusRow | null
    error: { message: string } | null
  }>
}

export async function getAdminOnlinePlayers() {
  return supabase.rpc('admin_list_online_players') as unknown as Promise<{
    data: AdminOnlinePlayerRow[] | null
    error: { message: string } | null
  }>
}

export async function getAdminActiveBattles() {
  return supabase.rpc('admin_list_active_battles') as unknown as Promise<{
    data: AdminActiveBattleRow[] | null
    error: { message: string } | null
  }>
}

/**
 * The admin card tool needs both unit and structure templates, so it reads
 * the persisted `card_templates` table instead of the client-only unit
 * catalog helper in `lib/cards/catalog.ts`.
 */
export async function getAdminCardTemplates() {
  return supabase
    .from('card_templates')
    .select('id, name, rank, category, unit_type')
    .order('category')
    .order('rank')
    .order('name') as unknown as Promise<{
    data: AdminCardTemplateOption[] | null
    error: { message: string } | null
  }>
}

export async function getAdminPlayerCards(playerId: string) {
  return supabase.rpc('admin_list_player_cards', { p_player_id: playerId }) as unknown as Promise<{
    data: AdminPlayerCardRow[] | null
    error: { message: string } | null
  }>
}

export async function grantAdminCard(
  playerId: string,
  templateId: string,
  territoryId: number | null,
) {
  return supabase.rpc('admin_grant_card', {
    p_player_id: playerId,
    p_template_id: templateId,
    p_territory_id: territoryId,
  }) as unknown as Promise<{ data: string | null; error: { message: string } | null }>
}

export async function removeAdminCard(cardInstanceId: string) {
  return supabase.rpc('admin_remove_card', {
    p_card_instance_id: cardInstanceId,
  }) as unknown as Promise<{ data: null; error: { message: string } | null }>
}

export async function grantAdminXp(playerId: string, amount: number) {
  return supabase.rpc('admin_grant_xp', {
    p_player_id: playerId,
    p_amount: amount,
  }) as unknown as Promise<{ data: number | null; error: { message: string } | null }>
}
