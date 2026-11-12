# dots-worker

Python service that turns a black-and-white line drawing into a printable connect-the-dots PDF (A4, puzzle + answer key).

## Algorithm

1. **Preprocess** — decode (PNG/JPEG/WebP, alpha over white), downscale to ≤1600 px, Otsu binarization, remove page frames (a component that hugs its own bbox and leaves the middle empty — a drawing fills the middle, so it stays), full-width rulers, specks, watermarks sitting on the frame and caption rows, crop, close pinholes. Filled areas (pupils) are found here, kept as polygons and taken out of the traced mask so they do not set the line width.
2. **Skeleton graph** — skeletonize thick lines to a 1-px centerline, build a pixel graph (diagonal links dropped when a 4-connected path exists → no fake junctions), cluster junction pixels into nodes, trace edges, prune short spurs, merge degree-2 chains.
3. **Strokes** — greedy Euler-like walk through junctions along the straightest edge. Pen lifts are reduced by (a) invisible bridges between odd-degree nodes that almost touch (only when they are not already joined by a short path), and (b) printing small details as plain lines per level, re-chaining after each pass so freed junctions let strokes merge. Nearly closed strokes are closed. Dot 1 is placed at the top of the drawing: the stroke through the top-most point goes first (a loop is rotated there; an open stroke is split there into two branches). Then nearest-neighbour stroke ordering. **Objects** (`dotdot/objects.py`) are picked by a **strategy** (`dotdot/strategies.py`), chosen from measured features (`dotdot/features.py`: stroke width, component count, dominance of the largest filled silhouette, similarity classes, cycle rank): `subject` puts the whole drawing in one object, `classes` groups repeated decorations (four leaves = one object) and keeps comparable distant ones apart, `components` treats every connected component as its own object. Nesting (a detail inside a silhouette) and proximity join parts; at most 6 groups, whole similarity classes merge before single components. Each object gets its own colour and its own numbering from 1. `outline` mode keeps the silhouette edges of *every* object as dots, the rest is drawn as plain lines.
4. **Dots** — Ramer–Douglas–Peucker with a per-level tolerance (keeps corners), extra dots on long smooth arcs, minimum spacing, snapping of near-coincident dots shared by several strokes. Closed loops end on their starting dot. In `all` mode the target (20/60/130 dots by level, ceiling 50/300/300) is a **budget shared between strokes** (`dots.allocate`): a stroke that cannot hold `DOT_FLOOR = 5` dots at the level's tolerance is printed as a plain line, the rest are ranked by length and the longest prefix whose share reaches the floor gets the budget. Each admitted stroke spends its share on bends (its own tolerance); a share too big for its bends breaks long arcs instead. What does not fit is printed as lines, and the puzzle sheet says so. `outline` mode keeps one tolerance and one arc step for the whole sheet. In math mode `math_max` caps the numbers inside one object: that object alone is re-allocated, and if even two dots per stroke would not fit, its shortest strokes become plain lines.
5. **Labels** — numbers, per-object letter series (`A1…/B1…`), or math examples (`7+5`, `20−6`, `6×7` for adults; fewer dots in math mode). Numbering: one chain with jumps, per-object colour (default, each object counts from 1), or per-object series; the colour marks dots, labels and answer lines. A dot shared by several numbers gets one combined label (`31/144`). Collision-aware placement on a cost grid (24 directions × 4 distances, crowded dots first): avoids dots, solution segments, plain lines and other labels; a label must be clearly closer to its own dot than to any other. Two refinement passes re-place the worst labels.
6. **Render** — Cairo → PDF (2 pages) + PNG previews, RU/EN texts, Dottie mascot.

## Options

| option | values | default |
|---|---|---|
| `mode` | `auto`, `all`, `outline` — `all` dots as much of the drawing as the budget allows, the rest is printed as lines | `auto` → `outline` for `kid`, `all` otherwise |
| `strategy` | `auto`, `subject`, `classes`, `components` — how the drawing is split into objects | `auto` (by features, echoed in `stats.strategy`) |
| `numbering` | `jumps`, `color`, `series` | `color` |
| `level` | `kid`, `school`, `adult` — styling and the dot-count range (20–60 / 60–300 / 150–300) | `school` |
| `labels` | `numbers`, `math` | `numbers` |
| `math_max` | int 10–999, biggest answer in math mode | `100` |
| `target` | int 10–1000, approximate dot count; empty = the level's ladder | — |
| `lang` | `ru`, `en` | `ru` |
| `seed` | int (math examples) | `1` |

## Run locally

```bash
pip install -r requirements-dev.txt
python -m dotdot.cli samples/among-us.png out/ --level kid --mode outline
pytest -q
```

~0.5–1.4 s per image on one CPU core. `--debug` adds layout quality metrics (overlaps, ambiguous labels, pen lifts) to the stats.

Compare strategies on a folder of drawings by their **answer** sheets — a contact sheet plus recall/precision of the ink they reproduce:

```bash
python -m tools.compare --images /path/to/drawings --out /tmp/dotdot-compare --strategies auto,components,classes,subject
DOTDOT_SAMPLES=/path/to/drawings pytest -q tests/test_real_images.py   # invariants, skipped without the folder
```

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

| `kind` | input | what it does | result |
|---|---|---|---|
| — | `<id>/input.png` | analyse + one sheet at the level's target (CLI, tests) | files + `stats` |
| `analyze` | `<setId>/input.png` | analyse once, write `<setId>/scene.json`, enqueue the variants itself | `{files: {scene}, stats: {contours, strategy, features, dots_min, dots_max, targets, ms, options}, variants: [{id, target}]}` |
| `variant` | `<setId>/scene.json` | dots, labels and sheets for one `options.target` — no image analysis | files + `stats.target` |
| `edit` | `<id>/edit.json` | render a plan the user edited — no image analysis | files + `stats.edited` |

`scene.json` (v1, `dotdot/scene.py`) keeps everything that needs the image: page and image geometry, strokes in page coordinates, plain lines, one colour per object and the achievable dot range `dots_min…dots_max` for this level and label mode. `extra` carries the chosen strategy, its scores, the measured features and the filled polygons, so a variant needs no image work. A broken scene is `BAD_SCENE`.
The plan format lives in `dotdot/plan_io.py`: v2 carries `groups` per line and `colors` per object, v1 is read as one object per line. `solids` is optional (filled areas, ≤64 polygons, written only when non-empty) and is printed as-is on both sheets — no dots, no labels on it. Edits send `groups` alongside `paths`; colours, plain lines and solids stay the parent's. `math_max` is applied at generation only — an edited plan is rendered as the user left it.

### Dot-count ladder

`ladder_targets` gives up to five targets, from `DOT_TARGET` (20 / 60 / 130) up to what the drawing can hold (`scene.dots_max`, clipped by `LEVEL_RANGE`: kid 20–60, school 60–300, adult 150–300). The top is the page's label capacity, not the level's ambition: above ~300 numbers on A4 the labels start to overlap and sit closer to a neighbour's dot than to their own (measured: 0 overlaps at 300 dots, 28 at 550). The step is at least 1.35 and stretches geometrically when the drawing's range is wider, so the top variant dots as much of the drawing as the page can label. `options.target` replaces the ladder with three targets around the user's own number — 0.8T / T / 1.25T, the level range ignored. Every target is clamped to the scene's `dots_min…dots_max`, then duplicates are dropped, and so is a target within 5 % of the previous one: 148 and 150 dots make the same sheet. A simple drawing gets fewer variants, down to one. In math mode the range already accounts for `math_max` per object.

Known failures are raised as non-retryable `CODE: message` (`BAD_IMAGE`, `BAD_OPTIONS`, `BAD_PLAN`, `BAD_SCENE`, `TIMEOUT`, `INPUT_MISSING`).
Images above 40 megapixels are refused before decoding. SIGTERM finishes the current job, then exits.
