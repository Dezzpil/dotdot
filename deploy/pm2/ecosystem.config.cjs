// pm2 без Docker. Пути выводятся из расположения файла, поэтому клон может лежать
// где угодно; переопределение — DOTDOT_APP_DIR / DOTDOT_ENV_FILE.
// Число процессов: DOTDOT_API_INSTANCES (cluster, один порт), DOTDOT_WORKERS (fork, по ядру).
const path = require('node:path');

const APP_DIR = process.env.DOTDOT_APP_DIR ?? path.resolve(__dirname, '..', '..');
const ENV_FILE = process.env.DOTDOT_ENV_FILE ?? path.join(APP_DIR, '.env');
const API_INSTANCES = Number(process.env.DOTDOT_API_INSTANCES ?? 2);
const WORKERS = Number(process.env.DOTDOT_WORKERS ?? 2); // правило: nproc - 1

const api = {
  name: 'dotdot-api',
  cwd: path.join(APP_DIR, 'apps', 'api'),
  script: 'dist/main.js',
  exec_mode: 'cluster', // один порт из .env, балансировка силами pm2
  instances: API_INSTANCES,
  node_args: `--env-file=${ENV_FILE}`,
  env: { NODE_ENV: 'production' },
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