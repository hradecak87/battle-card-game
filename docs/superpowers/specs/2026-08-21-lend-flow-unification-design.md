# Design: Unify troop-lending interaction with attack/transfer (destination-first)

## Problem

The map has three "move my troops somewhere" interactions: declare attack,
transfer, and lend. Attack and transfer share one interaction pattern:
click the **destination** territory on the map, then pick the **origin**
(one of your own territories) and cards inside the modal. Lending is the
odd one out: today you click your **own** territory (the origin) first,
then pick the destination (an ally's territory) inside the modal.

This inconsistency is confusing, especially now that coalition allies'
territories under attack are visible on the shared map (Phase 3): the
natural reaction to seeing an ally's territory threatened is to click it
and send help, not to first find and click one of your own territories.

## Solution

Unify lending onto the destination-first pattern already used by attack
and transfer.

- Click a **coalition ally's** territory on the map.
- A new **"Poslat vojska na pomoc"** button appears in the garrison modal
  (alongside/replacing where "Půjčit vojska" used to appear on your own
  territory).
- The lend modal opens with the destination already fixed (the clicked
  ally territory); the player picks which of their own territories to
  send from and which cards to send, exactly like the existing transfer
  modal.

The old entry point (click your own territory → "Půjčit vojska" → pick an
ally destination inside the modal) is removed entirely; this is the only
way to initiate a loan going forward.

No backend/RPC/migration changes are needed: `lend_troops(p_destination_territory_id,
p_card_instance_ids, p_duration_hours)` already derives the origin
territory from the selected card instances and only cares about the
destination id — it has no directional assumption baked in.

## Changes

### `components/territories/GarrisonModal.tsx`

- Remove the existing `canTransfer && onLend` button (shown for your own
  territory).
- Add `canLend = Boolean(myPlayerId) && territory.owner_id !== myPlayerId
  && relationState === 'coalition'` and show the new "Poslat vojska na
  pomoc" button when true, calling the existing `onLend` callback. **No
  `battle_locked_by` guard**: `lend_troops` only blocks on an *unresolved
  battle row* in the `battles` table (`0068_troop_lending.sql`'s "cannot
  lend troops to a territory with an unresolved battle" check), which is a
  different condition than `territory.battle_locked_by` (set earlier, at
  declare-attack time, before any battle row exists — see this component's
  existing `incomingAttackInfo` doc comment). Excluding `battle_locked_by`
  here matters because that's exactly the "ally under incoming attack"
  moment this feature exists for; once an actual battle row exists
  (`battle_id` set), selecting the tile already navigates straight to the
  battle screen instead of opening this modal (existing behavior,
  unchanged), so no separate guard is needed here — this mirrors
  `canTransfer`, which likewise has no battle-related guard today.
- **`relationState` availability for `canLend`**: `relationState` is
  fetched asynchronously after tile selection (starts `null`, same as
  `ownerInfo`) and is already used to gate other relation-dependent UI in
  this modal (the coalition badge, the "Vyhlásit válku" button).
  `canLend`'s `relationState === 'coalition'` check naturally waits for the
  fetch to resolve before showing (`null` never equals `'coalition'`), so
  no separate loading guard is needed on this side — unlike `canAttack`
  below, there's no "shown by default, then hidden" flash risk here since
  it starts hidden and only appears once confirmed.
- **Also hide the attack button for coalition allies**: change the
  existing `canAttack` condition to add
  `&& !(ownerInfoLoading || relationState === 'coalition')`. Today
  `canAttack` shows "⚔️ Zaútočit" for any non-owned territory regardless of
  relation (the backend already blocks attacking a coalition ally at the
  `declare_attack` RPC level — see coalition-attack-enforcement,
  `0065_coalition_attack_enforcement.sql`); leaving that button visible
  next to the new "Poslat vojska na pomoc" button would present a
  confusing, guaranteed-to-fail action. This is the only change to attack
  visibility; `declare_attack`'s own server-side enforcement is unchanged.
  The `!ownerInfoLoading` part avoids a flash-of-wrong-button: `ownerInfo`/
  `relationState` load asynchronously starting from `null`/`false`, so
  gating on `relationState !== 'coalition'` alone would show the attack
  button immediately after tile selection and then hide it once the fetch
  resolves to `'coalition'`. Requiring `ownerInfoLoading` to be `false`
  (an existing prop, already used elsewhere in this component to gate the
  owner-info section) first means the attack button only ever appears
  once the relation is confirmed not-coalition, never flashes then
  disappears.

### `app/map/page.tsx`

- `onLend` still opens `LendModal`, but now passes the **selected (ally)
  tile** as the destination territory instead of the caller's own
  territory. The `instances` prop passed to `LendModal` is no longer
  needed (see below) and is dropped.

### `components/territories/LendModal.tsx`

Reworked to mirror `TransferModal`'s structure:

- Prop renamed: `originTerritory: Territory` → `destinationTerritory: Territory`.
  The `instances` prop is removed (it used to carry the clicked-own-territory's
  garrison; that's no longer known up front).
- Remove the current "load all coalition members' territories as
  destination options" effect (`getMyCoalition` + `getMyTerritories` per
  member) — the destination is now fixed and known from the prop.
- Add an origin-territory selector: load `getMyTerritories(myPlayerId)`
  (excluding the destination, which can't happen here since destination is
  never the caller's own territory) for the dropdown of possible origins.
- On origin selection, load that territory's cards via
  `getCardInstancesAtTerritory(originId)` and filter to eligible instances
  (`owner_id === myPlayerId`, `status === 'stationed'`, `!loaned_from_id`,
  resolvable unit template) — same filter as today, just sourced from the
  freshly-loaded origin instead of the `instances` prop.
- ETA calculation and submission (`lendTroops(destinationTerritory.id,
  selectedInstanceIds, durationHours)`) keep their existing logic, just
  with origin/destination swapped relative to today's variable names.
- **Copy updates** (currently origin-first framing): heading changes from
  "Půjčit vojska — {originTerritory.name} ({x}, {y})" to something
  destination-first, e.g. "Poslat vojska na pomoc — {destinationTerritory.name}
  ({x}, {y})"; the origin picker label changes from an implicit "kam
  půjčuješ" destination dropdown to an explicit "odkud posíláš" origin
  dropdown (mirroring `TransferModal`'s "Odkud" origin-select copy).

### Tests

- `components/territories/LendModal.test.tsx` — update to the new prop
  shape and origin-picker flow (mirroring `TransferModal.test.tsx`'s
  patterns).
- `components/territories/GarrisonModal.test.tsx` — update/add cases for
  the new `canLend` condition (button shows for ally-owned territories,
  including ones with `battle_locked_by` set, i.e. an incoming attack in
  transit; absent for own territory, enemy territory, and NPC/unrelated
  territory) and the updated `canAttack` condition (button hidden for
  ally-owned territories once `relationState` resolves to `'coalition'`,
  and not shown at all while `ownerInfoLoading` is true).

## Out of scope

- `declare_attack`'s server-side enforcement against coalition allies is
  unchanged (already correct) — only the client-side `canAttack` button
  visibility is adjusted, per above.
- No change to `MyLoansPanel` or the recall flow.
- No change to `lend_troops` or any other RPC — this is a pure frontend
  interaction rework.
