export interface AppConfig {
  port: number;
  redisUrl: string;
  queueName: string;
  queuePrefix: string;
  storageDir: string;
  maxUploadBytes: number;
  maxWaitingJobs: number;
  resultTtlSec: number;
  jobAttempts: number;
  trustProxy: string | number | boolean;
  corsOrigins: string[];
  rateLimits: { createPerMinute: number; createPerHour: number; readPerMinute: number };
  donate: { cloudtips?: string; boosty?: string; kofi?: string };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

function trustProxy(v: string | undefined): string | number | boolean {
  if (!v) return 1; // one reverse proxy (Caddy) in front by default
  if (v === 'true' || v === 'false') return v === 'true';
  return /^\d+$/.test(v) ? Number(v) : v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: int(env.PORT, 3000),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    queueName: env.QUEUE_NAME ?? 'dots',
    queuePrefix: env.QUEUE_PREFIX ?? 'dotdot',
    storageDir: env.STORAGE_DIR ?? '/data',
    maxUploadBytes: int(env.MAX_UPLOAD_MB, 10) * 1024 * 1024,
    maxWaitingJobs: int(env.MAX_WAITING_JOBS, 300),
    resultTtlSec: int(env.RESULT_TTL_SEC, 24 * 3600),
    jobAttempts: int(env.JOB_ATTEMPTS, 2),
    trustProxy: trustProxy(env.TRUST_PROXY),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    rateLimits: {
      createPerMinute: int(env.RATE_CREATE_PER_MIN, 10),
      createPerHour: int(env.RATE_CREATE_PER_HOUR, 60),
      readPerMinute: int(env.RATE_READ_PER_MIN, 300),
    },
    donate: {
      cloudtips: opt(env.DONATE_CLOUDTIPS_URL),
      boosty: opt(env.DONATE_BOOSTY_URL),
      kofi: opt(env.DONATE_KOFI_URL),
    },
  };
}

/** BullMQ / ioredis connection options from a redis:// URL. */
export function redisOptions(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}
