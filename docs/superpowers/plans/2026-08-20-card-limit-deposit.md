# Card limit + deposit implementation plan

> **For agentic workers:** REQUIRED: use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-player card collection limit that scales with XP level, an overflow "deposit" with 3-day expiry, and a manual return-to-pool/withdraw-from-deposit flow.

**Architecture:** Two new SQL helper functions (`_deck_limit`/`_deposit_limit`) computed from `levelForXp`-equivalent SQL logic; a shared `_deposit_or_grant_card` helper wired into every place ownership of a `card_instances` row is granted to a player; a shared `_return_card` helper for burn/recycle; two new player-facing RPCs (`return_card_to_pool`, `withdraw_from_deposit`); client wrappers + collection-page UI additions.

**Tech Stack:** Supabase Postgres (SQL migrations applied both as files and directly to the live DB via `pg.Client`/`SUPABASE_DB_URL`, per established project pattern), Next.js/TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-08-20-card-limit-deposit-design.md` — read in full before starting.

---

## Chunk 1: Discovery — confirm current call sites

Before writing any migration, this codebase's convention is that SQL functions get redefined across many migrations. You MUST find the **current, latest** definition of each function below, not just the migration that first introduced it (grep for `create or replace function <name>` across `supabase/migrations/*.sql` and use the highest-numbered file that redefines it).

- [ ] **Step 1:** Run `Get-ChildItem supabase\migrations\*.sql | Sort-Object Name` and note the highest migration number so far (next migration file number = that + 1).
- [ ] **Step 2:** Grep for every `create or replace function _resolve_round`, `_award_xp`, `_finalize_battle`, `accept_trade_offer`, `claim_daily_reward`, `admin_grant_card` and note which migration file has the LATEST (highest-numbered) definition of each. These are your real edit targets.
- [ ] **Step 3:** Grep for every remaining `insert into card_instances (` and `update card_instances set owner_id` across all migrations to confirm there are no other ownership-granting call sites the spec missed (new features may have added more since the spec was written). List them.
- [ ] **Step 4:** Read `lib/players/leveling.ts` (`xpRequiredForLevel`, `levelForXp`) — you'll need to port this exact formula into SQL for `_deck_limit`/`_deposit_limit` (level is derived from `players.xp`, never stored).

## Chunk 2: Schema migration

**Files:**
- Create: `supabase/migrations/00XX_card_limit_deposit.sql` (XX = next number from Chunk 1 Step 1)
- Create: `supabase/migrations/00XX_card_limit_deposit.verification.sql`

- [ ] **Step 1:** Write the migration:
  - `alter table card_instances drop constraint <existing status check name>;` then re-add it allowing `'stationed'`, `'in_transit'`, `'deposit'` (find the existing constraint name via `\d card_instances` or by grepping the original `create table card_instances` in `0002_territories.sql`).
  - `alter table card_instances add column if not exists deposit_expires_at timestamptz;`
  - `create table if not exists card_return_log (...)` exactly as specified in the spec's "Data model changes" section.
  - SQL function `_level_for_xp(p_xp integer) returns integer` — port `levelForXp`/`xpRequiredForLevel` from `lib/players/leveling.ts` faithfully (same loop-based derivation, not a closed-form approximation, to avoid drift).
  - SQL function `_deck_limit(p_level integer) returns integer` → `80 + 10 * (p_level - 1)`.
  - SQL function `_deposit_limit(p_level integer) returns integer` → `floor(_deck_limit(p_level) / 2.0)`.
  - SQL function `_return_card(p_instance_id uuid, p_reason text) returns void`: reads the instance's `template_id`/`rank`/`owner_id`, deletes the `card_instances` row; if rank in `('rare','epic','legend')`, inserts one `card_return_log` row.
  - SQL function `_expire_deposit(p_player_id uuid) returns void`: for every `card_instances` row where `owner_id = p_player_id and status = 'deposit' and deposit_expires_at <= now()`, call `_return_card(instance_id, 'deposit_expired')`.
  - SQL function `_deposit_or_grant_card(p_player_id uuid, p_instance_id uuid, p_status text default 'stationed') returns void`:
    1. `perform _expire_deposit(p_player_id)`.
    2. Compute player's level via `_level_for_xp` from `players.xp`.
    3. Count that player's `stationed`/`in_transit` cards; if `< _deck_limit(level)`, `update card_instances set owner_id = p_player_id, status = p_status where instance_id = p_instance_id` (caller passes the right `status`/`stationed_territory_id` separately if needed — keep this helper focused on ownership + capacity, let callers set territory/status details before/after as today).
    4. Else count deposit cards; if `< _deposit_limit(level)`, `update card_instances set owner_id = p_player_id, status = 'deposit', deposit_expires_at = now() + interval '3 days' where instance_id = p_instance_id`.
    5. Else, call `_return_card(p_instance_id, 'deposit_overflow')` (card never reaches the player — do NOT update owner_id).
  - New RPC `return_card_to_pool(p_instance_id uuid) returns void`: `security definer`; validates `auth.uid()` owns the instance (join `players` on `auth_user_id`, matching existing RPC patterns), status is not `in_transit` and not referenced by an active battle (check however existing RPCs check "not in an active battle" — likely a `battles` status check; mirror the existing pattern used in `abandon_territory` or `recall_attack` for "no unresolved battle" validation), then `perform _return_card(p_instance_id, 'manual_return')`.
  - New RPC `withdraw_from_deposit(p_instance_id uuid) returns void`: validates ownership + `status = 'deposit'`; computes level + `_deck_limit`; if current `stationed`/`in_transit` count `>= limit`, `raise exception 'balíček je stále plný — nejdřív vrať jinou kartu do centrální sady'`; else finds player's home territory id and does `update card_instances set status = 'stationed', stationed_territory_id = <home id>, deposit_expires_at = null where instance_id = p_instance_id`.
  - Follow the file's existing header-comment style (see any recent migration, e.g. `0026_boost_cards.sql`, for the convention).
- [ ] **Step 2:** Write the verification SQL file following the pattern of e.g. `0021_abandon_territory.verification.sql` — checks all new functions/columns/table exist with expected signatures.
- [ ] **Step 3:** Apply the migration to the live Supabase project directly via `pg.Client`/`SUPABASE_DB_URL` (established pattern — see PROGRESS.md entries for migrations 0016-0027 for the exact approach used previously). Run the verification SQL against the live DB and confirm it passes.
- [ ] **Step 4:** Commit (migration + verification file only, this chunk).

## Chunk 3: Wire the helper into every card-grant call site

**Files:** whichever migration files hold the CURRENT latest definitions found in Chunk 1 Step 2/3 — redefine those functions with `create or replace function` in a NEW migration file `00XX+1_wire_card_limit.sql` (do not edit old migration files in place; this codebase always adds a new migration that redefines).

- [ ] **Step 1:** For card capture (`_resolve_round` or wherever it currently lives): replace the direct `update card_instances set owner_id = v_winner_owner where instance_id = v_loser_card` with a call to `_deposit_or_grant_card(v_winner_owner, v_loser_card)`.
- [ ] **Step 2:** For level-up/daily reward card grants (`_award_xp` and/or `claim_daily_reward` — whichever actually does it per Chunk 1 findings): replace each `insert into card_instances (template_id, owner_id, stationed_territory_id, status) values (...)` with: insert the row with `owner_id = null` first (or insert then immediately call the helper — pick whichever is less invasive given the existing code shape), then call `_deposit_or_grant_card(p_player_id, new_instance_id)` to route it correctly. Preserve all existing reward-count/rank-selection logic untouched — only the final ownership-assignment step changes.
- [ ] **Step 3:** Same treatment for `_finalize_battle`'s structure-reward card insert.
- [ ] **Step 4:** For `accept_trade_offer`: apply both sides' ownership transfers as today first, then for each recipient compute their **net** resulting `stationed`/`in_transit` count and route any newly-over-limit card(s) through `_deposit_or_grant_card`-equivalent logic — since multiple cards may transfer at once in one trade, iterate per received card only after all removals for that player are already applied, so a like-for-like swap never triggers deposit routing. Explicit test case: player at exactly their limit trades away 2 cards and receives 2 different cards in the same offer — neither received card should go to deposit.
- [ ] **Step 5:** Explicitly confirm `admin_grant_card` is untouched (still bypasses all of this).
- [ ] **Step 6:** Run the full existing Jest suite for `lib/battles/*`, `lib/territories/*`, trade-related tests to confirm nothing regressed. Fix any breaks.
- [ ] **Step 7:** Apply this migration to the live DB same way as Chunk 2. Commit.

## Chunk 4: Client — formulas, API wrappers, types

**Files:**
- Create: `lib/players/cardLimit.ts`
- Test: `lib/players/cardLimit.test.ts`
- Modify: `lib/territories/api.ts` (or create `lib/cards/deposit.ts` if cleaner) — add `returnCardToPool()`, `withdrawFromDeposit()` wrappers calling the new RPCs; extend `MyCardInstance` type with `deposit_expires_at: string | null` and allow `status: 'stationed' | 'in_transit' | 'deposit'`.

- [ ] **Step 1:** Write `cardLimit.test.ts` covering `deckLimit(1) === 80`, `deckLimit(10) === 170`, `deckLimit(30) === 370`, `depositLimit(1) === 40`, `depositLimit(10) === 85`.
- [ ] **Step 2:** Run it, confirm it fails (functions don't exist yet).
- [ ] **Step 3:** Implement `deckLimit`/`depositLimit` in `cardLimit.ts` mirroring the SQL formulas exactly (display-only — never used for enforcement).
- [ ] **Step 4:** Run tests, confirm pass.
- [ ] **Step 5:** Add the two RPC wrappers + type changes; add/adjust their tests following the existing pattern for other wrappers in `lib/territories/api.test.ts`.
- [ ] **Step 6:** Commit.

## Chunk 5: Collection page UI

**Files:**
- Modify: `app/collection/page.tsx`
- Modify: `app/collection/page.test.tsx`

- [ ] **Step 1:** Add failing tests first (TDD) for: a `X / limit` counter rendering using `deckLimit(level)` (level comes from wherever the page already gets/derives the player's XP — check `useSession`/player fetch already in the file), a "Depozit" tab/section that lists cards with `status === 'deposit'` and a live countdown to `deposit_expires_at` (format like existing `formatEta`-style helpers if one exists — check `lib/territories/formulas.ts`), a "Vrátit do centrální sady" button on stationed cards with a confirm step whose text differs for rank (common/uncommon: "karta zanikne" vs rare+: "karta se vrátí do oběhu"), a "Vyzvednout z depozitu" button (disabled/hidden if deck is full) on deposit cards, and a warning banner when `deposit` count `>= 1`.
- [ ] **Step 2:** Run tests, confirm they fail.
- [ ] **Step 3:** Implement the UI additions, reusing existing filter/tab patterns already in the file (unit-type/rank/category filters) rather than inventing a new pattern.
- [ ] **Step 4:** Run tests, confirm pass.
- [ ] **Step 5:** Commit.

## Chunk 6: Full verification + docs

- [ ] **Step 1:** Run the full Jest suite (`npx jest --runInBand --silent`), `npx tsc --noEmit`, `npm run build` — all three, fix any failures.
- [ ] **Step 2:** Update `docs/superpowers/PROGRESS.md` with a dated "Latest update" entry summarizing what shipped (mirror the style of existing entries — migration numbers, files touched, test counts, whether applied to live DB).
- [ ] **Step 3:** Clean up any stray/scratch files.
- [ ] **Step 4:** Report back a summary (files changed, migration numbers used, test results) — do NOT commit/push this final chunk's PROGRESS.md-only change without it being bundled with Chunk 5's commit or its own clearly-described commit; do not push anything — wait for explicit human approval before push, per project convention. Committing chunk-by-chunk as you go (per each chunk above) is fine and expected; only the final push needs sign-off.
