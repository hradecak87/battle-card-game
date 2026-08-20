"""
Crop a grid-sheet PNG of illustrated unit-card artwork into individual
per-card PNG files named by `card_templates.id` — variant for sheets that
have a text CAPTION baked in under each art tile (as produced by some
image-generation tools/AIs), which `crop-card-sheet.py` does not handle.

Why this is a SEPARATE script (not a modification of crop-card-sheet.py):
the original script assumes each grid cell is *only* the illustration
(transparent-background character cutouts), with a single uniform gutter
between adjacent cells. This variant's source sheets have a different
per-cell layout: [[ art ]] then a thin caption-text band underneath, with
a short blank gutter both before and after the caption (art -> gutter ->
caption -> gutter -> next art). The captions are often garbled/unreliable
(AI-rendered text) and are NOT wanted in the output — this script detects
and discards them automatically, keeping only the art portion of each
cell.

Detection approach: for each axis, find all "gutter" pixel rows/columns
(near-uniform light/low-chroma background, counted via a foreground-pixel
threshold), then MERGE any two gutter runs that are close together (within
`merge_gap` px) into one combined zone — this bridges exactly across a
caption's [gutter, text, gutter] complex while leaving the much larger
gaps between actual art rows untouched. For an n_rows grid this yields
n_rows+1 zones; each row's art is the span between consecutive zones.

Also, unlike crop-card-sheet.py's checkerboard-fallback mode (which
*punches real transparency* into the crop wherever it detects
near-white/low-chroma pixels — appropriate for cutout character art on a
neutral-gray fake-transparency background), this script's target sheets
are full rectangular painted SCENES (sky, terrain, etc. all legitimately
part of the art), so no per-pixel matting/alpha-punching is applied inside
each cropped tile — the background-color detection is used only to find
gutters between/around cells. Output crops are saved as fully-opaque RGBA
(alpha=255 throughout), matching this project's file-format convention
without discarding any real art pixels.

Usage:
    python scripts/crop-card-sheet-captioned.py <sheet.png> <rows> <cols> <names.json> [outdir]

    <names.json> is a flat JSON array of `rows*cols` card ids (template ids),
    in row-major reading order (left-to-right, top-to-bottom), matching how
    the source sheet was laid out.

    [outdir] defaults to `public/cards/units`.
"""

import json
import os
import sys

import numpy as np
from PIL import Image


def find_gutter_runs(counts: np.ndarray, thresh: int) -> list:
    """All (start, end) index ranges where counts <= thresh."""
    runs = []
    start = None
    for i, v in enumerate(counts):
        if v <= thresh:
            if start is None:
                start = i
        else:
            if start is not None:
                runs.append((start, i - 1))
                start = None
    if start is not None:
        runs.append((start, len(counts) - 1))
    return runs


def merge_close_runs(runs: list, merge_gap: int) -> list:
    """Merge consecutive runs separated by a gap <= merge_gap (bridges over
    a caption's short text band sitting between two thin gutters, while
    leaving genuinely large art-sized gaps between rows untouched).
    """
    if not runs:
        return runs
    merged = [runs[0]]
    for start, end in runs[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end - 1 <= merge_gap:
            merged[-1] = (prev_start, end)
        else:
            merged.append((start, end))
    return merged


def detect_zones(counts: np.ndarray, thresh: int, merge_gap: int, n_tiles: int) -> list:
    runs = find_gutter_runs(counts, thresh)
    zones = merge_close_runs(runs, merge_gap)
    if len(zones) != n_tiles + 1:
        raise ValueError(
            f'Expected {n_tiles + 1} zones (for {n_tiles} tiles) after merging, got {len(zones)}: {zones}. '
            'Try adjusting thresh/merge_gap.'
        )
    return zones


def crop_sheet(
    sheet_path: str,
    n_rows: int,
    n_cols: int,
    names: list,
    outdir: str,
    row_thresh: int = 40,
    row_merge_gap: int = 20,
    col_thresh: int = 40,
    col_merge_gap: int = 20,
) -> None:
    im = Image.open(sheet_path).convert('RGB')
    w, h = im.size
    rgb = np.array(im).astype(int)
    maxc = rgb.max(axis=2)
    minc = rgb.min(axis=2)
    chroma = maxc - minc
    is_background = (minc >= 195) & (chroma <= 8)
    foreground = ~is_background

    row_nonzero = foreground.sum(axis=1)
    col_nonzero = foreground.sum(axis=0)

    row_zones = detect_zones(row_nonzero, row_thresh, row_merge_gap, n_rows)
    col_zones = detect_zones(col_nonzero, col_thresh, col_merge_gap, n_cols)

    print('Row zones (gutters, between which each row-art lives):', row_zones)
    print('Col zones (gutters, between which each col-art lives):', col_zones)

    row_bounds = [(row_zones[i][1] + 1, row_zones[i + 1][0] - 1) for i in range(n_rows)]
    col_bounds = [(col_zones[i][1] + 1, col_zones[i + 1][0] - 1) for i in range(n_cols)]
    print('Row art bounds:', row_bounds)
    print('Col art bounds:', col_bounds)

    os.makedirs(outdir, exist_ok=True)
    if len(names) != n_rows * n_cols:
        raise ValueError(f'Expected {n_rows * n_cols} names, got {len(names)}')

    im_rgba = im.convert('RGBA')

    idx = 0
    for r in range(n_rows):
        r_top, r_bottom = row_bounds[r]
        for c in range(n_cols):
            c_left, c_right = col_bounds[c]
            name = names[idx]
            idx += 1
            crop = im_rgba.crop((c_left, r_top, c_right + 1, r_bottom + 1))
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
