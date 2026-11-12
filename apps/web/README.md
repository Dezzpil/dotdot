# DotDot web

Vite + React 19 + TypeScript. One small single-page app, no UI framework, no tracking.

## Screens

1. **Start** — Dottie, three steps, drop zone (drag & drop, file picker, Ctrl+V paste), sample fish.
2. **Setup** — preview, three levels (kid / school / adult), "fine tuning": approximate dot count (empty = the ladder picked for the level), what becomes dots, numbering (one chain / per-contour colour / letter series), labels, the answer limit for math examples, sheet language.
3. **Waiting** — place in queue, progress, a star that draws itself, little facts.
4. **Pick a sheet** (`#/job/<setId>`) — a shelf of cards, one per dot-count variant: preview, dot count (the target while it is still counting), a badge ("just right for the level" / "your number"), status queued / counting / ready / failed. Cards fill in as they are finished and can be opened right away; a failed variant shows its own text and does not block the others. The header carries the drawing, "N of M ready", the dot range and the number of contours.
5. **Done** (`#/job/<variantId>`) — puzzle / answer tabs (tap to open full size), dots, lines and contours count, PDF download, "another variant" back to the shelf, "another level" with the same picture, donate card.
6. **Editor** (`#/job/<id>/edit`) — tools Move / Add (tap on a line) / Remove / Merge (tap two dots: ends of two lines join into one, ends of one line close it, other dots become one dot with two numbers — "split apart" undoes that) / Cut (tap a segment: the line breaks there, the rest becomes a new line with a ring; a loop opens), undo-redo (Ctrl+Z, Ctrl+Shift+Z), arrows nudge, Delete removes, "make it first" for line ends and closed loops, zoom 100–400 % with pan, the original drawing as an underlay, numbers on/off, "as it was", "build the sheet" → a new job marked "your edited version". Touch drag works; on phones dense sheets start without numbers. Every contour keeps its colour on lines, dots and labels through all edits; the selected dot stays orange — that is the selection, not the contour colour.
7. **Oops** — a friendly text for every API error code, a way back.

The job lives in the URL (`#/job/<id>`), so a reload or a shared link reopens it for 24 h.
Nothing is stored in the browser: no cookies, no localStorage.

## Run

```bash
npm ci
API_URL=http://localhost:3000 npm run dev   # proxies /api to the API
npm test                                     # Vitest + Testing Library (happy-dom)
npm run build                                # dist/
```

`VITE_API_BASE` (build time) puts the API on another origin; empty by default — same origin, `/api`.

## Docker

`Dockerfile` builds the app and serves `dist/` with Caddy on `:8080`:
hashed `/assets/*` are cached for a year, everything else is `no-cache`, unknown paths fall back to `index.html`.
The edge Caddy (`deploy/Caddyfile`) proxies `/api/*` to the API and the rest here.
