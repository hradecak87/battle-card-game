"""
Crop a grid-sheet PNG of illustrated unit-card artwork into individual
per-card PNG files named by `card_templates.id`.

Why this exists: source sheets exported from image-generation tools often
do NOT have a perfectly uniform grid — tile widths/heights can vary by a
few dozen pixels between rows/columns even when the "intended" size (e.g.
960x512) is uniform. Naively slicing on a fixed stride crops into the
neighboring tile and creates visible bleed (a foot/weapon tip from one
card appearing at the edge of the next). This script detects the *actual*
gutter (near-transparent boundary) between tiles instead of assuming a
fixed stride, so each tile is cropped exactly on its real boundary.

Requirements: source sheet must have a transparent (alpha ~0) background,
with the actual illustration also mostly-transparent margins around it —
detection works by finding rows/columns of near-zero non-transparent pixel
counts near each expected boundary.

Usage:
    python scripts/crop-card-sheet.py <sheet.png> <rows> <cols> <names.json> [outdir]

    <names.json> is a flat JSON array of `rows*cols` card ids (template ids),
    in row-major reading order (left-to-right, top-to-bottom), matching how
    the source sheet was laid out. Example for a 5x5 sheet:
        ["lightCavalry-rare-04", "swordsmen-uncommon-08", ...]

    [outdir] defaults to `public/cards/units`.

Example (this project's 25-card sheet):
    python scripts/crop-card-sheet.py karty1.png 5 5 card_ids.json

After running, spot-check a few output files with the `view` tool —
especially tiles adjacent to any row/column where the source art has large
flowing elements (banners, spears, horse tails) that could shift the
detected gutter — before trusting the whole batch.
"""

import json
import os
import sys

import numpy as np
from PIL import Image


def find_best_gutter(counts: np.ndarray, lo: int, hi: int, thresh: int = 3) -> int:
    """Find the boundary position within [lo, hi) with the longest run of
    near-zero non-transparent pixel counts (the actual gutter between
    tiles), instead of just the single lowest-count row/column (which can
    be noisy). Falls back to the global minimum in the range if no run of
    at least `thresh`-or-below values is found.
    """
    seg = counts[lo:hi]
    runs = []
    start = None
    for i, v in enumerate(seg):
        if v <= thresh:
            if start is None:
                start = i
        else:
            if start is not None:
                runs.append((start, i - 1))
                start = None
    if start is not None:
        runs.append((start, len(seg) - 1))

    if not runs:
        idx = int(np.argmin(seg))
        return lo + idx

    runs.sort(key=lambda r: r[1] - r[0], reverse=True)
    a, b = runs[0]
    return lo + (a + b) // 2


def detect_boundaries(counts: np.ndarray, total: int, n_tiles: int, search_margin: int = 60) -> list:
    """Detect n_tiles+1 boundary positions (0, b1, b2, ..., total) given the
    expected *nominal* tile size (total / n_tiles), searching a window of
    +/- search_margin px around each nominal boundary for the real gutter.
    """
    nominal = total / n_tiles
    boundaries = [0]
    for i in range(1, n_tiles):
        expected = round(i * nominal)
        lo = max(0, expected - search_margin)
        hi = min(total, expected + search_margin)
        boundaries.append(find_best_gutter(counts, lo, hi))
    boundaries.append(total)
    return boundaries


def crop_sheet(sheet_path: str, n_rows: int, n_cols: int, names: list, outdir: str) -> None:
    im = Image.open(sheet_path).convert('RGBA')
    w, h = im.size
    alpha = np.array(im.getchannel('A'))

    row_nonzero = (alpha > 10).sum(axis=1)  # per row, across full width
    col_nonzero = (alpha > 10).sum(axis=0)  # per column, across full height

    row_bounds = detect_boundaries(row_nonzero, h, n_rows)
    col_bounds = detect_boundaries(col_nonzero, w, n_cols)

    print('Detected row boundaries:', row_bounds)
    print('Detected col boundaries:', col_bounds)

    os.makedirs(outdir, exist_ok=True)
    if len(names) != n_rows * n_cols:
        raise ValueError(f'Expected {n_rows * n_cols} names, got {len(names)}')

    idx = 0
    for r in range(n_rows):
        for c in range(n_cols):
            name = names[idx]
            idx += 1
            crop = im.crop((col_bounds[c], row_bounds[r], col_bounds[c + 1], row_bounds[r + 1]))
            out_path = os.path.join(outdir, f'{name}.png')
            crop.save(out_path)
            print(f'  wrote {out_path} ({crop.size[0]}x{crop.size[1]})')


if __name__ == '__main__':
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)

    sheet_path = sys.argv[1]
    n_rows = int(sys.argv[2])
    n_cols = int(sys.argv[3])
    names_path = sys.argv[4]
    outdir = sys.argv[5] if len(sys.argv) > 5 else 'public/cards/units'

    with open(names_path, 'r', encoding='utf-8') as f:
        names = json.load(f)

    crop_sheet(sheet_path, n_rows, n_cols, names, outdir)
