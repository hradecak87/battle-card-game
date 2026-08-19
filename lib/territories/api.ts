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
  owner_is_npc?: boolean
  is_home: boolean
  claim_locked_by: string | null
  claim_started_at: string | null
  claim_transfer_arrives_at: string | null
  claim_occupation_completes_at: string | null
  /** Custom display name set by the territory owner (migration 0008). */
  name: string | null
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
  owner_is_npc?: boolean
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
  castle_rank: string | null
  village_rank: string | null
  name: string | null
  battle_locked_by: string | null
}

export interface PlayerPublicInfo {
  id: string
  display_name: string
  nation: string
  kingdom_name: string | null
  xp: number
  is_npc?: boolean
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
    .select('id, x, y, is_home, castle_rank, village_rank, name, battle_locked_by')
    .eq('owner_id', ownerId)
    .order('is_home', { ascending: false })
    .order('x')
    .order('y') as unknown as Promise<{
    data: MyTerritory[] | null
    error: { message: string } | null
  }>
}

export async function getPlayerPublicInfo(playerId: string) {
  return supabase
    .from('players')
    .select('id, display_name, nation, kingdom_name, xp, is_npc')
    .eq('id', playerId)
    .single() as unknown as Promise<{
    data: PlayerPublicInfo | null
    error: { message: string } | null
  }>
}

export async function getTerritory(territoryId: number) {
  return supabase.rpc('get_territory', { territory_id: territoryId }) as unknown as Promise<{
    data: Territory[] | null
    error: { message: string } | null
  }>
}

export interface AttackOriginGroup {
  originTerritoryId: number
  cardInstanceIds: string[]
}

export async function declareAttack(
  targetTerritoryId: number,
  originGroups: AttackOriginGroup[],
  boostCardInstanceId: string | null = null
) {
  return supabase.rpc('declare_attack', {
    target_territory_id: targetTerritoryId,
    origin_groups: originGroups.map((group) => ({
      origin_territory_id: group.originTerritoryId,
      card_instance_ids: group.cardInstanceIds,
    })),
    p_boost_card_instance_id: boostCardInstanceId,
  }) as unknown as Promise<{ data: string | null; error: { message: string } | null }>
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
 * The `owner_id` of a territory's 4 orthogonal (up/down/left/right)
 * neighbors, for the client-side `isTerritoryAttackable` pre-check
 * (backlog #10). Off-grid neighbors (target on the edge of the 256x256
 * grid) simply have no matching row and are represented as `null`, matching
 * the server-side `declare_attack` check's `t2.id is null` case.
 */
export async function getTerritoryNeighborOwners(x: number, y: number) {
  const { data, error } = await supabase
    .from('territories')
    .select('x, y, owner_id')
    .in('x', [x - 1, x, x + 1])
    .in('y', [y - 1, y, y + 1]) as unknown as {
    data: { x: number; y: number; owner_id: string | null }[] | null
    error: { message: string } | null
  }
  if (error) return { data: null, error }
  const byCoord = new Map((data ?? []).map((t) => [`${t.x},${t.y}`, t.owner_id]))
  const neighborCoords: [number, number][] = [
    [x, y - 1],
    [x, y + 1],
    [x - 1, y],
    [x + 1, y],
  ]
  const owners = neighborCoords.map(([nx, ny]) => byCoord.get(`${nx},${ny}`) ?? null)
  return { data: owners, error: null }
}

export interface IncomingAttackInfo {
  transfer_arrives_at: string
  attacker_id: string
  attacker_display_name: string | null
  attacker_kingdom_name: string | null
  attacker_is_npc: boolean
  attacker_home_x: number | null
  attacker_home_y: number | null
}

/**
 * Details of the (at most one, enforced by declare_attack's
 * battle_locked_by check-and-lock) in-transit attack currently converging
 * on this territory: arrival time plus the attacker's identity and home
 * territory coordinates (migration 0028) — so a battle-locked-but-not-yet-
 * active tile's detail view can show *who* is attacking and link through
 * to their home, not just "an attack is on the way".
 */
export async function getIncomingAttackInfo(territoryId: number) {
  const { data, error } = await supabase.rpc('get_incoming_attack_info', {
    p_territory_id: territoryId,
  })
  if (error) return { data: null, error }
  const rows = (data ?? []) as IncomingAttackInfo[]
  return { data: rows[0] ?? null, error: null }
}

export interface IncomingAttackOnMyTerritory {
  movement_id: string
  territory_id: number
  territory_x: number
  territory_y: number
  territory_name: string | null
  attacker_id: string
  attacker_display_name: string | null
  attacker_is_npc: boolean
  attacker_home_x: number | null
  attacker_home_y: number | null
  transfer_arrives_at: string
}

/**
 * Every in-transit attack currently converging on a territory the caller
 * owns (or is claiming), for MyMovementsPanel's defender section —
 * `get_my_movements()` only ever returns movements the caller personally
 * sent, so incoming attacks (where the *attacker* is `player_id`) were
 * previously invisible to the defender anywhere except a blinking map tile.
 */
export async function getIncomingAttacksOnMyTerritories() {
  return supabase.rpc('get_incoming_attacks_on_my_territories') as unknown as Promise<{
    data: IncomingAttackOnMyTerritory[] | null
    error: { message: string } | null
  }>
}

/**
 * Every currently in-transit reinforcement (transfer) heading to any of
 * the given destination territories, for MyMovementsPanel's "defender is
 * rushing in reinforcements" warning (backlog #23) — lets an attacker with
 * an in-transit attack see if a reinforcement will land before their own
 * troops do.
 */
export async function getIncomingReinforcements(destinationTerritoryIds: number[]) {
  if (destinationTerritoryIds.length === 0) return { data: [], error: null }
  return supabase
    .from('troop_movements')
    .select('destination_territory_id, transfer_arrives_at')
    .eq('kind', 'transfer')
    .eq('status', 'in_transit')
    .in('destination_territory_id', destinationTerritoryIds) as unknown as Promise<{
    data: { destination_territory_id: number; transfer_arrives_at: string }[] | null
    error: { message: string } | null
  }>
}

export interface ActiveBattleRef {
  id: string
  territory_id: number
}

export interface ActiveBattleLookup {
  id: string
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

export async function getActiveBattleForTerritory(territoryId: number) {
  return supabase
    .from('battles')
    .select('id')
    .eq('territory_id', territoryId)
    .not('status', 'in', '(resolved,expired)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() as unknown as Promise<{
    data: ActiveBattleLookup | null
    error: { message: string } | null
  }>
}

export interface RecentBattleRef {
  id: string
  territory_id: number
  current_round: number
  resolved_at: string
}

/**
 * Battles the caller was part of that resolved within the last 48h.
 *
 * Needed because NPC-defended battles resolve synchronously the instant
 * the attacking troop movement arrives (see `resolve_due_movements()` /
 * `declare_attack`'s NPC path) — by the time the client polls again, the
 * movement is already 'completed' (so it drops out of `getMyMovements`)
 * *and* the battle is already 'resolved' (so it's excluded by
 * `getMyActiveBattles`). Without this, an attacker who captures an
 * NPC-held territory never sees any link to the battle at all: the
 * territory just silently changes owner with the full round-by-round
 * fight (however many rounds) fully recorded but never surfaced.
 */
export async function getMyRecentlyResolvedBattles(playerId: string) {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  return supabase
    .from('battles')
    .select('id, territory_id, current_round, resolved_at')
    .or(`attacker_id.eq.${playerId},defender_id.eq.${playerId}`)
    .eq('status', 'resolved')
    .gte('resolved_at', since)
    .order('resolved_at', { ascending: false }) as unknown as Promise<{
    data: RecentBattleRef[] | null
    error: { message: string } | null
  }>
}

export interface CardInstanceWithTemplate {
  instance_id: string
  template_id: string
  owner_id: string | null
  stationed_territory_id: number | null
  status: 'stationed' | 'in_transit'
  is_masked?: boolean
  card_templates: {
    id: string
    name: string | null
    flavor_text: string | null
    rank: string
    category: 'unit' | 'castle' | 'village' | 'boost'
    unit_type: string | null
    base_stats: { str: number; lng: number; def: number; hp: number; speed: number } | null
    total_supply: number | null
    defense_bonus_pct: number | null
    attack_bonus_pct: number | null
    boost_type?: 'territorial' | 'offensive' | null
    effect_kind?: 'stat_multiplier' | 'instant_effect' | null
    instant_effect_kind?: 'steal_unit' | null
    pct_str?: number | null
    pct_lng?: number | null
    pct_def?: number | null
    pct_hp?: number | null
  } | null
}

export async function getCardInstancesAtTerritory(territoryId: number) {
  return supabase.rpc('get_visible_territory_cards', {
    p_territory_id: territoryId,
  }) as unknown as Promise<{
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
      'instance_id, template_id, owner_id, stationed_territory_id, status, card_templates(id, name, flavor_text, rank, category, unit_type, base_stats, total_supply, defense_bonus_pct, attack_bonus_pct, boost_type, effect_kind, instant_effect_kind, pct_str, pct_lng, pct_def, pct_hp), territories(id, x, y, is_home)'
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
 * Backlog #19: relinquishes ownership of a non-home territory. Garrisoned
 * cards automatically start a transfer back to the caller's home
 * territory — callers should warn the player and let them redirect cards
 * elsewhere first, since this always sends survivors home.
 */
export async function abandonTerritory(territoryId: number) {
  return supabase.rpc('abandon_territory', { p_territory_id: territoryId }) as unknown as Promise<{
    data: null
    error: { message: string } | null
  }>
}

export async function relocateHome(territoryId: number) {
  return supabase.rpc('relocate_home', { p_new_territory_id: territoryId }) as unknown as Promise<{
    data: null
    error: { message: string } | null
  }>
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

export async function renameTerritory(territoryId: number, newName: string) {
  return supabase.rpc('rename_territory', {
    territory_id: territoryId,
    new_name: newName,
  })
}

/**
 * All structure (castle/village) card instances owned by the given player,
 * with their template joined in. Structure cards can be built from anywhere
 * (build_structure checks ownership, not location), so no location filter
 * is applied here — they sit in general inventory until the player builds.
 */
export async function getMyStructureCardInstances(ownerId: string) {
  return supabase
    .from('card_instances')
    .select(
      'instance_id, template_id, owner_id, stationed_territory_id, status, card_templates!inner(id, name, flavor_text, rank, category, unit_type, base_stats, total_supply, defense_bonus_pct, attack_bonus_pct, boost_type, effect_kind, instant_effect_kind, pct_str, pct_lng, pct_def, pct_hp)'
    )
    .eq('owner_id', ownerId)
    .in('card_templates.category', ['castle', 'village']) as unknown as Promise<{
    data: CardInstanceWithTemplate[] | null
    error: { message: string } | null
  }>
}
