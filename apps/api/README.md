# DotDot API

NestJS 12 (ESM) + TypeScript, BullMQ 6 on Redis. Node.js ≥ 22.

## Endpoints

| Method | Path | What |
|---|---|---|
| POST | `/api/jobs` | multipart: `file` (PNG/JPEG/WebP/BMP/GIF, ≤ 10 MB) + optional `mode` (auto/all/outline), `numbering` (jumps/series), `level` (kid/school/adult), `labels` (numbers/math), `lang` (ru/en). → `202 JobView` |
| GET | `/api/jobs/:id` | `JobView`: `status` queued/processing/done/failed, `position`, `progress`, `result`, `error` |
| GET | `/api/jobs/:id/events` | SSE: `job` event with `JobView` on every change, `ping` every 15 s; closes on done/failed |
| GET | `/api/jobs/:id/files/{dotdot.pdf,puzzle.png,answer.png}` | result files (`409 NOT_READY` until done) |
| GET | `/api/config` | limits, option values, defaults, donate links — for the web app |
| GET | `/api/health` | Redis, storage, queue counts (`503` if unhealthy) |

Errors are always `{"error": {"code", "message", ...}}`; codes: `NO_FILE`, `FILE_TOO_LARGE`,
`UNSUPPORTED_TYPE`, `BAD_OPTIONS`, `BAD_IMAGE`, `BUSY`, `RATE_LIMITED` (+ `Retry-After`),
`NOT_FOUND`, `NOT_READY`, `TIMEOUT`, `INTERNAL`. The web app maps codes to friendly RU/EN texts.

## Environment

| Var | Default | |
|---|---|---|
| `PORT` | 3000 | |
| `REDIS_URL` | redis://localhost:6379 | |
| `QUEUE_NAME` / `QUEUE_PREFIX` | dots / dotdot | must match the worker |
| `STORAGE_DIR` | /data | volume shared with workers |
| `MAX_UPLOAD_MB` | 10 | |
| `MAX_WAITING_JOBS` | 300 | backpressure threshold |
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
