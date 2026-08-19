# Card-art sheet cropping — full workflow

This documents the end-to-end process used to turn a big 5x5 grid-sheet PNG
of AI-generated unit illustrations into 25 individual, correctly-named,
transparent-background card-art PNGs wired into the app. Follow this
verbatim next time a new sheet (`kartyN.png`) arrives.

## 0. Inputs needed from the user

- The sheet image itself, saved at the project root (e.g. `karty4.png`).
  Always a 5x5 grid (25 cards) so far.
- A list of the 25 card names **in row-major reading order** (left-to-right,
  top-to-bottom, matching how the sheet was laid out), each with its unit
  type, e.g.:
  ```
  Cechovní trebuchet - siegeEngines
  Celní stráž - crossbowmen
  ...
  ```
  The order the user pastes them in has always matched the sheet's reading
  order directly — no need to ask, just double check visually once cropped
  (step 4).

## 1. Resolve each name+type to its unique `card_templates.id`

Card names in `lib/cards/catalog-data.json` are globally unique (no two
templates share the same `name`), but always filter by **both** `name` AND
`unitType` to be safe. Note the JSON field is `unitType` (camelCase), not
`category`/`unit_type` — the catalog file only contains unit cards (no
castle/village), so there's no `category` field to filter on at all.

```powershell
cd "C:\Users\z0040m9d\Documents\Projects\Battle card game V2"
node -e "
const cat = require('./lib/cards/catalog-data.json');
const names = [
  'Cechovní trebuchet - siegeEngines',
  // ...all 25, in sheet order...
];
const results = [];
for (const line of names) {
  const [name, type] = line.split(' - ').map(s=>s.trim());
  const matches = cat.filter(c => c.name === name && c.unitType === type);
  results.push({ name, type, ids: matches.map(m=>m.id) });
}
results.forEach(r => console.log(r.ids.length, JSON.stringify(r)));
"
```

- Every line MUST print exactly `1` match. If any line prints `0` or `2+`,
  stop and resolve the ambiguity/typo before continuing (don't guess).
- Copy the 25 resulting ids, **in the same order**, into a flat JSON array
  file (e.g. `card_ids4.json`) — this becomes the `<names.json>` argument
  for the crop script. This file is scratch/temporary — delete it after
  the crop run (step 3), same convention as all other one-off scripts.

## 2. The reusable crop tool

`scripts/crop-card-sheet.py` — **always use this, never write a new crop
script from scratch.** It has been improved twice (see history below) and
should keep absorbing fixes for new sheet quirks rather than being
replaced.

```powershell
python scripts/crop-card-sheet.py <sheet.png> <rows> <cols> <names.json> [outdir]
# outdir defaults to public/cards/units
```

Example:
```powershell
python scripts/crop-card-sheet.py karty4.png 5 5 card_ids4.json
```

### How it works

1. Loads the sheet as RGBA.
2. **Background/foreground detection** (two modes, auto-selected):
   - **Real-alpha sheets** (most common): if the image has actual alpha
     variation, foreground = `alpha > 10`.
   - **Baked-in checkerboard sheets** (no real alpha — `alpha.min() >= 250`
     everywhere, i.e. fully opaque): some export tools bake a flat
     neutral-gray "checkerboard" pattern into the RGB pixels instead of
     real transparency, which look transparent to the eye but aren't.
     Detected via `alpha.min() >= 250`. Falls back to **color-based**
     background detection instead: a pixel counts as background if
     `min(R,G,B) >= 195 AND (max(R,G,B) - min(R,G,B)) <= 8` (near-white or
     light-gray AND very low saturation/chroma — matches both checker
     shades, e.g. `(254,254,254)` and `(238,238,238)`, without falsely
     catching colorful or darker illustration pixels). When this path is
     used, the script also **punches real transparency into the output**
     (`im.putalpha(...)`) so saved crops are properly transparent PNGs
     instead of keeping the visible checker squares — this matches the
     project convention (`public/cards/units/*.png` are always meant to be
     transparent-background).
3. **Gutter/boundary detection**: computes a per-row and per-column count
   of foreground pixels (using whichever mask from step 2). For each of
   the `n_rows-1` / `n_cols-1` internal boundaries, searches a ±60px
   window around the *nominal* evenly-spaced position for the longest run
   of near-zero (`<= 3`) foreground-pixel-count rows/columns — that's the
   real gutter between tiles. Falls back to the single global minimum in
   that window if no such near-zero run exists.
   - **Why not a fixed/uniform stride?** Source sheets are frequently NOT
     perfectly uniform between rows/columns (tile sizes can vary by tens
     to 100+ px). Naive fixed-stride slicing crops into the neighboring
     tile and causes visible bleed (a weapon tip, banner, or extra
     soldiers from the adjacent card appearing at the edge).
4. Crops each of the 25 tiles at its *actual* detected boundaries and saves
   as `<outdir>/<card_id>.png`.

### History of fixes (context for future debugging)

- **v1** (karty1.png, karty2.png): alpha-based detection only. Worked fine
  for those two sheets because they had genuine alpha transparency.
- **v2** (karty3.png, this session): karty3.png turned out to have **no
  real alpha channel at all** (`alpha.min() == alpha.max() == 255`
  everywhere) — its apparent transparency was just a baked-in light-gray
  checker pattern in the RGB channels. Running v1's alpha-based detector
  against it found essentially arbitrary/wrong boundaries (since
  `alpha > 10` was true for 100% of every row/column, the "near-zero count"
  search degenerated into picking the single global minimum of a
  constant array, which is meaningless), causing visible bleed between
  rows 4 and 5 specifically (tall content in both rows left almost no true
  gutter, plus the wrong detection method compounded it). Added the
  color-based fallback + auto-transparency punch-in described in step 2
  above to fix this.

## 3. Run the crop, then ALWAYS spot-check before registering

```powershell
python scripts/crop-card-sheet.py karty4.png 5 5 card_ids4.json
```

Read the printed `Detected row boundaries` / `Detected col boundaries` —
if row/column sizes look wildly inconsistent (e.g. one row 120px, others
190-240px) that's a red flag worth a visual check, though it isn't
necessarily wrong (rows can legitimately have shorter art).

**View at least 3-5 of the output PNGs** with the `view` tool, prioritizing:
- tiles adjacent to the tallest/busiest rows (banners, spears, horse tails,
  flowing cloaks — anything that could shrink the real gutter),
- at least one tile from every row and the first/last columns,
- the corners.

Look specifically for: a sliver of the *next* tile's content bleeding in
at an edge, or a hard-cut illustration (content touching the crop
boundary with no margin at all, suggesting the boundary is too tight).

If you find bleed, don't just accept it — inspect the raw per-row/column
foreground-count profile around the bad boundary directly to understand
why (see the debugging snippet below), then decide whether a script fix
is needed (like the v2 fallback) or whether that specific sheet just needs
different `thresh`/`search_margin` parameters.

### Manual boundary-profile debugging snippet

Useful when the auto-detected boundary looks wrong and you need to see the
raw foreground-pixel-count curve around it:

```powershell
python -c "
import numpy as np
from PIL import Image
im = Image.open('karty4.png').convert('RGB')
arr = np.array(im).astype(int)
maxc = arr.max(axis=2); minc = arr.min(axis=2)
chroma = maxc - minc
fg = ~((minc >= 195) & (chroma <= 8))
row_counts = fg.sum(axis=1)
for y in range(650, 800, 2):
    print(y, row_counts[y])
"
```
(swap `axis=1`/`row_counts` for columns as needed, and adjust the color
thresholds to `alpha > 10` if the sheet has real alpha instead.)

## 4. Register the new card ids

Add the ids to `ILLUSTRATED_CARD_IDS` in `lib/cards/illustrated-art.ts`
(a flat `Set<string>` of template ids that have real artwork — everything
else falls back to the procedural SVG emblem in `unit-art.tsx`). Group each
batch with a `// batch N (kartyN.png)` comment for traceability.

`TradingCard.tsx` automatically picks up any id in that set — no other
wiring needed.

## 5. Clean up scratch files

- Delete the temporary `card_idsN.json` file.
- Delete the source sheet (`kartyN.png`) from the project root once
  cropping is verified — it's a large scratch input, not meant to be
  committed (none of `karty1.png`/`karty2.png`/`karty3.png` are in the
  repo). The 25 cropped PNGs under `public/cards/units/` are the actual
  committed artifacts.

## 6. Verify + commit

```powershell
npx jest components/cards --testPathIgnorePatterns="worktrees" --silent
npx tsc --noEmit --pretty false
npm run build
git add -A -- public/cards/units lib/cards/illustrated-art.ts scripts/crop-card-sheet.py
git commit -m "..."
git push origin main
```

Only after explicit user go-ahead per the project's commit/push rules,
unless previously blanket-authorized for the specific task.
