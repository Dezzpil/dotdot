# DotDot

Turn line drawings into printable connect-the-dots puzzles.
Превращает чёрно-белые контурные рисунки в «рисунки по точкам» для печати.

> Status: MVP is complete — algorithm, API, queue, web UI (RU/EN, light/dark) and a dot editor (move / add / remove / merge dots, cut lines, then rebuild the sheet). Donate links are set in `.env`. See [docs/decisions.md](docs/decisions.md).

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
Full step-by-step guide for a fresh server: [Развёртывание на VPS](#развёртывание-на-vps).

## Развёртывание на VPS

Пошагово, от чистого сервера до работающего сайта с HTTPS. Команды — для Ubuntu 22.04 / 24.04 / 26.04 или Debian 12+.

### 1. Сервер

| | Минимум | Рекомендуется |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 ГБ + swap 2 ГБ | 4 ГБ |
| Диск | 20 ГБ SSD | 40 ГБ SSD |

Память по лимитам из `docker-compose.yml`: API 256 МБ × 2, воркер 768 МБ × 2, Redis до 256 МБ, Caddy и web — мелочь.
Итого около 2,5 ГБ при настройках по умолчанию. Один воркер занимает одно ядро:
на 4 vCPU разумно `WORKER_REPLICAS=3`, на 2 vCPU — `1`–`2`.

Нужен домен (или поддомен), например `dotdot.example.ru`.

### 2. DNS

У регистратора домена создайте запись:

```
dotdot.example.ru.   A      <IPv4 сервера>
dotdot.example.ru.   AAAA   <IPv6 сервера>   # если есть
```

Проверьте, что запись уже видна, — без неё Caddy не получит сертификат:

```bash
dig +short dotdot.example.ru
```

### 3. Первичная настройка

```bash
ssh root@<IP>
apt update && apt upgrade -y
apt install -y git curl ufw

# отдельный пользователь вместо root
adduser dotdot
usermod -aG sudo dotdot

# swap, если RAM 2 ГБ: сборка образов и пики нагрузки переживут спокойнее
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Файрвол: снаружи нужны только SSH, 80 и 443 (TCP и UDP — для HTTP/3).

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable
```

> Docker публикует порты в обход правил `ufw` ([документация Docker](https://docs.docker.com/engine/install/ubuntu/)).
> Поэтому в `docker-compose.yml` наружу открыт только Caddy (80/443); Redis, API, воркеры и web доступны лишь во внутренней сети Compose.
> Не добавляйте `ports:` другим сервисам.

### 4. Docker

Официальный репозиторий Docker ([инструкция для Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [для Debian](https://docs.docker.com/engine/install/debian/) — там замените `ubuntu` на `debian` в адресах):

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# запуск docker без sudo (перелогиньтесь после этой команды)
sudo usermod -aG docker dotdot
sudo systemctl enable --now docker
```

Проверка: `docker compose version` — нужна v2.

Если образы с Docker Hub не скачиваются (бывает у некоторых провайдеров), добавьте зеркало и перезапустите Docker:

```bash
echo '{ "registry-mirrors": ["https://mirror.gcr.io"] }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

### 5. Код и настройки

```bash
su - dotdot
git clone https://github.com/Dezzpil/dotdot.git
cd dotdot
cp .env.example .env
nano .env
```

Что заполнить в `.env`:

| Переменная | Значение |
|---|---|
| `DOMAIN` | ваш домен, например `dotdot.example.ru` (без `https://`) |
| `EMAIL` | почта для уведомлений Let's Encrypt |
| `API_REPLICAS` | `2` хватает надолго: API почти не тратит CPU |
| `WORKER_REPLICAS` | число ядер минус одно |
| `TRUST_PROXY` | `1` — пользователи приходят прямо в Caddy; `2` — если перед сервером Cloudflare |
| `DONATE_CLOUDTIPS_URL` | ссылка на страницу CloudTips; пусто — кнопка не показывается |
| `DONATE_BOOSTY_URL`, `DONATE_KOFI_URL` | по желанию |
| `MAX_WAITING_JOBS`, `RATE_*` | лимиты от наплыва, значения по умолчанию разумные |

`CORS_ORIGINS` не нужен: сайт и API живут на одном домене.

### 6. Запуск

```bash
docker compose up -d --build     # первая сборка — 5–10 минут
docker compose ps                # все сервисы running / healthy
curl -s https://dotdot.example.ru/api/health
# {"ok":true,"redis":true,"storage":true,"queue":{...}}
```

Откройте `https://dotdot.example.ru/` и попробуйте «рыбку».
Сертификат Caddy получает и продлевает сам; первые секунды после запуска сайт может отвечать ошибкой TLS — это нормально.

Контейнеры с `restart: unless-stopped` поднимутся сами после перезагрузки сервера.

### 7. Обслуживание

```bash
# логи
docker compose logs -f --tail=100 api worker
docker compose logs caddy | grep -i certificate

# очередь и здоровье
curl -s https://dotdot.example.ru/api/health

# больше воркеров на лету (например, при наплыве)
docker compose up -d --scale worker=4

# обновление до свежей версии
git pull
docker compose up -d --build
docker image prune -f

# остановка
docker compose down              # данные в томах сохранятся
```

Бэкапы почти не нужны: загруженные рисунки и результаты живут 24 часа и удаляются сами.
Сохраните только `.env`. Redis хранит очередь в AOF (том `redis-data`), так что задачи переживают перезапуск.

### 8. Cloudflare (по желанию)

Если включить проксирование через Cloudflare (оранжевое облако):

- `TRUST_PROXY=2` в `.env`, иначе все пользователи будут выглядеть одним IP и упрутся в общий лимит;
- SSL/TLS → **Full (strict)**;
- лимит тела запроса на бесплатном плане — 100 МБ, нашим 10 МБ это не мешает.

### Если что-то не так

| Симптом | Что проверить |
|---|---|
| Сайт не открывается, ошибка TLS | `dig +short $DOMAIN` указывает на сервер? порты 80/443 открыты у провайдера и в `ufw`? `docker compose logs caddy` |
| Рисунок долго «в очереди» | `docker compose ps worker` — воркеры запущены? `docker compose logs worker` |
| «Слишком много рисунков» | очередь длиннее `MAX_WAITING_JOBS` — добавьте воркеров |
| Сборка падает по памяти | включите swap (шаг 3) или соберите сервисы по одному: `docker compose build worker` |
| Кнопки донатов нет | пустые `DONATE_*` в `.env`; после правки — `docker compose up -d api` |

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
| worker | `cd services/dots-worker && python -m pytest` | 69 |
| API | `cd apps/api && npm test`, `TEST_REDIS_URL=redis://localhost:6379 npm run test:e2e` | 9 + 7 |
| web | `cd apps/web && npm test` | 32 |

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
