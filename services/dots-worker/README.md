# dots-worker

Python service that turns a black-and-white line drawing into a printable connect-the-dots PDF (A4, puzzle + answer key).

## Algorithm

1. **Preprocess** — decode (PNG/JPEG/WebP, alpha over white), downscale to ≤1600 px, Otsu binarization, remove page frames, specks and watermarks sitting on the frame, crop, close pinholes.
2. **Skeleton graph** — skeletonize thick lines to a 1-px centerline, build a pixel graph (diagonal links dropped when a 4-connected path exists → no fake junctions), cluster junction pixels into nodes, trace edges, prune short spurs, merge degree-2 chains.
3. **Strokes** — greedy Euler-like walk through junctions along the straightest edge. Pen lifts are reduced by (a) invisible bridges between odd-degree nodes that almost touch (only when they are not already joined by a short path), and (b) printing small details as plain lines per level, re-chaining after each pass so freed junctions let strokes merge. Nearly closed strokes are closed. Dot 1 is placed at the top of the drawing: the stroke through the top-most point goes first (a loop is rotated there; an open stroke is split there into two branches). Then nearest-neighbour stroke ordering. `outline` mode keeps only edges along the outer silhouette as dots, the rest is drawn as plain lines.
4. **Dots** — Ramer–Douglas–Peucker with a per-level tolerance (keeps corners), extra dots on long smooth arcs, minimum spacing, cap on total dots (tolerance raised by binary search when over budget), snapping of near-coincident dots shared by several strokes. Closed loops end on their starting dot.
5. **Labels** — numbers, `A1…/B1…` series, or math examples (`7+5`, `20−6`, `6×7` for adults; fewer dots in math mode). A dot shared by several numbers gets one combined label (`31/144`). Collision-aware placement on a cost grid (24 directions × 4 distances, crowded dots first): avoids dots, solution segments, plain lines and other labels; a label must be clearly closer to its own dot than to any other. Two refinement passes re-place the worst labels.
6. **Render** — Cairo → PDF (2 pages) + PNG previews, RU/EN texts, Dottie mascot.

## Options

| option | values | default |
|---|---|---|
| `mode` | `auto`, `all`, `outline` | `auto` → `outline` for `kid`, `all` otherwise |
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

~0.5–1.4 s per image on one CPU core. `--debug` adds layout quality metrics (overlaps, ambiguous labels, pen lifts) to the stats.

## Queue worker

`python -m dotdot.worker` (the Docker entrypoint) consumes BullMQ jobs from Redis.

| Var | Default | |
|---|---|---|
| `REDIS_URL` | redis://localhost:6379 | `socket_timeout=30` is added unless set: it must exceed BullMQ's 5 s blocking wait |
| `QUEUE_NAME` / `QUEUE_PREFIX` | dots / dotdot | must match the API |
| `STORAGE_DIR` | /data | shared volume |
| `WORKER_CONCURRENCY` | 1 | keep 1; scale with container replicas |
| `JOB_TIMEOUT_SEC` | 60 | |

Job data `{id, input, options}` → result `{files: {pdf, puzzle, answer, plan}, stats}`.
Edit jobs `{kind: "edit", id, input: "<id>/edit.json", options}` skip image analysis: the plan (format in `dotdot/plan_io.py`) is validated (`BAD_PLAN`) and rendered again.
Known failures are raised as non-retryable `CODE: message` (`BAD_IMAGE`, `BAD_OPTIONS`, `TIMEOUT`, `INPUT_MISSING`).
Images above 40 megapixels are refused before decoding. SIGTERM finishes the current job, then exits.
