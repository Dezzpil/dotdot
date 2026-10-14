import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config.js';
import { REDIS } from '../redis/redis.module.js';
import { ApiError } from './api-error.js';

export type Bucket = 'create' | 'read';
const KEY = 'dotdot:rate-bucket';
export const RateLimit = (bucket: Bucket) => SetMetadata(KEY, bucket);

/**
 * Fixed-window limits per client IP, shared by all API replicas through Redis.
 * Cheap (one MULTI per window) and good enough to stop floods; Cloudflare/Caddy can add more.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const bucket = this.reflector.getAllAndOverride<Bucket | undefined>(KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!bucket) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const ip = req.ip ?? 'unknown';
    const l = this.cfg.rateLimits;
    const windows: Array<[number, number]> =
      bucket === 'create'
        ? [
            [60, l.createPerMinute],
            [3600, l.createPerHour],
          ]
        : [[60, l.readPerMinute]];
    const now = Math.floor(Date.now() / 1000);
    const multi = this.redis.multi();
    const keys = windows.map(([sec]) => `${this.cfg.queuePrefix}:rl:${bucket}:${sec}:${ip}:${Math.floor(now / sec)}`);
    windows.forEach(([sec], i) => multi.incr(keys[i]).expire(keys[i], sec + 1));
    const out = (await multi.exec()) ?? [];
    for (let i = 0; i < windows.length; i++) {
      const count = Number(out[i * 2]?.[1] ?? 0);
      const [sec, limit] = windows[i];
      if (count > limit) {
        const retry = sec - (now % sec);
        res.setHeader('Retry-After', String(retry));
        throw new ApiError(429, 'RATE_LIMITED', 'Too many requests, please slow down', { retryAfterSec: retry });
      }
    }
    return true;
  }
}
