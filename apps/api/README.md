# DotDot API

NestJS 12 (ESM) + TypeScript, BullMQ 6 on Redis. Node.js ≥ 22.

## Endpoints

| Method | Path | What |
|---|---|---|
| POST | `/api/jobs` | multipart: `file` (PNG/JPEG/WebP/BMP/GIF, ≤ 10 MB) + optional `mode` (auto/all/outline), `strategy` (auto/subject/classes/components — how the drawing is split into objects), `numbering` (jumps/color/series), `level` (kid/school/adult), `labels` (numbers/math), `math_max` (10–999, biggest answer in math mode), `target` (10–1000, approximate dot count), `lang` (ru/en). → `202 JobView` of a **set**: the analysis job, its `result.variants` are the sheets to choose from |
| GET | `/api/jobs/:id` | `JobView`: `status` queued/processing/done/failed, `position`, `progress`, `parent` (the set a variant or an edit belongs to), `result`, `error` |
| GET | `/api/jobs/:id/events` | SSE: `job` event with `JobView` on every change, `ping` every 15 s; closes on done/failed — for a set, when every variant is final |
| POST | `/api/jobs/:id/edit` | JSON `{dots: [[x,y]], paths: [[ids]], groups: [g], numbering?, labels?, lang?}` — the edited plan of a finished job (≤ 1500 dots, 500 paths). `groups` names a colour per line; lines, page, colours and filled areas come from the parent; no image analysis, the sheet is re-rendered in < 1 s. → `202 JobView` of a new job (`stats.edited = true`) |
| GET | `/api/jobs/:id/files/{dotdot.pdf,puzzle.png,answer.png,plan.json,source}` | result files (`409 NOT_READY` until done). `plan.json` is the editable plan, `source` the uploaded image (editor underlay). JSON is served `no-cache` |
| GET | `/api/config` | limits, option values, defaults, donate links — for the web app |
| GET | `/api/health` | Redis, storage, queue counts (`503` if unhealthy) |

Errors are always `{"error": {"code", "message", ...}}`; codes: `NO_FILE`, `FILE_TOO_LARGE`,
`UNSUPPORTED_TYPE`, `BAD_OPTIONS`, `BAD_IMAGE`, `BAD_PLAN` (edit: invalid or too big plan, or the parent has no plan), `BAD_SCENE` (a variant lost its set's scene), `BUSY`, `RATE_LIMITED` (+ `Retry-After`),
`NOT_FOUND`, `NOT_READY`, `TIMEOUT`, `INTERNAL`. The web app maps codes to friendly RU/EN texts.

## Sets and variants

One upload is a set of sheets, not one sheet:

1. `POST /api/jobs` enqueues a single `analyze` job and returns its id — the set id.
2. The worker analyses the drawing once, writes `scene.json` and enqueues the variants itself (up to five, or three around `target`). Their ids and dot-count targets come back in the set's `result.variants`, together with `stats.contours` and the achievable range `stats.dots_min…dots_max`.
3. Each variant is a job of its own with `parent = <setId>`: it renders from the scene without touching the image, so it has its own status, progress, files and errors. One variant failing does not touch the others.
4. `result.variants[i].result` is a full `JobResultView` (files + stats) once that variant is done; the set itself has no PDF.

The cache key is still `sha256(file + options)`, now pointing at the set: the same drawing with the same options returns the same set with its ready sheets. `MAX_WAITING_JOBS` counts **queue jobs**, and an upload is up to six of them (1 analysis + 5 variants).

## Environment

| Var | Default | |
|---|---|---|
| `PORT` | 3000 | |
| `REDIS_URL` | redis://localhost:6379 | |
| `QUEUE_NAME` / `QUEUE_PREFIX` | dots / dotdot | must match the worker |
| `STORAGE_DIR` | /data | volume shared with workers |
| `MAX_UPLOAD_MB` | 10 | |
| `MAX_WAITING_JOBS` | 300 | backpressure threshold, in queue jobs (one upload = up to 6) |
| `RESULT_TTL_SEC` | 86400 | jobs and files are removed after it |
| `JOB_ATTEMPTS` | 2 | retries for unexpected errors only |
| `TRUST_PROXY` | 1 | proxies in front (Caddy = 1, Cloudflare + Caddy = 2) |
| `RATE_CREATE_PER_MIN` / `_PER_HOUR` | 10 / 60 | per IP, shared across replicas |
| `RATE_READ_PER_MIN` | 300 | |
| `CORS_ORIGINS` | — | comma-separated, or `*` for any origin; not needed behind one domain |
| `DONATE_CLOUDTIPS_URL`, `DONATE_BOOSTY_URL`, `DONATE_KOFI_URL` | — | shown by the web app |

## Develop

```bash
npm ci
npm run build && REDIS_URL=redis://localhost:6379 STORAGE_DIR=/tmp/dd npm start
npm test                                            # unit (Vitest + SWC)
TEST_REDIS_URL=redis://localhost:6379 npm run test:e2e   # real Redis + real Python worker
```
