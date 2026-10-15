# DotDot web

Vite + React 19 + TypeScript. One small single-page app, no UI framework, no tracking.

## Screens

1. **Start** — Dottie, three steps, drop zone (drag & drop, file picker, Ctrl+V paste), sample fish.
2. **Setup** — preview, three levels (kid / school / adult), "fine tuning": what becomes dots, numbering, labels, sheet language.
3. **Waiting** — place in queue, progress, a star that draws itself, little facts.
4. **Done** — puzzle / answer tabs (tap to open full size), dots and lines count, PDF download, "another level" with the same picture, donate card.
5. **Editor** (`#/job/<id>/edit`) — tools Move / Add (tap on a line) / Remove, undo-redo (Ctrl+Z, Ctrl+Shift+Z), arrows nudge, Delete removes, "make it first" for line ends and closed loops, zoom 100–400 % with pan, the original drawing as an underlay, numbers on/off, "as it was", "build the sheet" → a new job marked "your edited version". Touch drag works; on phones dense sheets start without numbers.
6. **Oops** — a friendly text for every API error code, a way back.

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
