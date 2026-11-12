#!/usr/bin/env bash
# Деплой DotDot без Docker: сборка API и web, зависимости воркера, перезапуск pm2.
# Запускать после git pull от пользователя, под которым работает pm2 (обычно dotdot).
#
#   ./deploy.sh                            # сборка + перезапуск pm2 + health-check
#   ./deploy.sh --no-deps                  # только пересборка: зависимости не менялись
#   ./deploy.sh --nginx --domain example.ru  # заодно установить nginx-конфиг (нужен sudo)
#   ./deploy.sh --dry-run                  # показать команды, ничего не выполнять
#
# Пути: DOTDOT_APP_DIR (по умолчанию — корень клона), DOTDOT_ENV_FILE (по умолчанию $APP_DIR/.env).
set -euo pipefail

APP_DIR="${DOTDOT_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
ENV_FILE="${DOTDOT_ENV_FILE:-$APP_DIR/.env}"
NGINX_CONF=/etc/nginx/sites-available/dotdot
NGINX_LINK=/etc/nginx/sites-enabled/dotdot

DRY_RUN=0
NO_DEPS=0
WITH_NGINX=0
DOMAIN="${DOTDOT_DOMAIN:-}"

usage() {
  cat <<'EOF'
Использование: ./deploy.sh [опции]

  --dry-run          показать команды, ничего не выполнять
  --no-deps          не ставить зависимости (npm ci / pip), только пересборка и перезапуск
  --nginx            установить nginx-конфиг из deploy/nginx/dotdot.conf.template (sudo)
  --domain ИМЯ       домен для --nginx (или переменная DOTDOT_DOMAIN)
  -h, --help         эта справка

Переменные: DOTDOT_APP_DIR, DOTDOT_ENV_FILE, DOTDOT_DOMAIN,
            DOTDOT_API_INSTANCES (cluster-инстансы API), DOTDOT_WORKERS (число воркеров).
EOF
}

log() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() { printf '\nОшибка: %s\n' "$*" >&2; exit 1; }
run() { if ((DRY_RUN)); then printf '  + %s\n' "$*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --no-deps) NO_DEPS=1 ;;
    --nginx) WITH_NGINX=1 ;;
    --domain) DOMAIN="${2:?--domain требует значение}"; shift ;;
    --domain=*) DOMAIN="${1#*=}" ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "неизвестный аргумент: $1" ;;
  esac
  shift
done

# .env читают и node --env-file, и bash source. Bash молча ломает значения
# с inline-комментариями и незакавыченными метасимволами — не даём такому файлу задеплоиться.
check_env_format() {
  local bad
  bad=$(grep -nE '^[A-Za-z_][A-Za-z0-9_]*=[^#"]*#' "$ENV_FILE" || true)
  [ -z "$bad" ] || die "inline-комментарии в .env: bash положит их в значение, настройка молча не применится.
$bad
Перенесите пояснения на отдельные строки."

  bad=$(grep -nE '^[A-Za-z_][A-Za-z0-9_]*=[^"&;|<>`$]*[&;|<>`$]' "$ENV_FILE" || true)
  [ -z "$bad" ] || die "незакавыченные shell-метасимволы в .env: bash оборвёт или раскроет значение.
$bad
Заключите значение в двойные кавычки, а если внутри есть \$ — в одинарные."
}

preflight() {
  command -v node >/dev/null 2>&1 || die "нет node: нужен Node.js >= 22"
  local major
  major=$(node -p 'process.versions.node.split(".")[0]')
  ((major >= 22)) || die "Node.js $major, нужен >= 22"
  command -v python3 >/dev/null 2>&1 || die "нет python3"
  command -v curl >/dev/null 2>&1 || die "нет curl"
  command -v pm2 >/dev/null 2>&1 || die "нет pm2: sudo npm install -g pm2"
  if [ ! -d "$STORAGE_DIR" ] || [ ! -w "$STORAGE_DIR" ]; then
    die "$STORAGE_DIR не существует или недоступен на запись. Создайте:
  sudo mkdir -p $STORAGE_DIR && sudo chown $(id -un):$(id -gn) $STORAGE_DIR && sudo chmod 750 $STORAGE_DIR"
  fi
}

install_nginx() {
  command -v envsubst >/dev/null 2>&1 || die "нет envsubst: sudo apt install gettext-base"
  command -v nginx >/dev/null 2>&1 || die "нет nginx: sudo apt install nginx"
  [ -n "$DOMAIN" ] || die "--nginx требует --domain ИМЯ (или DOTDOT_DOMAIN)"

  local body_limit tmp candidate backup=""
  body_limit="$((${MAX_UPLOAD_MB:-10} + 1))m"
  tmp=$(mktemp)
  export DOMAIN APP_DIR PORT BODY_LIMIT="$body_limit"
  envsubst '${DOMAIN} ${APP_DIR} ${PORT} ${BODY_LIMIT}' \
    <"$APP_DIR/deploy/nginx/dotdot.conf.template" >"$tmp"

  # certbot дописывает TLS прямо в установленный файл — шаблон его затрёт
  if ! ((DRY_RUN)) && sudo test -f "$NGINX_CONF" && sudo grep -q ssl_certificate "$NGINX_CONF"; then
    candidate="$NGINX_CONF.candidate"
    sudo install -m 644 "$tmp" "$candidate"
    rm -f "$tmp"
    die "в $NGINX_CONF уже настроен TLS (certbot), перезаписывать нельзя.
Свежий вариант шаблона: $candidate
Сравните и перените правки вручную: sudo diff -u $NGINX_CONF $candidate"
  fi

  if ! ((DRY_RUN)) && sudo test -f "$NGINX_CONF"; then
    backup="$NGINX_CONF.bak.$(date +%Y%m%d%H%M%S)"
    run sudo cp -a "$NGINX_CONF" "$backup"
  fi
  run sudo install -m 644 "$tmp" "$NGINX_CONF"
  rm -f "$tmp"
  if ((DRY_RUN)); then
    printf '  + sudo ln -s %s %s (если симлинка нет)\n' "$NGINX_CONF" "$NGINX_LINK"
  else
    sudo test -e "$NGINX_LINK" || sudo ln -s "$NGINX_CONF" "$NGINX_LINK"
  fi

  if ! run sudo nginx -t; then
    [ -z "$backup" ] || run sudo cp -a "$backup" "$NGINX_CONF"
    die "nginx -t не прошёл; прежний конфиг возвращён, reload не выполнялся"
  fi
  run sudo systemctl reload nginx
  info "nginx: $NGINX_CONF (домен $DOMAIN, тело запроса до $body_limit)"
}

[ -f "$ENV_FILE" ] || die "нет $ENV_FILE. Создайте: cp $APP_DIR/deploy/pm2/env.example $ENV_FILE"
check_env_format
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
[ -n "${STORAGE_DIR:-}" ] || die "в .env не задан STORAGE_DIR (общий каталог API и воркеров)"
PORT="${PORT:-3000}"

log "Деплой $APP_DIR"
info "env: $ENV_FILE, storage: $STORAGE_DIR, порт API: $PORT"
if ((DRY_RUN)); then
  info "dry-run: проверки окружения пропущены"
else
  preflight
fi

if ((WITH_NGINX)); then
  log "nginx"
  install_nginx
fi

log "API: сборка"
(
  cd "$APP_DIR/apps/api"
  ((NO_DEPS)) || run npm ci --no-audit --no-fund
  run npm run build
  ((NO_DEPS)) || run npm prune --omit=dev
)

log "Web: статика"
(
  cd "$APP_DIR/apps/web"
  ((NO_DEPS)) || run npm ci --no-audit --no-fund
  run npm run build
)

log "Воркер: venv и зависимости"
VENV="$APP_DIR/services/dots-worker/.venv"
[ -x "$VENV/bin/python" ] || run python3 -m venv "$VENV"
if ((NO_DEPS)); then
  info "--no-deps: пропускаю pip install"
else
  (cd "$APP_DIR/services/dots-worker" && run "$VENV/bin/pip" install --quiet -r requirements.txt)
fi

log "pm2: перезапуск"
run pm2 startOrReload "$APP_DIR/deploy/pm2/ecosystem.config.cjs" --update-env
run pm2 save

if ((DRY_RUN)); then
  log "dry-run: ничего не выполнялось"
  exit 0
fi

log "Проверка"
health=""
for _ in {1..20}; do
  if health=$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null); then break; fi
  sleep 1
done
[ -n "$health" ] || die "API не ответил на http://127.0.0.1:$PORT/api/health — смотрите: pm2 logs dotdot-api --err"
info "$health"
case "$health" in
  *'"ok":true'*) ;;
  *) die "API нездоров: $health" ;;
esac

log "Готово ($(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo 'без git'))"
info "логи: pm2 logs | статус: pm2 ls | сайт: https://$DOMAIN/ (домен указан только для справки)"