# Lend-Flow Unification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lending troops to a coalition ally work like declaring an attack or transferring troops: click the ally's territory first (destination), then pick your own origin territory + cards inside the modal — instead of today's click-your-own-territory-first flow.

**Architecture:** Pure frontend rework, no backend/RPC/migration changes (`lend_troops` already takes a destination id + card instance ids and derives origin from the cards). Three files change: `app/map/page.tsx` (wiring + a new `relationLoading` state), `components/territories/GarrisonModal.tsx` (button visibility conditions), and `components/territories/LendModal.tsx` (rewritten to mirror `TransferModal.tsx`'s origin-picker structure).

**Tech Stack:** Next.js 14, TypeScript, React, Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-21-lend-flow-unification-design.md`

---

### Task 1: `app/map/page.tsx` — add `relationLoading` state and rewire lend/attack

**Files:**
- Modify: `app/map/page.tsx`

- [ ] **Step 1:** Add `const [relationLoading, setRelationLoading] = useState(false)` next to the existing `ownerInfoLoading` state declaration (around line 100).

- [ ] **Step 2:** In the tile-selection handler (the function containing `setRelationState(null)` around line 340), add `setRelationState(null)` sibling resets:
  ```ts
  setRelationState(null)
  setRelationLoading(shouldLoadOwnerInfo)
  ```
  Note `shouldLoadOwnerInfo` is computed a few lines below today — move its computation (`const shouldLoadOwnerInfo = Boolean(tile.owner_id && tile.owner_id !== user?.id)`) up so it's available for both `setRelationLoading` and the existing `setOwnerInfoLoading` calls, and the `if (shouldLoadOwnerInfo && tile.owner_id) { ... } else { setOwnerInfoLoading(false) }` block. In the `else` branch also call `setRelationLoading(false)`.

- [ ] **Step 3:** In the `getRelation(tile.owner_id).then(...)` callback, after the existing staleness check (`if (selectionRequestIdRef.current !== requestId) return`), add `setRelationLoading(false)` before/alongside the existing `setRelationState(...)` call.

- [ ] **Step 4:** Pass `relationLoading={relationLoading}` as a new prop on `<GarrisonModal ... />` (the JSX block around line 545), alongside the existing `relationState={relationState}` prop.

- [ ] **Step 5:** Change the `LendModal` JSX (around line 619):
  ```tsx
  {selectedTile && showLendModal && (
    <LendModal
      destinationTerritory={selectedTile}
      myPlayerId={user?.id ?? null}
      onClose={() => setShowLendModal(false)}
      onLent={() => {
        setShowLendModal(false)
        loadViewport(centerX, centerY, viewSize)
        setMovementsRefreshKey((k) => k + 1)
      }}
    />
  )}
  ```
  (drop the `instances={garrison}` prop — no longer used by `LendModal`).

- [ ] **Step 6:** Run `npx tsc --noEmit` — expect errors only from `LendModal`'s prop mismatch (fixed in Task 3) and `GarrisonModal`'s not-yet-added `relationLoading` prop (fixed in Task 2). If `app/map/page.tsx` itself has no other new errors, this step is done; move on.

---

### Task 2: `components/territories/GarrisonModal.tsx` — button visibility

**Files:**
- Modify: `components/territories/GarrisonModal.tsx`
- Test: `components/territories/GarrisonModal.test.tsx`

- [ ] **Step 1:** Add `relationLoading?: boolean` to `GarrisonModalProps` (next to the existing `relationState?: DiplomacyRelationState | null` field), and destructure it in the component's props (next to `relationState`).

- [ ] **Step 2:** Update the `canAttack` and add `canLend` right after it (around line 171):
  ```ts
  const canAttack =
    Boolean(myPlayerId) &&
    territory.owner_id !== myPlayerId &&
    territory.claim_locked_by !== myPlayerId &&
    !territory.battle_locked_by &&
    !relationLoading &&
    relationState !== 'coalition'
  const canLend =
    Boolean(myPlayerId) &&
    territory.owner_id !== myPlayerId &&
    relationState === 'coalition'
  ```

- [ ] **Step 3:** In the button row (around line 272-290), remove the existing `{canTransfer && onLend && (...)}` block ("Půjčit vojska" on your own territory) and add a new block using `canLend`, styled/labelled like the existing "Přesunout vojska" button but calling `onLend`:
  ```tsx
  {canLend && onLend && (
    <button
      type="button"
      onClick={onLend}
      className="rounded bg-sky-700 hover:bg-sky-600 px-3 py-1 text-sm font-semibold text-white"
    >
      Poslat vojska na pomoc
    </button>
  )}
  ```
  Place it near the `canAttack && onAttack` button (both are now "not-my-territory" actions), not next to `canTransfer`.

- [ ] **Step 4:** Update `components/territories/GarrisonModal.test.tsx`:
  - The existing test `"shows the transfer button for the viewer's own territory and wires it correctly"` (around line 175) currently also asserts a "Půjčit vojska" button appears there — remove the lend-button assertions from that test (own territory no longer shows a lend button); keep the transfer-button assertions.
  - Add a new test: for a territory owned by someone else with `relationState="coalition"` and `relationLoading={false}`, the "Poslat vojska na pomoc" button appears, calls `onLend` when clicked, and the "Zaútočit" button is absent.
  - Add a new test: for that same non-owned territory with `relationState="war"` (or `null`) and `relationLoading={false}`, the "Zaútočit" button appears and "Poslat vojska na pomoc" is absent.
  - Add a new test: with `relationLoading={true}` and `relationState={null}` on a non-owned territory, neither "Zaútočit" nor "Poslat vojska na pomoc" appears (no flash while relation is still loading).
  - Add a new test: a non-owned territory with `territory.battle_locked_by` set and `relationState="coalition"` still shows "Poslat vojska na pomoc" (lending must work while an ally is under incoming attack, unlike attack/transfer which are battle-locked).

- [ ] **Step 5:** Run `npx jest components/territories/GarrisonModal.test.tsx` — expect all tests to pass.

- [ ] **Step 6:** Commit:
  ```bash
  git add components/territories/GarrisonModal.tsx components/territories/GarrisonModal.test.tsx
  git commit -m "feat: gate lend/attack buttons on coalition relation in GarrisonModal"
  ```

---

### Task 3: `components/territories/LendModal.tsx` — rewrite to mirror `TransferModal`

**Files:**
- Modify: `components/territories/LendModal.tsx`
- Test: `components/territories/LendModal.test.tsx`
- Reference: `components/territories/TransferModal.tsx` (the pattern being mirrored — same origin-picker UX, same card-grid, same zoom overlay)

- [ ] **Step 1:** Change `LendModalProps`: replace `originTerritory: Territory` with `destinationTerritory: Territory`, and remove the `instances: CardInstanceWithTemplate[] | null` field entirely.

- [ ] **Step 2:** Replace the "load all coalition members' territories as destination options" effect (the `getMyCoalition()` + per-member `getMyTerritories()` block, roughly lines 65-107) with an origin-picker effect mirroring `TransferModal.tsx`:
  ```ts
  const [myTerritories, setMyTerritories] = useState<MyTerritory[] | null>(null)
  const [territoriesError, setTerritoriesError] = useState<string | null>(null)
  const [originTerritoryId, setOriginTerritoryId] = useState('')
  const [originInstances, setOriginInstances] = useState<CardInstanceWithTemplate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const loadRequestIdRef = useRef(0)

  useEffect(() => {
    if (!myPlayerId) return
    let cancelled = false
    getMyTerritories(myPlayerId).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        setTerritoriesError(error.message)
        return
      }
      setMyTerritories(data ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [myPlayerId])

  async function handleLoadOrigin(originId: number) {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setLoading(true)
    setLoadError(null)
    setOriginInstances(null)
    setSelectedInstanceIds([])
    const { data, error } = await getCardInstancesAtTerritory(originId)
    if (loadRequestIdRef.current !== requestId) return
    setLoading(false)
    if (error) {
      setLoadError(error.message)
      return
    }
    const eligible = (data ?? []).filter((ci) => {
      if (ci.owner_id !== myPlayerId || ci.status !== 'stationed' || ci.loaned_from_id || !ci.card_templates) return false
      return Boolean(toUnitTemplate(ci.card_templates))
    })
    setOriginInstances(eligible)
  }

  function handleSelectOrigin(value: string) {
    setOriginTerritoryId(value)
    const originId = Number(value)
    if (value && Number.isFinite(originId)) {
      handleLoadOrigin(originId)
    } else {
      loadRequestIdRef.current += 1
      setLoading(false)
      setLoadError(null)
      setOriginInstances(null)
      setSelectedInstanceIds([])
    }
  }
  ```
  Note the `!ci.loaned_from_id` filter is kept from the current `eligibleInstances` filter (a loaned-out card at an origin territory must not be re-lent).
  Import `getMyTerritories`, `getCardInstancesAtTerritory`, and `MyTerritory` from `@/lib/territories/api` (drop the now-unused `getMyCoalition` import from `@/lib/diplomacy/api` and the now-unused `getPlayerPublicInfo`-for-destination lookups — keep `getPlayerPublicInfo` only if still used for `playerNation`, which it is).

- [ ] **Step 3:** Remove the `eligibleInstances` memo (it read from the removed `instances` prop) — `originInstances` (state, already filtered in Step 2) replaces it everywhere it was used below.

- [ ] **Step 4:** Update `etaText` to use `chebyshevDistance(originTerritory, destinationTerritory)` where `originTerritory` is now `myTerritories?.find((t) => t.id === Number(originTerritoryId)) ?? null` (a local derived const, same pattern as `TransferModal`'s `originTerritory` derivation), and `groupSpeed` computed from `originInstances` + `selectedInstanceIds` (mirror `TransferModal`'s `groupSpeed` memo). Guard on `!originTerritory` returning `null` first.

- [ ] **Step 5:** Update `handleSubmit` to call `lendTroops(destinationTerritory.id, selectedInstanceIds, parsedDuration)` (destination is now fixed from props, not a selected dropdown value); keep the existing duration-parsing/validation and `setSubmitError`/`onLent?.()` handling.

- [ ] **Step 6:** Update the JSX:
  - Heading: `Poslat vojska na pomoc — {destinationTerritory.name ? \`${destinationTerritory.name} \` : ''}({destinationTerritory.x}, {destinationTerritory.y})`.
  - Replace the "Kam půjčuješ" destination `<select>` with an "Odkud posíláš" origin `<select>` mirroring `TransferModal`'s exactly (same `aria-label`, same `disabled={myTerritories === null}`, same options rendering `t.is_home ? 'Domov' : 'Území'} ({t.x}, {t.y})`, calling `handleSelectOrigin` on change).
  - Keep the duration-hours input and ETA text as-is (just reading from the new `originTerritory`/`destinationTerritory` names).
  - Replace `loadingDestinations`/`destinationTerritories.length === 0` messaging with `territoriesError`/`loadError`/`loading` messaging mirroring `TransferModal`'s (`"Načítám vojska…"`, `"Na tomto území nemáš žádná dostupná vojska."` when `originInstances !== null && originInstances.length === 0`).
  - Card grid: same structure as today, just iterating `originInstances` instead of `eligibleInstances`; keep `data-testid="lend-card-select-..."` prefix (don't rename to `transfer-card-select-...`, tests reference `lend-card-select-`).
  - Submit button: `disabled={submitting || !originTerritoryId || selectedInstanceIds.length === 0 || !durationHours.trim()}`; label unchanged (`Půjčuji vojska…` / `` `Půjčit vojska (${selectedInstanceIds.length})` ``) — this button-label text can stay as-is since it names the action ("lend"), only the heading changes to destination-first framing.

- [ ] **Step 7:** Update `components/territories/LendModal.test.tsx`: change all `originTerritory` props to `destinationTerritory`, remove `instances` props, and mock `getMyTerritories`/`getCardInstancesAtTerritory` (mirroring `TransferModal.test.tsx`'s mocking approach) instead of `getMyCoalition`. Update any assertions that referenced "Kam půjčuješ" to "Odkud posíláš", and any that asserted the old coalition-members-as-destinations behavior.

- [ ] **Step 8:** Run `npx tsc --noEmit` — expect zero errors across all three modified files.

- [ ] **Step 9:** Run `npx jest components/territories/LendModal.test.tsx` — expect all tests to pass.

- [ ] **Step 10:** Commit:
  ```bash
  git add components/territories/LendModal.tsx components/territories/LendModal.test.tsx app/map/page.tsx
  git commit -m "feat: unify lend-troops flow with attack/transfer (destination-first)"
  ```

---

### Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1:** Run `npx tsc --noEmit` — expect zero errors.
- [ ] **Step 2:** Run `npx jest --silent` (full suite) — expect all suites to pass. If `app/catalog/page.test.tsx` fails under full-suite parallelism, re-run once in isolation (`npx jest app/catalog/page.test.tsx`) to confirm it's the known pre-existing flaky timing test, unrelated to this change.
- [ ] **Step 3:** Update `docs/superpowers/PROGRESS.md` with a short entry describing the change (destination-first lend flow, files touched, test counts).
- [ ] **Step 4:** Commit the PROGRESS.md update.

---

## Out of scope (per spec)

- No backend/RPC/migration changes.
- No change to `MyLoansPanel` or the recall flow.
- `declare_attack`'s server-side coalition-ally enforcement is unchanged; only the client-side `canAttack` button visibility changes in Task 2.
