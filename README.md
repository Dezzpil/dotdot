# DotDot

Turn line drawings into printable connect-the-dots puzzles.
Превращает чёрно-белые контурные рисунки в «рисунки по точкам» для печати.

> Status: design phase. See [docs/decisions.md](docs/decisions.md).

## Architecture

```
[Caddy] ─┬─ web    Vite + React + TypeScript (static)
         └─ api    NestJS + TypeScript ──► Redis (BullMQ queue, cache, rate limit)
                                              │
                                   worker × N  Python + OpenCV
                                              │
                                   MinIO (S3) — uploads & results, TTL 24h
```

All services run in Docker and are orchestrated with docker compose.

## Layout (planned)

```
apps/web/              frontend
apps/api/              backend
services/dots-worker/  dot-to-dot algorithm
docker-compose.yml
```

## License

MIT
