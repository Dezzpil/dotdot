#!/usr/bin/env bash
# Запускальщик воркера для pm2: подгружает .env и через exec передаёт управление python,
# чтобы SIGINT/SIGTERM от pm2 доходил до воркера и тот доработал текущую задачу.
set -euo pipefail

APP_DIR="${DOTDOT_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${DOTDOT_ENV_FILE:-$APP_DIR/.env}"
WORKER_DIR="$APP_DIR/services/dots-worker"

[ -f "$ENV_FILE" ] || { echo "run-worker: нет $ENV_FILE" >&2; exit 1; }
[ -x "$WORKER_DIR/.venv/bin/python" ] || {
  echo "run-worker: нет $WORKER_DIR/.venv — выполните ./deploy.sh" >&2
  exit 1
}

cd "$WORKER_DIR"
set -a
. "$ENV_FILE"
set +a
exec "$WORKER_DIR/.venv/bin/python" -m dotdot.worker