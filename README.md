# DotDot

Turn line drawings into printable connect-the-dots puzzles.
Превращает чёрно-белые контурные рисунки в «рисунки по точкам» для печати.

> Status: MVP is complete — algorithm, API, queue and web UI (RU/EN, light/dark). Donate links are set in `.env`. See [docs/decisions.md](docs/decisions.md).

## Architecture

```
            ┌─ web      Vite + React + TypeScript (static, served by Caddy)
[Caddy] ────┤
 TLS, LB    └─ api × N  NestJS 12 + TypeScript ──► Redis (BullMQ queue, cache, rate limits)
                │                                     │
                └──────── shared volume /data ────── worker × N  Python + OpenCV + Cairo
                          uploads & results, TTL 24h
```

- API replicas are stateless; Caddy balances them (`least_conn`) and streams SSE.
- Workers are CPU-bound: one job per container, one core each. Scale with `WORKER_REPLICAS`.
- Backpressure: when more than `MAX_WAITING_JOBS` wait, new uploads get `429 BUSY` with a friendly text.
- Same image + same options → cached result (24 h), no CPU spent twice.

## Run

```bash
cp .env.example .env        # set DOMAIN, EMAIL, replicas, donate links
docker compose up -d --build
curl https://$DOMAIN/api/health
```

Open `https://$DOMAIN/` — the web app; `/api/*` goes to the API replicas.

Scale on the fly: `docker compose up -d --scale worker=4 --scale api=3`.

## Develop locally

```bash
# Redis
docker run -d -p 6379:6379 redis:7.4-alpine
# worker
cd services/dots-worker && pip install -r requirements.txt && python -m dotdot.worker
# API on :3000
cd apps/api && npm ci && npm run start:dev
# web on :5173, proxies /api to the API
cd apps/web && npm ci && npm run dev
```

## Tests

| Part | Command | Count |
|---|---|---|
| worker | `cd services/dots-worker && python -m pytest` | 56 |
| API | `cd apps/api && npm test`, `TEST_REDIS_URL=redis://localhost:6379 npm run test:e2e` | 7 + 6 |
| web | `cd apps/web && npm test` | 11 |

## Layout

```
apps/api/              NestJS API          → apps/api/README.md
services/dots-worker/  algorithm + worker  → services/dots-worker/README.md
apps/web/              web UI              → apps/web/README.md
deploy/Caddyfile       reverse proxy
docker-compose.yml
```

## Local load check

40 different uploads at once, 2 workers on a laptop-class CPU: all accepted in 0.5 s,
all processed in 27 s (~1.5 drawings/s), p50 wait 17 s, p95 26 s, no processing errors.

## License

MIT
