# Speed Attribute (backlog #12) — Design

## Goal
Give every unit card a `speed` stat that affects **movement duration only**
(transfers, attack marches, territory-claim marches, and card retreat after
a lost/surrendered battle) — not combat math, not rank scaling.

## Data model
- New field `speed` (0–10 scale, same range as str/lng/def/hp) added to:
  - `RawStats` (`lib/cards/types.ts`)
  - `card_templates.base_stats` JSONB (no schema change needed — same column)
- **Not** scaled by rank in `applyRank`/`EffectiveCard`/combat math. A
  legendary unit isn't faster, just stronger in a fight.
- Per-unit-type baseline speed (`scripts/generate-catalog-data.js`):

  | Type | Speed |
  |---|---|
  | lightCavalry | 9 |
  | knights | 7.5 |
  | archers | 6 |
  | swordsmen | 5.5 |
  | spearmen | 5 |
  | crossbowmen | 4.5 |
  | halberdiers | 3.5 |
  | siegeEngines | 2 |

- Per-card variance: reuse the existing deterministic seeded-hash variance
  mechanism, but **inverted** relative to that card's average str/lng/def/hp
  variance — a variant that rolled above-average combat stats gets a
  below-average speed roll, and vice versa. This mechanically implements
  "a mightier/heavier variant of the same unit type is slightly slower"
  across all 248 catalog entries without hand-authoring each one.

## Movement formula
- **Group speed** = `min(speed)` across the moving/attacking card selection
  (the slowest unit sets the pace for the whole group).
- New duration formula (replaces the plain distance formula everywhere it's
  used for travel):

  ```
  hours = max(0.25, distance * 0.3 * (5 / groupSpeed)) * nationMultiplier
  ```

  clamped so the `(5 / groupSpeed)` factor never exceeds roughly
  `[0.4, 3.0]` — avoids degenerate durations from future extreme speed
  values. `5` is the baseline reference speed: a mid-pack unit reproduces
  today's unmodified duration exactly.
- Applies to: `declare_attack`, `start_transfer`, `start_claim`, and both
  card-movement branches inside `_finalize_battle` (attacker return trip,
  defender capture/flee trip).
- Does **not** apply to: territory occupation time (already
  power-based, unrelated to travel), or `_recall_movement_to_origin`
  (#23 — uses elapsed wall-clock time, not the distance formula).

## Server changes
- New shared SQL helper `_min_group_speed(card_instance_ids uuid[]) returns
  numeric`, joining `card_instances -> card_templates`, reading
  `(base_stats->>'speed')::numeric` for `category = 'unit'` rows, taking
  `min()`. Replaces the currently hand-duplicated formula at all 5 call
  sites above.

## Client changes
- `lib/territories/formulas.ts`'s `transferHours` gains a `groupSpeed`
  parameter (mirrors the SQL formula) for live ETA previews before the RPC
  call completes.
- `DeclareAttackModal` / `TransferModal` compute group speed from the
  player's selected cards to show an accurate ETA preview.
- `components/cards/TradingCard.tsx` (the single shared stat-display
  component used everywhere cards render) adds a 5th stat cell for Speed.

## Data backfill
- Extend `scripts/generate-catalog-data.js` to emit `speed` per entry and
  regenerate `lib/cards/catalog-data.json` (248 entries).
- Add a one-off script (parallel to `scripts/seed-card-templates.ts`) that
  merges the new `speed` value into every existing live-DB
  `card_templates.base_stats` row by id (JSONB `||` merge — no data loss),
  run once against the live project with explicit user go-ahead.

## Testing
- Unit tests for the per-card speed derivation (inverse-variance formula)
  and for `transferHours`'s new speed-aware branch (including clamping).
- SQL verification checklist (`0020_*.verification.sql`) confirming
  `_min_group_speed` returns the correct minimum and that all 5 call sites
  produce the expected slower/faster durations for known fixtures.
