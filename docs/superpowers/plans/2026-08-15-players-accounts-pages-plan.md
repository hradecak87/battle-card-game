# Players & Accounts — Pages Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-designed, already-tested data/logic layer
(`lib/players/*`, `supabase/migrations/0001_players.sql`, both from the
prior plan) up to real pages, now that a Supabase project exists and its
migration has been applied and verified (REST `select` on `players` returns
`200 []`).

**Architecture:** A single browser Supabase client
(`lib/supabase/client.ts`) reads `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.local` (already present, not
committed). Each page is a client component (`'use client'`, consistent
with `/arena`) that calls `supabase.auth.*` or `supabase.rpc(...)` directly
— no custom API routes needed, since Supabase's client SDK + RLS + RPCs
(spec §2.2) are the whole backend. A small shared `useSession` hook exposes
the current user + their `players` row to any page that needs it (profile,
onboarding, leaderboard "is this me" highlighting, nav bar).

**Tech Stack:** Next.js App Router client components, `@supabase/supabase-js`
(already installed), Tailwind (existing dark zinc theme), Jest + RTL for
component-level tests (mocking the Supabase client, per spec §8 — auth
flows themselves are manually verified in the browser).

---

## Chunk 1: Client setup + auth pages

### Task 1: Supabase browser client

**Files:**
- Create: `lib/supabase/client.ts`

- [ ] Export a singleton `supabase` client created with
      `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)`.
- [ ] Run `npx tsc --noEmit` — expect clean.
- [ ] Commit: `feat: add Supabase browser client`

### Task 2: useSession hook

**Files:**
- Create: `lib/supabase/useSession.ts`

- [ ] Implement a hook returning `{ user, player, loading }`: subscribes to
      `supabase.auth.onAuthStateChange`, and when a user is present, fetches
      their `players` row (`select * from players where id = user.id`).
- [ ] Run `npx tsc --noEmit` — expect clean.
- [ ] Commit: `feat: add useSession hook for current user + player row`

### Task 3: /register page

**Files:**
- Create: `app/register/page.tsx`

- [ ] Form: email, password, display name, nation (`<select>` populated
      from `NATIONS`, each option showing its perk text). On submit, calls
      `supabase.auth.signUp` with `options.data = { display_name, nation }`
      (read by the `handle_new_user()` trigger, spec §2.1).
- [ ] On success, show "zkontroluj svůj e-mail" screen (spec §7 — email
      confirmation required before login). On error (e.g. duplicate
      display name bubbling up from the trigger), show the message inline.
- [ ] Run `npx tsc --noEmit` — expect clean.
- [ ] Commit: `feat: add /register page`

### Task 4: /login page

**Files:**
- Create: `app/login/page.tsx`

- [ ] Form: email + password, calls `supabase.auth.signInWithPassword`.
      Link to `/reset-password`. On an "email not confirmed" error, show a
      "potvrď prosím e-mail" message with a "poslat znovu" button calling
      `supabase.auth.resend({ type: 'signup', email })`.
- [ ] On success, redirect to `/profile/me` (which itself redirects to
      `/onboarding/kingdom` if `onboarding_completed` is false).
- [ ] Run `npx tsc --noEmit` — expect clean.
- [ ] Commit: `feat: add /login page`

### Task 5: /reset-password page

**Files:**
- Create: `app/reset-password/page.tsx`

- [ ] Two modes on the same route: (a) no session — email input, calls
      `supabase.auth.resetPasswordForEmail(email, { redirectTo: <this page's URL> })`;
      (b) arrived via the emailed link (Supabase sets a recovery session) —
      new-password input, calls `supabase.auth.updateUser({ password })`,
      then redirects to `/login`.
- [ ] Run `npx tsc --noEmit` — expect clean.
- [ ] Commit: `feat: add /reset-password page`

---

## Chunk 2: Onboarding, profile, leaderboard

### Task 6: /onboarding/kingdom page

**Files:**
- Create: `app/onboarding/kingdom/page.tsx`
- Test: `app/onboarding/kingdom/page.test.tsx`

- [ ] Write a component test (mocking `lib/supabase/client`): renders the
      kingdom-name input and all `COATS_OF_ARMS` as selectable tiles; picking
      one highlights it.
- [ ] Implement: kingdom-name input (3-30 chars) + coat-of-arms gallery
      grid (each tile renders its `Svg`); submit calls
      `supabase.rpc('complete_kingdom_onboarding', { new_kingdom_name, new_coat_of_arms_id })`;
      show the "already taken" error inline on failure; redirect to
      `/profile/me` on success.
- [ ] Run `npx jest app/onboarding` — expect PASS.
- [ ] Commit: `feat: add kingdom onboarding page`

### Task 7: /profile/me page

**Files:**
- Create: `app/profile/me/page.tsx`
- Test: `app/profile/me/page.test.tsx`

- [ ] Write a component test (mocking the session hook): renders level/XP
      progress bar, nation + perk text, kingdom name + coat of arms, and the
      three activity stats.
- [ ] Implement using `useSession`: redirect to `/login` if no user,
      redirect to `/onboarding/kingdom` if `!onboarding_completed`. Shows
      `levelForXp`/`xpRequiredForLevel` progress, nation perk text from
      `NATIONS`, editable kingdom name/coat-of-arms (calls `update_kingdom`),
      online badge (`last_seen_at` within 2 min), account age, total
      playtime.
- [ ] Run `npx jest app/profile/me` — expect PASS.
- [ ] Commit: `feat: add /profile/me page`

### Task 8: /profile/[id] page

**Files:**
- Create: `app/profile/[id]/page.tsx`
- Test: `app/profile/[id]/page.test.tsx`

- [ ] Write a component test (mocking Supabase client): fetches and renders
      a given player id's public fields, no edit controls.
- [ ] Implement: same display fields as `/profile/me` minus edit controls,
      fetched via `supabase.from('players').select('*').eq('id', id).single()`.
- [ ] Run `npx jest app/profile/[id]` — expect PASS.
- [ ] Commit: `feat: add public /profile/[id] page`

### Task 9: /leaderboard page

**Files:**
- Create: `app/leaderboard/page.tsx`
- Test: `app/leaderboard/page.test.tsx`

- [ ] Write a component test (mocking Supabase client): renders a mocked
      list of players sorted by level then XP, with rank numbers and links.
- [ ] Implement: `supabase.from('players').select('*').eq('onboarding_completed', true)`,
      sort client-side by `levelForXp(xp)` then raw `xp` descending, render
      rank/name/nation/level/xp + link to `/profile/[id]`.
- [ ] Run `npx jest app/leaderboard` — expect PASS.
- [ ] Commit: `feat: add /leaderboard page`

### Task 10: Heartbeat + nav wiring

**Files:**
- Create: `components/players/HeartbeatBeacon.tsx`
- Modify: `app/layout.tsx`, `app/page.tsx`

- [ ] `HeartbeatBeacon` (client component): if `useSession` has a user,
      calls `supabase.rpc('heartbeat')` on mount and every 30s
      (`setInterval`, cleared on unmount).
- [ ] Add `<HeartbeatBeacon />` to the root layout (renders nothing visible,
      always mounted).
- [ ] Add nav links from the home page to `/login`, `/register`,
      `/profile/me`, `/leaderboard` (simple conditional: show login/register
      if logged out, profile/leaderboard if logged in, via `useSession`).
- [ ] Run `npx tsc --noEmit` and `npx jest` (full suite) — expect all green.
- [ ] Run `npm run build` — expect clean, all routes listed.
- [ ] Commit: `feat: wire presence heartbeat and navigation into layout`

---

## Manual verification (after Chunk 2, in the real browser)

Per spec §8, auth flows can't be meaningfully unit-tested against a real
Supabase project — after all automated tasks pass, manually verify once in
the browser:
1. Register a real account → check the confirmation email arrives → click
   it → log in.
2. Complete kingdom onboarding (name + coat of arms) → land on
   `/profile/me` showing it.
3. Visit `/leaderboard` → see the new player listed.
4. Open `/profile/[id]` for that same id in an incognito tab (logged out)
   → confirm it's viewable without a session.
5. Trigger `/reset-password` once, confirm the emailed link works.
