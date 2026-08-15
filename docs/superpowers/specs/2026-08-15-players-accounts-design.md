# Players & Accounts — Design Spec

## 1. Overview

This is subsystem #2 of a larger medieval card-battle web game (Battle Card
Game V2), building on subsystem #1 (Card Collection & Combat Core, already
implemented). This spec covers:

- Registration and login (email + password), email verification, password
  reset
- A permanent "nation" (medieval class) chosen at registration, defined here
  as **data only** — perks are not yet applied to any combat calculation
- A one-time "kingdom" onboarding step (unique kingdom name + coat-of-arms
  emblem, both editable later)
- XP, win/loss rewards, and a level curve derived from XP
- A pure "are these two players close enough in level to fight" rule, for
  later subsystems to call
- Player profile pages (own and others'), online/offline presence, activity
  stats, and a public leaderboard

Everything else from the original game pitch — the 256×256 territory map,
real-time multi-army battles (including actually applying nation perks to
combat), the card trading exchange, and notifications — remains out of scope
for this spec (see §9).

This is the **first subsystem that requires a real backend**. Subsystem #1
was pure client-side logic with no persistence; this spec introduces
[Supabase](https://supabase.com) (managed PostgreSQL + Auth) as the project's
backend, chosen over a hand-rolled Next.js API + Prisma setup because its
built-in auth (registration, email verification, password reset, and future
Google OAuth) covers most of this spec's auth requirements out of the box,
and its underlying Postgres database is equally well-suited to later
subsystems (territory map, army transfers) as a hand-rolled schema would be.

## 2. Data Model (Supabase Postgres)

`auth.users` is Supabase-managed (id, email, hashed password, email
verification state) and is not modified directly. A `players` table extends
it 1:1:

```sql
create table players (
  id uuid primary key references auth.users(id),
  display_name text not null unique,       -- public in-game nickname
  nation text not null,                     -- one of 6 fixed values, §3; permanent
  kingdom_name text unique,                 -- null until onboarding completed
  coat_of_arms_id text,                     -- null until onboarding completed
  onboarding_completed boolean not null default false,
  xp integer not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  total_playtime_seconds integer not null default 0
);
```

`level` is never stored — it is always **derived from `xp`** via the pure
function in §5, so it can never drift out of sync with the XP total that
produced it.

**Row-Level Security**: any authenticated (or anonymous, for the public
leaderboard) request may `select` any row; a user may `update` only the row
where `id = auth.uid()`. There is no `delete` policy (accounts are not
deletable in this MVP).

## 3. Nations (permanent, chosen at registration)

Six medieval nations, hand-authored to be heterogeneous: four map onto the
four combat stats from subsystem #1 (`str`/`lng`/`def`/`hp`), and two map onto
"civic" bonuses relevant to the future territory-map subsystem, so no single
axis of the game is dominated by nation choice alone.

| Nation | Perk | Effect (data only in this spec — see §3.1) |
|---|---|---|
| Anglické království | Tisové luky | +15% LNG in combat |
| Franská říše | Těžká rytířská jízda | +15% STR in combat |
| Svatá říše římská | Železná disciplína, plátové brnění | +15% DEF in combat |
| Byzantská říše | Bohatství, dlouhé posádky | +15% HP in combat |
| Mongolská horda | Rychlé jízdní kmeny | −25% troop transfer time between territories |
| Skandinávské království (Vikingové) | Bleskové nájezdy | −20% time to occupy an empty territory |

A nation is chosen once, during registration, and is **permanent** — there is
no UI or endpoint to change it afterward.

### 3.1 Explicitly out of scope here: perks are inert

This spec stores each player's `nation` and exposes the table above as static
reference data (e.g. `lib/players/nations.ts`), shown on the profile page.
**No calculation anywhere in this spec or in subsystem #1's `resolveDuel`
reads or applies a nation perk.** Wiring a perk into an actual combat/transfer
/occupation calculation is explicitly deferred to the subsystem(s) that own
those mechanics (#3 territory map, #4 multi-army battle) — this avoids
reopening subsystem #1's already-shipped, tested `combat.ts`.

## 4. Kingdom Onboarding (name + coat of arms)

Immediately after a player's **first** successful login (i.e. while
`onboarding_completed = false`), the app shows a one-time onboarding screen
(blocking further navigation until completed) prompting for:

- **Kingdom name** — free text, must be unique across all players (enforced
  by the `unique` constraint on `kingdom_name`; a duplicate submission shows
  an inline "already taken" error and re-prompts), 3-30 characters.
- **Coat of arms** — the player picks one emblem from a fixed gallery of
  **at least 20** hand-authored SVG designs (same hand-drawn vector-art style
  as subsystem #1's unit art — no image-generation tool is available in this
  environment either), stored as `lib/players/coats-of-arms.tsx`, referenced
  on the player by a stable `coat_of_arms_id` string.

Both the kingdom name and the coat of arms **can be changed later** from the
profile page (name changes still enforce uniqueness; there is no cooldown or
cost for changing either in this MVP — YAGNI, can be added later if it turns
out to matter).

## 5. XP, Levels, and Level-Proximity Matchmaking Rule

**XP awarded per resolved duel** (the mechanism that actually grants XP after
a duel — e.g. a hook in the future Battle subsystem — is out of scope here;
this section only defines the pure values/formulas):

- Win: **100 XP**
- Loss: **10 XP** (consolation, keeps losses from feeling like pure
  punishment)
- Underdog bonus: if the winner's level is lower than the loser's, the winner
  additionally gets **+10% of the base win XP per level of difference**,
  capped at **+100%** (i.e. beating someone 10+ levels higher doubles the
  base 100 XP to 200) — encourages fighting above your level instead of only
  farming easier opponents.
- Future challenges/quests are a separate, not-yet-designed XP source; the
  data model only needs `xp` to be a single incrementable integer, so no
  schema change will be needed when that's designed later.

**Level derivation** — cumulative XP required to *reach* level `L` (from the
start, level 1 = 0 XP):

```ts
function xpRequiredForLevel(level: number): number {
  return 100 * level * (level + 1) / 2
}
// level 1 = 0, level 2 = 100, level 3 = 300, level 10 = 5,500, level 20 = 21,000

function levelForXp(xp: number): number {
  let level = 1
  while (xp >= xpRequiredForLevel(level + 1)) level++
  return level
}
```

Both functions are pure and depend on nothing but their numeric input —
`lib/players/leveling.ts`.

**Level-proximity rule** (used by later subsystems to gate whether two
players may fight over a territory — not enforced anywhere in this spec's own
UI, since there's no battle UI yet):

```ts
const MAX_LEVEL_GAP = 3
function canPlayersFight(levelA: number, levelB: number): boolean {
  return Math.abs(levelA - levelB) <= MAX_LEVEL_GAP
}
```

`lib/players/matchmaking.ts`. Pure function, no I/O.

## 6. Online/Offline Presence and Activity Stats

- While a player has the app open in a browser tab, the client sends a
  lightweight "heartbeat" (updates `players.last_seen_at`) roughly every 30
  seconds.
- **Online** = `last_seen_at` within the last 2 minutes; **offline**
  otherwise. This is a derived display value (computed at read time from
  `last_seen_at`), not a stored boolean, so it can never go stale.
- **Total playtime**: on each login, the client starts a session timer; on
  logout (or heartbeat timeout / tab close, detected via the next heartbeat
  gap) the elapsed session duration is added to
  `players.total_playtime_seconds`. Exact reconciliation strategy (e.g.
  incrementing on each heartbeat by the heartbeat interval, vs. computing a
  session delta on explicit logout) is an implementation detail left to the
  plan — either satisfies "total time spent playing" from the design intent.
- The profile page's "activity" section (per earlier discussion) shows all
  three: account age (`created_at`), last-seen (`last_seen_at`, or "online"
  live badge), and total playtime.

## 7. Pages

- **`/register`**, **`/login`** — email + password forms (Supabase Auth);
  registration also collects the public `display_name`. Login is by email,
  not by `display_name` (§ discussion — simpler and more secure, delegated to
  Supabase). Email verification and "forgot password" flows are Supabase's
  built-in email-based flows, linked from the login page.
- **`/onboarding/kingdom`** — the one-time kingdom name + coat-of-arms setup
  from §4; redirected here automatically after first login until completed.
- **`/profile/me`** — own profile: display name, nation (+ its perk
  description, informational only per §3.1), kingdom name + coat of arms
  (both editable here), level + XP progress bar, online/offline badge, and
  the three activity stats from §6.
- **`/profile/[id]`** — read-only view of another player's profile (same
  fields as above, minus any edit controls).
- **`/leaderboard`** — all players ranked by level (ties broken by raw XP),
  showing rank, display name, nation, level, XP, and a link to `/profile/[id]`.

## 8. Testing Strategy

- **Pure logic — Jest unit tests** (no backend involved, same style as
  subsystem #1):
  - `leveling.ts`: `xpRequiredForLevel` / `levelForXp` for known values
    (level 1/2/3/10/20 boundaries, exact-boundary XP values).
  - `matchmaking.ts`: `canPlayersFight` for gaps of 0, 3, 4, and negative
    inputs (order shouldn't matter).
  - `nations.ts` / `coats-of-arms.tsx` data: exactly 6 nations with unique
    names, at least 20 coat-of-arms entries with unique IDs.
- **Auth flows (registration, login, email verification, password reset)
  cannot be meaningfully unit-tested** against a real hosted Supabase
  project — these are verified **manually in the browser** against a real
  (free-tier) Supabase project, the same way subsystem #1's demo pages were
  manually smoke-tested with `Invoke-WebRequest`/browser checks. This
  requires the user to provision a free Supabase project and provide its URL
  + anon key as environment variables before implementation begins.
- Light component tests (React Testing Library) for the onboarding form
  (duplicate-name validation message), the profile page (renders level/XP/
  activity fields), and the leaderboard (renders rows, links to profiles) —
  these can run against mocked Supabase client calls, consistent with how
  subsystem #1's page tests didn't need a real backend.

## 9. Out of Scope (future specs)

- Actually applying nation perks to any combat, transfer, or occupation
  calculation (§3.1) — belongs to subsystems #3/#4.
- Territory map, occupation timers, castles/villages, troop transfers.
- Multi-army RTS battle orchestration, and the XP-award trigger hook itself
  (this spec only defines the XP *amounts*, not *when* they're granted).
- Card trading/exchange, notifications.
- Google/OAuth login (mentioned as a "maybe later" — the data model doesn't
  need to change for it, since Supabase Auth handles multiple providers
  against the same `auth.users` row, but no OAuth provider is wired up now).
- Changing `nation` after registration (explicitly permanent, §3).
- Friend lists, private messaging, or any social feature beyond the public
  leaderboard and read-only profile viewing.
