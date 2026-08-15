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
create type nation_id as enum (
  'england', 'francia', 'hre', 'byzantium', 'mongol_horde', 'scandinavia'
);

create table players (
  id uuid primary key references auth.users(id),
  display_name text not null,               -- public in-game nickname
  nation nation_id not null,                -- one of 6 fixed values, §3; permanent
  kingdom_name text,                        -- null until onboarding completed
  coat_of_arms_id text,                     -- null until onboarding completed
  onboarding_completed boolean not null default false,
  xp integer not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  total_playtime_seconds integer not null default 0
);

create unique index players_display_name_lower_idx on players (lower(display_name));
create unique index players_kingdom_name_lower_idx on players (lower(kingdom_name))
  where kingdom_name is not null;
```

`nation` is a Postgres `enum` type rather than a free-text column specifically
so an invalid value is rejected by the database itself, not just by
application-level validation — this is what makes the "signup rolls back on
an invalid `nation`" claim in §2.1 actually true at the schema level.

`display_name` and `kingdom_name` uniqueness is case-insensitive: enforced via
the `unique` index on `lower(...)` shown above (not a plain `unique` column
constraint), so "Jan" and "jan" can't coexist as two different names. The
`kingdom_name` index is partial (`where kingdom_name is not null`) so that the
many players who haven't onboarded yet don't collide with each other on the
shared `null` value. Both names are additionally trimmed of leading/trailing
whitespace before validation/storage (so `"Jan "` and `"Jan"` also collide),
and `display_name` follows the same 3-30 character length rule as
`kingdom_name` (§4), enforced client-side and re-checked in the
`handle_new_user()` trigger (§2.1) since that's the only path that writes it.
`last_seen_at` defaults to `now()` at row creation (§2.1) and is never null —
a freshly-registered, never-yet-logged-in-again player simply shows their
registration moment as "last seen," which reads correctly as "just now."

`level` is never stored — it is always **derived from `xp`** via the pure
function in §5, so it can never drift out of sync with the XP total that
produced it.

### 2.1 Creating the `players` row (auth.users ↔ players sync)

Registration (`/register`, §7) collects email, password, `display_name`, and
`nation` together in one form submission. All four are passed to Supabase's
sign-up call, with `display_name` and `nation` included as auth user
metadata. A Postgres trigger on `auth.users` (`after insert`) runs a
`handle_new_user()` function that reads that metadata and inserts the
matching `players` row (`id`, `display_name`, `nation`; every other column
keeps its table default). This trigger runs in the same transaction as the
`auth.users` insert, so if it fails — most commonly a duplicate
`display_name`, or `nation` not being one of the 6 valid values — the entire
signup is rolled back and Supabase returns that error to the client, which
the `/register` form displays inline (e.g. "Toto jméno už je zabrané" for a
duplicate `display_name`). There is no scenario where an `auth.users` row
exists without a matching `players` row, or vice versa.

### 2.2 Row-Level Security and write boundaries

Any request — authenticated or anonymous — may `select` any row, all
columns: both the leaderboard and individual profiles (`/profile/[id]`, §7)
are intentionally public and viewable without logging in, so the anonymous
`select` grant is unrestricted, not narrowly scoped to just the leaderboard
query. **No direct client-side `update` privilege is granted on the table
at all** — `xp`, `last_seen_at`, `total_playtime_seconds`,
`onboarding_completed`, and `nation` (permanent, §3) must never be
client-writable, and giving blanket row-owner `update` access (as an earlier
draft of this spec did) would let a player edit their own XP directly, which
is unacceptable. Instead, all writes this spec actually needs go through
`security definer` Postgres RPC functions, each internally checking
`auth.uid() = id` before touching anything:

- `complete_kingdom_onboarding(kingdom_name, coat_of_arms_id)` — settable only
  while `onboarding_completed = false`; validates `coat_of_arms_id` against
  the fixed catalog (§4) before writing, then sets those two columns plus
  flips `onboarding_completed` to `true`.
- `update_kingdom(kingdom_name, coat_of_arms_id)` — the later, editable-anytime
  version used from `/profile/me` once onboarding is already done; applies
  the same `coat_of_arms_id` catalog validation.
- `heartbeat()` — sets `last_seen_at = now()` and adds the heartbeat interval
  (§6) to `total_playtime_seconds`. Concurrency-safe to call simultaneously
  from multiple tabs/devices for the same player (each call is a simple
  atomic `+= 30` inside the RPC, so no lost updates) — but it is **not**
  idempotent, so concurrent callers each add their own increment rather than
  collapsing into one; see §6 for the resulting overcounting trade-off.

No RPC exists (in this spec) for mutating `xp` — later subsystems that
actually award XP (§5) will add their own `security definer` function when
that trigger logic is designed, following this same pattern. There is no
`delete` policy or function (accounts are not deletable in this MVP).

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
  case-insensitively by the partial `lower(kingdom_name)` unique index from
  §2; a duplicate submission shows an inline "already taken" error and
  re-prompts), 3-30 characters.
- **Coat of arms** — the player picks one emblem from a fixed gallery of
  **at least 20** hand-authored SVG designs (same hand-drawn vector-art style
  as subsystem #1's unit art — no image-generation tool is available in this
  environment either), stored as `lib/players/coats-of-arms.tsx`, referenced
  on the player by a stable `coat_of_arms_id` string. Both
  `complete_kingdom_onboarding` and `update_kingdom` (§2.2) validate that the
  submitted `coat_of_arms_id` matches one of the fixed IDs in that catalog
  before writing (raising an error otherwise), so a client can never persist
  an ID outside the known gallery.

Both the kingdom name and the coat of arms **can be changed later** from the
profile page: `update_kingdom` (§2.2) re-applies the exact same rules as the
initial onboarding call — 3-30 characters, case-insensitive uniqueness check,
and `coat_of_arms_id` catalog validation — so there is no separate, looser
"edit" path. There is no cooldown or cost for changing either in this MVP —
YAGNI, can be added later if it turns out to matter.

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
  return 100 * (level - 1) * level / 2
}
// level 1 = 0, level 2 = 100, level 3 = 300, level 10 = 4,500, level 20 = 19,000

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
- **Total playtime**: `heartbeat()` (§2.2) is the single source of truth —
  each call adds a fixed 30-second increment (the heartbeat interval above)
  to `players.total_playtime_seconds` in the same RPC call that updates
  `last_seen_at`. There is no separate login/logout session timer: since a
  tab that's closed or backgrounded simply stops sending heartbeats, playtime
  naturally stops accumulating within 30 seconds of the player actually
  leaving, without needing an explicit logout event or gap-detection logic.
  This slightly undercounts the final open heartbeat window (up to ~30s) per
  session, which is an acceptable trade-off for an MVP activity stat.
  Multiple simultaneously open tabs/devices for the same player each send
  their own heartbeat, so playtime can be **overcounted** while more than one
  is open concurrently (e.g. two tabs open for a minute adds ~2 minutes, not
  1). This is an accepted MVP simplification — "total playtime" is a rough
  activity indicator, not a precise session audit — and is explicitly
  out-of-scope to fix (§9) via a per-device/tab dedup mechanism.
- The profile page's "activity" section (per earlier discussion) shows all
  three: account age (`created_at`), last-seen (`last_seen_at`, or "online"
  live badge), and total playtime.

## 7. Pages

- **`/register`**, **`/login`** — email + password forms (Supabase Auth);
  registration also collects the public `display_name` and the permanent
  `nation` choice (§3, presented as the 6-option table so the player sees the
  perk descriptions before committing). Login is by email, not by
  `display_name` (§ discussion — simpler and more secure, delegated to
  Supabase).
  - **Email verification is required before first login**: Supabase's
    "confirm email" setting is enabled, so a freshly-registered account
    exists in `auth.users` (and thus has a matching `players` row, §2.1) but
    cannot sign in until the player clicks the confirmation link emailed to
    them. `/register` shows a "check your email" screen after submission
    instead of signing the player in directly. An unconfirmed account that
    tries `/login` sees an inline "please confirm your email first" error
    with a "resend confirmation email" action.
  - **`/reset-password`** — requested from a "forgot password?" link on
    `/login`; submits an email to Supabase's built-in reset flow, which
    emails a link back to `/reset-password` with a one-time token. That page
    then collects and submits a new password, after which the player is
    redirected to `/login`.
- **`/onboarding/kingdom`** — the one-time kingdom name + coat-of-arms setup
  from §4; redirected here automatically after first login until completed.
- **`/profile/me`** — own profile: display name, nation (+ its perk
  description, informational only per §3.1), kingdom name + coat of arms
  (both editable here), level + XP progress bar, online/offline badge, and
  the three activity stats from §6.
- **`/profile/[id]`** — read-only view of another player's profile (same
  fields as above, minus any edit controls).
- **`/leaderboard`** — ranked by level (ties broken by raw XP), showing
  rank, display name, nation, level, XP, and a link to `/profile/[id]`. The
  query filters to `onboarding_completed = true`, so players who registered
  (and are therefore already `select`-able rows, §2.2) but haven't finished
  the one-time kingdom setup yet — who'd otherwise clutter the board with a
  string of brand-new, all-at-level-1/0-XP rows that have no kingdom name or
  coat of arms yet — don't appear until onboarding completes. `/profile/[id]`
  has no such filter (a direct link to an unfinished profile still resolves,
  just without a kingdom name/coat of arms yet), since it's not a discovery
  surface the way the leaderboard is.

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
- Per-device/tab dedup of heartbeats to prevent multi-tab playtime
  overcounting (§6) — accepted MVP simplification.
