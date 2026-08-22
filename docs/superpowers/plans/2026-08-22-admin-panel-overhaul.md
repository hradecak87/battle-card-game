# Admin Panel Overhaul Implementation Plan

> **For agentic workers:** Implement task by task. Run `npx tsc --noEmit` and the relevant `npx jest` suites after each task. Commit after each task passes. For the SQL task, apply and live-verify the migration against `SUPABASE_DB_URL` from `.env.local` (temp `.js` script + `pg` client, per established project convention) before committing.

**Goal:** Make the `/admin` page collapsible, replace the flat card list with a compact thumbnail grid, and add an admin-only "Přesuny a zabírání území" monitoring/speed-up section while removing the player-facing test speed-up button.

**Architecture:** Three independent frontend/backend slices built on top of the existing `/admin` page and `troop_movements` schema. See spec: `docs/superpowers/specs/2026-08-22-admin-panel-overhaul-design.md` (read it in full before starting — it has the exact data shapes, RPC signatures, and rationale for every decision here).

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres, `security definer` RPCs), Jest + Testing Library.

---

## Task 1: Collapsible sections

**Files:**
- Create: `components/admin/CollapsibleSection.tsx`
- Create: `components/admin/CollapsibleSection.test.tsx`
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Write `CollapsibleSection.test.tsx`**
  Tests: renders `title`/`description`; children hidden when collapsed (not in the document, not just visually hidden — use conditional rendering so this is a real assertion); starts collapsed by default; clicking the header button toggles `aria-expanded` and shows/hides children; a `defaultOpen` prop can override the default.

- [ ] **Step 2: Run it, confirm it fails** (component doesn't exist yet).

- [ ] **Step 3: Implement `CollapsibleSection.tsx`**
  ```tsx
  'use client'
  import { useState, type ReactNode } from 'react'

  interface CollapsibleSectionProps {
    title: string
    description?: string
    defaultOpen?: boolean
    children: ReactNode
  }

  export function CollapsibleSection({ title, description, defaultOpen = false, children }: CollapsibleSectionProps) {
    const [open, setOpen] = useState(defaultOpen)
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            {description && <p className="text-sm text-zinc-400">{description}</p>}
          </div>
          <span aria-hidden="true" className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}>
            ▾
          </span>
        </button>
        {open && <div className="mt-4">{children}</div>}
      </section>
    )
  }
  ```

- [ ] **Step 4: Run test, confirm it passes.**

- [ ] **Step 5: Wire into `app/admin/page.tsx`**
  Replace each of the four existing `<section className="rounded-2xl border ...">...</section>` blocks (Online hráči, Aktivní bitvy, Správa karet, Správa XP) with `<CollapsibleSection title="..." description="...">...</CollapsibleSection>`, moving the existing header `<h2>`/`<p>` text into the new `title`/`description` props and keeping everything else (tables, forms) as children, unchanged. For the `grid gap-6 lg:grid-cols-[1.3fr_0.9fr]` two-column block, wrap the "Správa karet" half and the "Správa XP" half each in their own `CollapsibleSection` (so the surrounding grid div stays, just its two children become collapsible independently). Do not change any data-fetching `useEffect` — they must keep running regardless of collapsed state.

- [ ] **Step 6: Update `app/admin/page.test.tsx`**
  Existing tests likely assert on visible text (e.g. table headers) that is now hidden behind a collapsed section. Update those tests to first click the relevant section's toggle button (query by the section title's accessible name) before asserting on content within it.

- [ ] **Step 7: Run `npx jest app/admin` and `npx tsc --noEmit`, confirm both clean.**

- [ ] **Step 8: Commit**
  ```bash
  git add components/admin/CollapsibleSection.tsx components/admin/CollapsibleSection.test.tsx app/admin/page.tsx app/admin/page.test.tsx
  git commit -m "Make admin dashboard sections collapsible"
  ```

---

## Task 2: Card thumbnail grid + wall category fix

**Files:**
- Modify: `lib/admin/api.ts` (`AdminPlayerCardRow.template_category` type)
- Modify: `app/admin/page.tsx` (`CATEGORY_LABELS`)
- Create: `components/admin/AdminCardThumbnail.tsx`
- Create: `components/admin/AdminCardThumbnail.test.tsx`
- Modify: `app/admin/page.tsx` (card grid + zoom modal)
- Modify: `app/admin/page.test.tsx`

- [ ] **Step 1: Extend `template_category` type and labels**
  In `lib/admin/api.ts`, change `AdminPlayerCardRow['template_category']` and `AdminCardTemplateOption['category']` from `'unit' | 'castle' | 'village' | 'boost'` to `'unit' | 'castle' | 'village' | 'wall' | 'boost'`. In `app/admin/page.tsx`, add `wall: 'Hradby'` to `CATEGORY_LABELS`, and add `'wall'` to the `(['unit', 'castle', 'village', 'boost'] as const)` array used when building the card-template `<select>` options.

- [ ] **Step 2: Verify the RPC actually returns `wall` category rows**
  Run a quick read-only check against the live DB (temp `.js` script, per project convention) confirming `admin_list_player_cards`/the underlying query doesn't filter out `category = 'wall'` card instances. If it does filter, fix the SQL function definition in a small new migration (`NNNN_admin_list_player_cards_wall_fix.sql`) and live-verify before proceeding. Skip this step's migration if the function already has no category filter (likely — check first with `pg_get_functiondef`).

- [ ] **Step 3: Write `AdminCardThumbnail.test.tsx`**
  Tests: renders name, rank label, category label for each of the 5 categories; applies `RANK_FRAME[rank].border` class; renders in a larger/expanded visual mode when a prop like `size="lg"` is passed (used by the zoom modal) — assert via a distinguishing class or data attribute, not exact pixel values.

- [ ] **Step 4: Run it, confirm it fails.**

- [ ] **Step 5: Implement `AdminCardThumbnail.tsx`**
  Import `RANK_FRAME` from `@/components/cards/TradingCard`. Props: `name: string`, `rank: string` (one of the 5 ranks), `category: 'unit'|'castle'|'village'|'wall'|'boost'`, `size?: 'sm' | 'lg'` (default `'sm'`). Render a bordered box (`border-2 ${RANK_FRAME[rank].border}`, rounded, `aspect-[5/7]`) containing: a small category label/icon at the top, the card name centered, and the rank label at the bottom. `size="lg"` just scales up padding/font-size classes — no new data needed.

- [ ] **Step 6: Run test, confirm it passes.**

- [ ] **Step 7: Replace the card list in `app/admin/page.tsx`**
  Replace the `<ul className="mt-4 flex flex-col gap-3">` block under "Karty vybraného hráče" with:
  - A `div` capped at ~3 rows tall (`max-h-[560px] overflow-y-auto`) containing a `grid grid-cols-3 gap-3` of cells.
  - Each cell: relatively positioned wrapper around `<AdminCardThumbnail name={...} rank={...} category={...} />`, with an absolutely-positioned `×` button top-left (`aria-label="Odebrat kartu {name}"`, calls existing `handleRemoveCard(card)` unchanged) and an absolutely-positioned `🔍` button top-right (`aria-label="Zvětšit kartu {name}"`) that sets a new `zoomedCard` state to that card.
  - Below each thumbnail: the existing small caption line (`{rankLabel(card.template_rank)} · {card.template_category} · {territoryLabel(card)} · {card.status}`).
  - A new conditional modal block (rendered when `zoomedCard` is set): a fixed full-screen overlay (`fixed inset-0 bg-black/70 flex items-center justify-center z-50`, click-outside-to-close, an explicit close `×` button) containing `<AdminCardThumbnail ... size="lg" />` plus the same caption text, larger.

- [ ] **Step 8: Update `app/admin/page.test.tsx`**
  Add tests: card grid renders 3-per-row thumbnails; clicking a thumbnail's `×` still triggers the existing remove flow (same assertions as before, just querying the new button); clicking `🔍` opens the zoom modal showing the card's name; closing the modal (close button or backdrop click) removes it from the document.

- [ ] **Step 9: Run `npx jest app/admin components/admin` and `npx tsc --noEmit`, confirm clean.**

- [ ] **Step 10: Commit**
  ```bash
  git add lib/admin/api.ts app/admin/page.tsx app/admin/page.test.tsx components/admin/AdminCardThumbnail.tsx components/admin/AdminCardThumbnail.test.tsx
  git commit -m "Replace admin player-card list with a compact thumbnail grid"
  ```

---

## Task 3: "Přesuny a zabírání území" admin section + admin-only speed-up

**Files:**
- Create: `supabase/migrations/NNNN_admin_movements_monitor.sql` (next free number after the latest existing migration)
- Create: `supabase/migrations/NNNN_admin_movements_monitor.verification.sql`
- Modify: `lib/admin/api.ts`
- Create: `components/admin/AdminMovementsPanel.tsx`
- Create: `components/admin/AdminMovementsPanel.test.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `components/territories/MyMovementsPanel.tsx`
- Modify: `components/territories/MyMovementsPanel.test.tsx`
- Modify: `lib/territories/api.ts`

- [ ] **Step 1: Check the next free migration number**
  `ls supabase/migrations | sort` and use the next integer after the highest existing prefix (currently `0078`, so this is `0079`).

- [ ] **Step 2: Write the migration** (`0079_admin_movements_monitor.sql`)
  Per spec §3:
  1. `create or replace function admin_list_movements(p_include_history boolean default false) returns table (...)` — `security definer`; first line `perform admin_require_admin();` then `perform resolve_due_movements();`; select from `troop_movements m` joined to `players pl on pl.id = m.player_id`, `territories o on o.id = m.origin_territory_id`, `territories d on d.id = m.destination_territory_id`, and a `lateral`/subquery count of `troop_movement_units` per movement; `where p_include_history or m.status in ('in_transit','occupying')`; order active rows first by soonest ETA, then history by `started_at desc`; `limit 200`. Return columns exactly as listed in the spec's SQL block (§3 Data source).
  2. `create or replace function admin_speed_up_movement(p_movement_id uuid) returns void` — `security definer`; first line `perform admin_require_admin();`; then the same branching logic as `debug_speed_up_movement` (`0006_debug_speed_up_movement.sql`) but selecting the movement by id only (no `player_id = auth.uid()` check); call `resolve_due_movements()` at the end.
  3. `revoke execute ... from public, anon, authenticated; grant execute ... to authenticated;` (both new functions need to be callable by authenticated admins — check how other `admin_*` RPCs grant execute in `0012_admin_dashboard.sql` and mirror that exactly).
  4. Drop the old RPC: `revoke execute on function debug_speed_up_movement(uuid) from public, anon, authenticated; drop function if exists debug_speed_up_movement(uuid);`

- [ ] **Step 3: Write the verification script** (`0079_admin_movements_monitor.verification.sql`)
  Wrapped in a transaction that rolls back at the end (per project convention). Assert: both new functions exist (`to_regprocedure(...)`); `debug_speed_up_movement(uuid)` no longer exists; a non-admin caller (`admin_require_admin()` raises) is rejected — reuse whatever pattern `0012_admin_dashboard.sql`'s verification script uses to simulate a non-admin/admin caller; a happy-path call to `admin_list_movements()` on seeded test data returns the expected row shape and respects `p_include_history`; a call to `admin_speed_up_movement` on a movement not owned by the caller still succeeds (proving the ownership check was removed) and shrinks the right timestamp.

- [ ] **Step 4: Apply + live-verify the migration**
  Use the established temp-`.js` + `pg` + `SUPABASE_DB_URL` technique (manually parsed from `.env.local`, not the raw connection string) to apply the migration SQL and run the verification script (in a rolled-back transaction) against the live Supabase DB. Delete the temp script afterward.

- [ ] **Step 5: Add `lib/admin/api.ts` wrappers**
  ```ts
  export interface AdminMovementRow {
    id: string
    player_id: string
    player_display_name: string
    player_is_npc: boolean
    kind: 'transfer' | 'claim' | 'attack' | 'loan' | 'loan_return'
    origin_territory_id: number
    origin_x: number
    origin_y: number
    destination_territory_id: number
    destination_x: number
    destination_y: number
    started_at: string
    transfer_arrives_at: string
    status: 'in_transit' | 'occupying' | 'completed' | 'cancelled'
    claim_occupation_completes_at: string | null
    cancelled_at: string | null
    unit_count: number
  }

  export async function getAdminMovements(includeHistory: boolean) {
    return supabase.rpc('admin_list_movements', { p_include_history: includeHistory }) as unknown as Promise<{
      data: AdminMovementRow[] | null
      error: { message: string } | null
    }>
  }

  export async function adminSpeedUpMovement(movementId: string) {
    return supabase.rpc('admin_speed_up_movement', { p_movement_id: movementId }) as unknown as Promise<{
      data: null
      error: { message: string } | null
    }>
  }
  ```

- [ ] **Step 6: Write `AdminMovementsPanel.test.tsx`**
  Tests: renders a row per movement with player name, NPC badge when `player_is_npc`, kind label, origin→destination, status, ETA, unit count; the Vše/Jen NPC/Jen hráči toggle filters rows client-side; the player-name search input filters rows client-side (case-insensitive substring); toggling "Zobrazit i dokončené/zrušené" calls `getAdminMovements` again with `includeHistory: true`; clicking the ⏩ speed-up icon on an active row calls `adminSpeedUpMovement(id)` and refetches the list; the speed-up icon is absent for `completed`/`cancelled` rows.

- [ ] **Step 7: Run it, confirm it fails.**

- [ ] **Step 8: Implement `AdminMovementsPanel.tsx`**
  Follow the existing admin-page data-fetching pattern (local `useState`/`useEffect` calling the new API function on mount and on `includeHistory` change). Kind label map: `{ transfer: 'Přesun', claim: 'Zabírání', attack: 'Útok', loan: 'Půjčka', loan_return: 'Vrácení půjčky' }`. Status/ETA formatting: reuse whatever relative-time helper `MyMovementsPanel.tsx` already uses (check its imports first — likely a local helper or a shared one in `lib/`) rather than writing a new one; for `occupying` + `kind === 'claim'` rows, compute ETA from `claim_occupation_completes_at` instead of `transfer_arrives_at`. Filter/search state is local `useState`; NPC toggle and search text are applied via `.filter()` over the fetched array, memoized with `useMemo`.

- [ ] **Step 9: Run test, confirm it passes.**

- [ ] **Step 10: Wire into `app/admin/page.tsx`**
  Add a fifth `<CollapsibleSection title="Přesuny a zabírání území" description="...">` at the end of the page containing `<AdminMovementsPanel />`.

- [ ] **Step 11: Remove the player-facing speed-up button**
  In `components/territories/MyMovementsPanel.tsx`: delete the `debugSpeedUpMovement` import, the handler that calls it, and the "⏩ 10s (test)" button JSX. In `lib/territories/api.ts`: delete the `debugSpeedUpMovement` export. In `components/territories/MyMovementsPanel.test.tsx`: remove/update the test(s) that exercise this button (the one described in the session history: "button click → `debugSpeedUpMovement` called ... → list refetched").

- [ ] **Step 12: Run the full relevant suite + typecheck**
  `npx jest app/admin components/admin components/territories/MyMovementsPanel` and `npx tsc --noEmit`; also `npm run build` once at the end of this task given it touches a migration + several files, to catch anything the targeted suites miss.

- [ ] **Step 13: Commit**
  ```bash
  git add supabase/migrations/0079_admin_movements_monitor.sql supabase/migrations/0079_admin_movements_monitor.verification.sql lib/admin/api.ts components/admin/AdminMovementsPanel.tsx components/admin/AdminMovementsPanel.test.tsx app/admin/page.tsx components/territories/MyMovementsPanel.tsx components/territories/MyMovementsPanel.test.tsx lib/territories/api.ts
  git commit -m "Add admin movements monitor with admin-only speed-up; remove player-facing test speed-up button"
  ```

---

## Final check

- [ ] Update `docs/superpowers/PROGRESS.md` with a short entry summarizing what changed across all 3 tasks (per project convention — this file is the authoritative snapshot of implementation state).
- [ ] Report back: all 3 commits made, tests/typecheck/build status, and anything that deviated from this plan (e.g. if `admin_list_player_cards` needed a fix in Task 2 Step 2, or if the ETA-formatting helper in `MyMovementsPanel.tsx` wasn't reusable as expected).
