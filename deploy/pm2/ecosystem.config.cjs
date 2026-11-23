// pm2 без Docker. Пути выводятся из расположения файла, поэтому клон может лежать
// где угодно; переопределение — DOTDOT_APP_DIR / DOTDOT_ENV_FILE.
// Число процессов: DOTDOT_API_INSTANCES (cluster, один порт), DOTDOT_WORKERS (fork, по ядру).
const path = require('node:path');
const fs = require('node:fs');

const APP_DIR = process.env.DOTDOT_APP_DIR ?? path.resolve(__dirname, '..', '..');
const ENV_FILE = process.env.DOTDOT_ENV_FILE ?? path.join(APP_DIR, '.env');
const API_INSTANCES = Number(process.env.DOTDOT_API_INSTANCES ?? 2);
const WORKERS = Number(process.env.DOTDOT_WORKERS ?? 2); // правило: nproc - 1

// pm2 хранит окружение приложения с момента запуска: `pm2 restart` без --update-env и
// pm2 resurrect после перезагрузки поднимают процесс со старыми значениями. Флаг node
// --env-file такой снимок не перебивает: если переменная уже есть в окружении процесса,
// её значение побеждает значение из файла (см. docs Node.js, --env-file). Поэтому файл
// читаем здесь и кладём прямо в env приложения — оно смешивается поверх окружения
// демона, и .env остаётся единственным источником.
function readEnvFile(file) {
  if (!fs.existsSync(file)) throw new Error(`нет ${file}: cp deploy/pm2/env.example ${file}`);
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

const FILE_ENV = readEnvFile(ENV_FILE);

const api = {
  name: 'dotdot-api',
  cwd: path.join(APP_DIR, 'apps', 'api'),
  script: 'dist/main.js',
  exec_mode: 'cluster', // один порт из .env, балансировка силами pm2
  instances: API_INSTANCES,
  env: { ...FILE_ENV, NODE_ENV: 'production' },
  max_memory_restart: '300M',
  kill_timeout: 10000,
};

const worker = (n) => ({
  name: `dotdot-worker-${n}`,
  cwd: path.join(APP_DIR, 'services', 'dots-worker'),
  script: path.join(__dirname, 'run-worker.sh'),
  interpreter: 'bash',
  exec_mode: 'fork',
  // pm2 по умолчанию ждёт 1.6 с и убивает SIGKILL: задача осталась бы stalled.
  // Воркер по SIGINT дорабатывает текущую задачу, поэтому запас больше JOB_TIMEOUT_SEC.
  kill_timeout: 70000,
  max_memory_restart: '900M',
  env: {
    DOTDOT_APP_DIR: APP_DIR,
    DOTDOT_ENV_FILE: ENV_FILE,
    HOSTNAME: `worker-${n}`, // имя воркера в логах очереди
    // pm2 не умеет лимиты CPU как Docker: одно ядро на воркер задаём потоками
    OMP_NUM_THREADS: '1',
    OPENBLAS_NUM_THREADS: '1',
    MKL_NUM_THREADS: '1',
  },
});

module.exports = {
  apps: [api, ...Array.from({ length: WORKERS }, (_, i) => worker(i + 1))],
};