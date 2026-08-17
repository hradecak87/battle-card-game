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
  /** Attacker's player id if a battle is currently in progress here (subsystem #4). */
  battle_locked_by: string | null
  /**
   * The in-progress battle's id, for click-through navigation to
   * app/battles/[id] (subsystem #4, Task 20). Only populated by
   * `getViewport`/`getMinimapOverview` (both compute it fresh); plain
   * `getTerritory` still returns the raw row without it, so treat as
   * optional/absent there.
   */
  battle_id?: string | null
}

export interface MinimapTile {
  x: number
  y: number
  owner_id: string | null
  castle_rank: string | null
  village_rank: string | null
  claim_locked_by: string | null
  battle_locked_by: string | null
  battle_id: string | null
}

export interface TroopMovement {
  id: string
  player_id: string
  kind: 'transfer' | 'claim' | 'attack'
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

export interface HomeTerritory {
  id: number
  x: number
  y: number
}

/**
 * Looks up only the caller's own home territory directly (bug fix: the
 * "Moje domovské území" button used to scan `getMinimapOverview()`'s
 * full-map result client-side, which silently truncates at Supabase's
 * default 1000-row API cap once enough territories are owned/claimed —
 * a player's home tile could simply be missing from that response even
 * though it exists in the database). This is a targeted, indexed lookup
 * that can never be affected by that cap.
 */
export async function getMyHomeTerritory() {
  return supabase.rpc('get_my_home_territory') as unknown as Promise<{
    data: HomeTerritory[] | null
    error: { message: string } | null
  }>
}

export interface MyTerritory {
  id: number
  x: number
  y: number
  is_home: boolean
}

/**
 * Lists all territories owned by the given player (max 32 by the
 * ownership cap, so no pagination/row-limit concern like
 * `getMinimapOverview`). Used to let the player pick an origin territory
 * from a dropdown instead of having to know/type its raw numeric id
 * (declare-attack/claim/transfer flows all need an origin territory).
 * `territories` has a public "select all" RLS policy, so a plain table
 * query works without needing a dedicated RPC.
 */
export async function getMyTerritories(ownerId: string) {
  return supabase
    .from('territories')
    .select('id, x, y, is_home')
    .eq('owner_id', ownerId)
    .order('is_home', { ascending: false })
    .order('x')
    .order('y') as unknown as Promise<{
    data: MyTerritory[] | null
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

export interface TerritoryCoords {
  id: number
  x: number
  y: number
  /**
   * Only meaningful for territories currently being claimed. A claim's
   * actual completion time — separate from the (usually much shorter)
   * `troop_movements.transfer_arrives_at` of the 'claim'-kind movement,
   * which only marks when the troops *arrive*, not when the occupation
   * itself finishes (see 0002_territories.sql's start_claim/resolve_due_movements).
   */
  claim_occupation_completes_at: string | null
}

/**
 * Bulk coordinate lookup for arbitrary territory ids (e.g. the origin/
 * destination of the caller's own movements, which aren't necessarily
 * owned by the caller — the destination of an attack never is). Used to
 * render "(x, y) → (x, y)" labels without one RPC round-trip per row.
 */
export async function getTerritoriesByIds(ids: number[]) {
  if (ids.length === 0) return { data: [], error: null }
  return supabase
    .from('territories')
    .select('id, x, y, claim_occupation_completes_at')
    .in('id', ids) as unknown as Promise<{
    data: TerritoryCoords[] | null
    error: { message: string } | null
  }>
}

/**
 * The arrival time of the (at most one, enforced by declare_attack's
 * battle_locked_by check-and-lock) in-transit attack currently converging
 * on this territory. Territories don't carry this directly (only claims
 * get a `claim_transfer_arrives_at` column) — this is a small, publicly
 * readable (`troop_movements_select_all`) direct query so anyone viewing
 * a battle-locked-but-not-yet-active tile can see when the attacker's
 * army will actually arrive and the battle will start.
 */
export async function getIncomingAttackArrival(territoryId: number) {
  return supabase
    .from('troop_movements')
    .select('transfer_arrives_at')
    .eq('destination_territory_id', territoryId)
    .eq('kind', 'attack')
    .eq('status', 'in_transit')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle() as unknown as Promise<{
    data: { transfer_arrives_at: string } | null
    error: { message: string } | null
  }>
}

export interface ActiveBattleRef {
  id: string
  territory_id: number
}

/**
 * All of the caller's own not-yet-resolved battles (as either side), so
 * MyMovementsPanel can show "bitva právě probíhá →" instead of an ETA
 * once an in-transit attack has actually arrived and a battle exists.
 */
export async function getMyActiveBattles(playerId: string) {
  return supabase
    .from('battles')
    .select('id, territory_id')
    .or(`attacker_id.eq.${playerId},defender_id.eq.${playerId}`)
    .not('status', 'in', '(resolved,expired)') as unknown as Promise<{
    data: ActiveBattleRef[] | null
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

export interface MyCardInstance extends CardInstanceWithTemplate {
  territories: { id: number; x: number; y: number; is_home: boolean } | null
}

/**
 * All card instances a player owns, with their template + current
 * territory location joined in, so the "Moje sbírka" page (spec §5) can
 * show rank/type/location filters and search without N+1 queries.
 */
export async function getMyCardInstances(ownerId: string) {
  return supabase
    .from('card_instances')
    .select(
      'instance_id, template_id, owner_id, stationed_territory_id, status, card_templates(id, name, flavor_text, rank, category, unit_type, base_stats, total_supply, defense_bonus_pct, attack_bonus_pct), territories(id, x, y, is_home)'
    )
    .eq('owner_id', ownerId) as unknown as Promise<{
    data: MyCardInstance[] | null
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

/**
 * TEST-ONLY convenience (see 0006_debug_speed_up_movement.sql): shrinks
 * the caller's own in-flight movement/claim to ~10-20s instead of the
 * real duration, so playtesting doesn't require waiting hours/days.
 */
export async function debugSpeedUpMovement(movementId: string) {
  return supabase.rpc('debug_speed_up_movement', { p_movement_id: movementId })
}

export async function buildStructure(territoryId: number, cardInstanceId: string) {
  return supabase.rpc('build_structure', {
    territory_id: territoryId,
    card_instance_id: cardInstanceId,
  })
}
