import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { JobsService } from '../jobs/jobs.service.js';
import { REDIS } from '../redis/redis.module.js';
import { StorageService } from '../storage/storage.service.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  /** Liveness + readiness for Docker healthchecks and uptime monitors. */
  @Get()
  async health(@Res() res: Response) {
    const redis = await this.redis
      .ping()
      .then((r) => r === 'PONG')
      .catch(() => false);
    const storage = await this.storage.ping();
    const queue = redis ? await this.jobs.counts().catch(() => null) : null;
    const ok = redis && storage;
    res.status(ok ? 200 : 503).json({ ok, redis, storage, queue });
  }
}
