import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config.js';
import { REDIS } from '../redis/redis.module.js';
import { StorageService } from './storage.service.js';

const EVERY_MS = 10 * 60 * 1000;

/** Removes uploads and results after RESULT_TTL_SEC. One replica at a time (Redis lock). */
@Injectable()
export class CleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(CleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly storage: StorageService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<number> {
    const lock = await this.redis.set(`${this.cfg.queuePrefix}:cleanup-lock`, String(process.pid), 'EX', 300, 'NX');
    if (!lock) return 0;
    // keep files a bit longer than jobs so a finished job never points at missing files
    const n = await this.storage.removeOlderThan((this.cfg.resultTtlSec + 600) * 1000);
    if (n) this.log.log(`removed ${n} expired job folders`);
    return n;
  }
}
