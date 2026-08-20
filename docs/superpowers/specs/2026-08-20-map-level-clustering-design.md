# Map Level Clustering — Design Spec

Date: 2026-08-20

## Problem

`territories.difficulty` (1-5, aka "level") is currently assigned per-tile,
fully independently at random (`pickDifficulty()` in `scripts/generate-world.ts`),
with no spatial relationship between neighboring tiles. This makes the map
look like random noise instead of a coherent world — a level-5 "mountain"
tile can sit next to a level-1 "grass" tile next to a level-3 "water" tile
with no visual/thematic grouping.

## Goal

Recolor `territories.difficulty` across the whole live 256×256 map so that:

- Forest (2), desert (4), and mountain (5) form larger, irregularly-shaped
  contiguous regions of varying size (small and large blobs mixed).
- Water (3) forms small, clearly separated clusters, capped at 5-9 tiles
  each (ponds, not rivers/lakes).
- Grass (1) fills whatever space is left between the other regions.
- The overall percentage split across the map stays close to the existing
  design weights (1:30%, 2:30%, 3:20%, 4:15%, 5:5% — see
  `DIFFICULTY_WEIGHTS` in `scripts/generate-world.ts`), since combat/
  occupation-duration formulas were tuned against that distribution.

This was validated visually against a 50×50 prototype (Python/matplotlib,
not committed) before writing this spec; the user approved the result.

## Scope decision (confirmed with user)

This is applied to the **already-partially-live** map (22 territories owned,
1,569 with pre-seeded castle/village/wall structures, 13,563 stationed card
instances) via a **non-destructive, in-place recolor** ("Option B"):

- Only the `territories.difficulty` column is touched. Ownership, structures
  (castle/village/wall rank), stationed cards, battles, and troop movements
  are all left untouched.
- **All** territories are recolored, including the 22 currently owned/home
  ones — the user explicitly accepted the risk that an owned tile's level
  may change as a result (still in testing; low real impact).
- NPC garrisons already stationed on pre-seeded structure tiles are **not**
  resynced to the new difficulty — user explicitly chose to leave them as
  originally seeded rather than add extra scope to regenerate them.
- No other live system caches/derives from `difficulty` at rest — occupation
  duration and combat formulas read it live at action time, so an in-place
  update has no other migration dependencies.

## Algorithm

Blob/flood-fill growth over the 256×256 grid, processed in this order:
**forest → desert → mountain → water → (remaining tiles) grass**.

1. For forest/desert/mountain: repeatedly pick a random unclaimed tile as a
   seed, then grow the blob via random 8-directional (includes diagonals —
   purely for visual naturalness, distinct from the game's 4-directional
   mechanical adjacency used elsewhere e.g. NPC neighbor logic) frontier
   expansion until it reaches a randomly rolled target size (varied range,
   roughly 15-180 tiles) or runs out of expandable frontier. Repeat until
   that type's claimed tile count reaches its target percentage of the map.
2. For water: same growth mechanism, but with a small random target size of
   5-15 tiles per blob, a compact-growth cap (blob cells stay within a small
   radius of their own seed, so ponds stay roundish instead of snaking),
   and a minimum-gap constraint on seed placement (new blob seeds can't
   spawn within a couple of tiles of any existing water tile). In practice,
   hitting the full water percentage target while guaranteeing every single
   pond stays perfectly separated turned out to be mutually exclusive on
   the full 65,536-tile map (tighter separation reliably left water ~8-12%
   instead of its ~20% target, with the shortfall spilling into grass) —
   the implementation was tuned to prioritize hitting the percentage target,
   accepting that a minority of ponds may occasionally touch/merge into a
   slightly larger cluster. This traded-off tuning was reviewed against a
   rendered full 256×256 preview and approved by the user.
3. Any tile not claimed by the above becomes grass.

This is implemented as a pure, seedable-RNG TypeScript function
(`generateClusteredDifficultyGrid` in `scripts/generate-world.ts`, mirroring
the existing `buildWorld`/`pickDifficulty` pattern), so it can be unit
tested for: value range (1-5 only), approximate percentage split within
tolerance, forest/desert/mountain forming genuinely large contiguous
regions, and water staying pond-sized on the whole (median cluster size
well below forest's) rather than growing to forest/desert scale.

## Implementation approach

- New pure function `generateClusteredDifficultyGrid` in
  `scripts/generate-world.ts`, producing a full 256×256 difficulty grid.
- New one-time script `scripts/recolor-terrain.ts`:
  1. Requires explicit human go-ahead to run (no safety abort-if-non-empty
     check like `generate-world.ts`, since this *is* meant to run against a
     non-empty, live table — instead it just logs a warning and proceeds).
  2. Fetches every `territories` row's `id, x, y, difficulty`.
  3. Computes the new difficulty grid in memory.
  4. Backs up the full before/after difficulty per row to a timestamped
     JSON file (same pattern as `backfill-npc-garrisons.ts`) before writing
     anything.
  5. Batch-upserts `difficulty` for every row whose value actually changed
     (batches of ~1000, using `upsert` on the `id` primary key so only the
     `difficulty` column is touched — every other column is left alone).
  6. Logs the before/after percentage distribution for a quick sanity check.

## Out of scope (explicitly deferred)

- Regenerating NPC garrison sizes/ranks to match new difficulty.
- Any change to castle/village/wall placement or rank.
- The future `territory-level-march-penalty` backlog item (not live yet, so
  no additional dependency risk from this change).
