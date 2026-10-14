# dots-worker

Python service that turns a black-and-white line drawing into a printable connect-the-dots PDF (A4, puzzle + answer key).

## Algorithm

1. **Preprocess** — decode (PNG/JPEG/WebP, alpha over white), downscale to ≤1600 px, Otsu binarization, remove page frames, specks and watermarks sitting on the frame, crop, close pinholes.
2. **Skeleton graph** — skeletonize thick lines to a 1-px centerline, build a pixel graph (diagonal links dropped when a 4-connected path exists → no fake junctions), cluster junction pixels into nodes, trace edges, prune short spurs, merge degree-2 chains.
3. **Strokes** — greedy Euler-like walk through junctions along the straightest edge (fewer pen lifts); nearest-neighbour stroke ordering starting at the top. `outline` mode keeps only edges along the outer silhouette as dots, the rest is drawn as plain lines.
4. **Dots** — Ramer–Douglas–Peucker with a per-level tolerance (keeps corners), extra dots on long smooth arcs, minimum spacing, cap on total dots (tolerance raised by binary search when over budget), snapping of near-coincident dots shared by several strokes. Closed loops end on their starting dot.
5. **Labels** — numbers, `A1…/B1…` series, or math examples (`7+5`, `20−6`, `6×7` for adults). Greedy collision-aware placement on a cost grid: avoids dots, solution segments, plain lines, other labels; penalises labels closer to another dot than to their own.
6. **Render** — Cairo → PDF (2 pages) + PNG previews, RU/EN texts, Dottie mascot.

## Options

| option | values | default |
|---|---|---|
| `mode` | `all`, `outline` | `all` |
| `numbering` | `jumps`, `series` | `jumps` |
| `level` | `kid` (≤50 dots), `school` (≤150), `adult` (≤320) | `school` |
| `labels` | `numbers`, `math` | `numbers` |
| `lang` | `ru`, `en` | `ru` |
| `seed` | int (math examples) | `1` |

## Run locally

```bash
pip install -r requirements-dev.txt
python -m dotdot.cli samples/among-us.png out/ --level kid --mode outline
pytest -q
```

~0.4–0.9 s per image on one CPU core.
