# DotDot

Turn line drawings into printable connect-the-dots puzzles.
Превращает чёрно-белые контурные рисунки в «рисунки по точкам» для печати.

> Status: MVP is complete — algorithm, API, queue, web UI (RU/EN, light/dark) and a dot editor (move / add / remove / merge dots, cut lines, then rebuild the sheet). One upload gives a shelf of dot-count variants to choose from; contours are coloured per object, each counting from 1. Donate links are set in `.env`. See [docs/decisions.md](docs/decisions.md).

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
- One upload is a set: an `analyze` job reads the drawing once, then enqueues up to five `variant` jobs (dot counts) that render without re-reading the image.
- Backpressure: when more than `MAX_WAITING_JOBS` **queue jobs** wait, new uploads get `429 BUSY` with a friendly text. An upload is up to six jobs, so the default 300 is roughly 50 uploads.
- Same image + same options → cached set (24 h), no CPU spent twice.

## Run

```bash
cp .env.example .env        # set DOMAIN, EMAIL, replicas, donate links
docker compose up -d --build
curl https://$DOMAIN/api/health
```

Open `https://$DOMAIN/` — the web app; `/api/*` goes to the API replicas.
Full step-by-step guide for a fresh server: [Развёртывание на VPS](#развёртывание-на-vps).
Без Docker, под nginx и pm2: [Развёртывание без Docker](#развёртывание-без-docker-nginx-и-pm2).

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
| `MAX_WAITING_JOBS`, `RATE_*` | лимиты от наплыва, значения по умолчанию разумные. `MAX_WAITING_JOBS` считает задачи очереди: одна загрузка — это анализ плюс до 5 вариантов, т.е. 300 ≈ 50 загрузок |

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

## Развёртывание без Docker (nginx и pm2)

Для сервера, где Docker не нужен: API и воркеры под pm2, статика и TLS — nginx + certbot,
очередь — системный Redis. Файлы варианта: `deploy/pm2/`, `deploy/nginx/`, `deploy.sh`.
Docker-путь выше остаётся рабочим и независимым.

```
nginx (80/443, certbot) ──┬─ /       → apps/web/dist
                          └─ /api/*  → 127.0.0.1:3000   pm2 dotdot-api (cluster ×2)
redis-server 127.0.0.1:6379 ── очередь BullMQ ──┤
STORAGE_DIR ── загрузки и результаты, TTL 24 ч ─┴── pm2 dotdot-worker-N (python, по ядру)
```

### 1. Пакеты

Node.js ≥ 22 ([NodeSource](https://github.com/nodesource/distributions)), затем:

```bash
sudo apt install -y git curl ufw redis-server nginx certbot python3-certbot-nginx \
  python3 python3-venv python3-dev build-essential pkg-config libcairo2-dev libcairo2 \
  fonts-dejavu-core gettext-base
sudo npm install -g pm2
```

- `fonts-dejavu-core` обязателен: PDF рендерится шрифтом DejaVu Sans.
- `gettext-base` даёт `envsubst` для nginx-шаблона.
- Caddy не нужен; если стоит — `sudo systemctl disable --now caddy`, иначе он займёт 80/443.

### 2. Пользователь, каталоги, права

```bash
sudo adduser dotdot && sudo usermod -aG sudo dotdot
sudo mkdir -p /var/data/dotdot
sudo chown dotdot:dotdot /var/data/dotdot && sudo chmod 750 /var/data/dotdot
sudo -u dotdot git clone https://github.com/Dezzpil/dotdot.git /home/dotdot/app

# nginx (www-data) должен пройти в домашний каталог к dist, иначе 403
sudo chmod o+x /home/dotdot
```

Клон может лежать где угодно: `deploy.sh` и `deploy/pm2/*` выводят пути из своего расположения,
переопределение — `DOTDOT_APP_DIR` и `DOTDOT_ENV_FILE`. Каталог данных задаётся `STORAGE_DIR` в `.env`.

### 3. .env

```bash
cd /home/dotdot/app
cp deploy/pm2/env.example .env && chmod 600 .env
nano .env
```

Сам проект `.env` не читает: файл подгружают два загрузчика — `node --env-file` (API) и
bash `source` (воркер). Bash строже, поэтому: комментарии только отдельными строками,
без пробелов вокруг `=`, значения с `&` или пробелами — в двойных кавычках, с `$` — в одинарных.
`deploy.sh` проверяет формат и не даст задеплоить файл, который bash прочитает иначе.

Переменные docker-compose (`DOMAIN`, `EMAIL`, `*_REPLICAS`) здесь не нужны: домен — в nginx,
число процессов — в `deploy/pm2/ecosystem.config.cjs` (`DOTDOT_API_INSTANCES`, `DOTDOT_WORKERS`).
`TRUST_PROXY=1` для одного nginx, `2` для Cloudflare перед ним. `CORS_ORIGINS` не нужен:
сайт и API на одном домене.

### 4. Redis

В `/etc/redis/redis.conf` — BullMQ требует `noeviction`, AOF сохраняет очередь при перезапуске:

```conf
bind 127.0.0.1 ::1
protected-mode yes
appendonly yes
save ""                     # штатные строки save ... закомментировать
maxmemory 256mb
maxmemory-policy noeviction
```

```bash
sudo systemctl enable --now redis-server && sudo systemctl restart redis-server
redis-cli config get maxmemory-policy    # noeviction
```

### 5. Первый запуск

```bash
./deploy.sh          # зависимости, сборка API и web, venv воркера, pm2, health-check
pm2 ls
pm2 startup          # выполните напечатанную команду с sudo: юнит для самого pm2
pm2 save
```

`deploy.sh` создаёт venv, если его нет, и падает с понятной ошибкой, если не хватает пакетов,
pm2 или прав на `STORAGE_DIR`. Воркеров по умолчанию 2 (`DOTDOT_WORKERS`, правило: `nproc - 1`,
каждому по ядру), API — 2 cluster-инстанса на одном порту (`DOTDOT_API_INSTANCES`).

### 6. nginx и TLS

```bash
./deploy.sh --nginx --domain dotdot.example.ru    # рендер шаблона, nginx -t, reload
sudo certbot --nginx -d dotdot.example.ru --redirect -m you@example.com --agree-tos
```

Шаблон `deploy/nginx/dotdot.conf.template` устанавливается в `/etc/nginx/sites-available/dotdot`.
Правьте шаблон, а не установленный файл. В нём уже есть `client_max_body_size`
(`MAX_UPLOAD_MB + 1`), `proxy_buffering off` и долгие таймауты для SSE, кеширование `/assets/*`
и SPA-fallback.

certbot дописывает TLS прямо в установленный файл, поэтому повторный `--nginx` после certbot
откажется его затирать: положит рядом `dotdot.conf.candidate` и подскажет команду для сравнения.
Обычный `./deploy.sh` nginx не трогает.

### 7. Файрвол

API слушает `0.0.0.0:3000` (так задано в `apps/api/src/main.ts`), снаружи порт закрывает ufw:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
sudo ufw status verbose      # Default: deny (incoming)
```

Проверять надо **с другой машины**: `nc -vz -w 5 <IP> 3000` должен дать таймаут.
`curl` с сервера на собственный публичный IP ничего не проверяет: ядро маршрутизирует такой
пакет через loopback (`ip route get <IP>` → `local ... dev lo`), а ufw безусловно разрешает `lo`
в `/etc/ufw/before.rules`.

### 8. Деплой и обслуживание

```bash
git pull && ./deploy.sh       # полный: зависимости, сборка, перезапуск, health-check
./deploy.sh --no-deps         # только пересборка и перезапуск
./deploy.sh --dry-run         # показать команды, ничего не выполнять

pm2 ls && pm2 monit
pm2 logs --lines 50
pm2 logs dotdot-api --err
pm2 install pm2-logrotate     # по желанию

# больше воркеров; при уменьшении лишние удалите: pm2 delete dotdot-worker-3
DOTDOT_WORKERS=3 ./deploy.sh --no-deps
```

API перезапускается через `pm2 reload` в cluster-режиме — без простоя. Воркеры по SIGINT
дорабатывают текущую задачу: `kill_timeout: 70000` больше `JOB_TIMEOUT_SEC=60`.

Бэкапить нужно только `.env` и nginx-конфиг: загрузки и результаты живут 24 часа, удаляет их
сам API (CleanupService с Redis-локом, лишние реплики не мешают). Очередь переживает перезапуск
в AOF Redis.

### Если что-то не так

| Симптом | Что проверить |
|---|---|
| 403 на `/` | `sudo chmod o+x /home/dotdot`; `sudo -u www-data cat /home/dotdot/app/apps/web/dist/index.html` |
| 502 на `/api/*` | `pm2 ls`, `pm2 logs dotdot-api --err`, `curl -s 127.0.0.1:3000/api/health` |
| `deploy.sh` ругается на `.env` | inline-комментарии или незакавыченные `&`, `$`: bash прочитает значение иначе, чем Node |
| Задачи висят в `queued` | `pm2 logs dotdot-worker-1`; `QUEUE_NAME`/`QUEUE_PREFIX` совпадают у API и воркера; `maxmemory-policy=noeviction` |
| Воркер падает при старте | `bash deploy/pm2/run-worker.sh` руками: обычно нет venv или `libcairo2` |
| PDF без текста | `fc-list \| grep -i dejavu` — нужен `fonts-dejavu-core` |
| Статус задачи приходит только в конце | `proxy_buffering off` в nginx |
| 413 на загрузке | `client_max_body_size` меньше `MAX_UPLOAD_MB + 1` |
| Воркеры мешают друг другу | `OMP/OPENBLAS/MKL_NUM_THREADS=1` в ecosystem |
| Все пользователи — один IP, общий лимит | `TRUST_PROXY`: 1 для nginx, 2 для Cloudflare → nginx |
| После перезагрузки ничего не поднялось | не выполнены `pm2 startup` и `pm2 save` |
| Порт 3000 виден снаружи | `sudo ufw status` — active, default deny incoming |

## Develop locally

```bash
# Redis
docker run -d -p 6379:6379 redis:7.4-alpine
# worker
cd services/dots-worker && pip install -r requirements.txt && python -m dotdot.worker
# API on :3000
cd apps/api && npm ci && npm run build && npm start
# web on :5173, proxies /api to the API
cd apps/web && npm ci && npm run dev
```

## Tests

| Part | Command | Count |
|---|---|---|
| worker | `cd services/dots-worker && python -m pytest` | 121 |
| API | `cd apps/api && npm test`, `TEST_REDIS_URL=redis://localhost:6379 npm run test:e2e` | 10 + 9 |
| web | `cd apps/web && npm test` | 45 |

## Layout

```
apps/api/              NestJS API          → apps/api/README.md
services/dots-worker/  algorithm + worker  → services/dots-worker/README.md
apps/web/              web UI              → apps/web/README.md
deploy/Caddyfile       reverse proxy (Docker)
deploy/pm2/            ecosystem, run-worker.sh, env.example (без Docker)
deploy/nginx/          dotdot.conf.template (без Docker)
deploy.sh              деплой без Docker: сборка + pm2
docker-compose.yml
```

## Local load check

40 different uploads at once (the sample drawing at 40 sizes, `school`, numbers), two workers limited
to 1 CPU each, API and Redis local: all accepted in 0.08 s, all 40 sets — 160 sheets — finished in 20 s
(~2 sets/s, ~8 sheets/s), no processing errors. Queue wait p50 1.3 s / p95 2.1 s; the first sheet of a set
p50 11 s, the whole set p50 12 s / p95 20 s; peak queue 157 jobs. Per job: analysis ~0.11 s, a variant
render ~0.21 s (it does not read the image again).

So a set of four variants costs about 1 s of CPU — roughly three single sheets, not five: the analysis
is shared and a variant never reads the image again.
`MAX_WAITING_JOBS=300` counts queue jobs, i.e. about 50 uploads. The per-IP create limits stay at
10/min and 60/h: ten uploads a minute is ~60 jobs, an eighth of what two workers deliver.

## License

MIT
