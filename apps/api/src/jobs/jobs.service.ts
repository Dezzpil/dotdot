import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG, AppConfig } from '../config.js';
import { REDIS } from '../redis/redis.module.js';
import { StorageService } from '../storage/storage.service.js';
import { CreateJobDto, JobOptions, normalizeOptions } from './create-job.dto.js';
import { detectImage } from './file-type.js';
import { JobView, mapState, parseFailure } from './job-view.js';

export interface JobData {
  id: string;
  input: string;
  options: JobOptions;
  hash: string;
}

export interface JobResult {
  files: { pdf: string; puzzle: string; answer: string };
  stats: Record<string, unknown>;
}

export const FILES = {
  'dotdot.pdf': { key: 'pdf', type: 'application/pdf' },
  'puzzle.png': { key: 'puzzle', type: 'image/png' },
  'answer.png': { key: 'answer', type: 'image/png' },
} as const;
export type FileName = keyof typeof FILES;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Injectable()
export class JobsService {
  private readonly log = new Logger(JobsService.name);

  constructor(
    @InjectQueue('dots') private readonly queue: Queue<JobData, JobResult>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
  ) {}

  async create(file: Express.Multer.File | undefined, dto: CreateJobDto): Promise<JobView> {
    if (!file || !file.buffer?.length) throw new ApiError(400, 'NO_FILE', 'Attach an image in the "file" field');
    const ext = detectImage(file.buffer);
    if (!ext) throw new ApiError(415, 'UNSUPPORTED_TYPE', 'Only PNG, JPEG, WebP, BMP or GIF images are supported');
    const options = normalizeOptions(dto);

    // same picture + same options => same result: reuse it instead of burning CPU again
    const hash = createHash('sha256').update(file.buffer).update(JSON.stringify(options)).digest('hex');
    const cacheKey = `${this.cfg.queuePrefix}:cache:${hash}`;
    const cachedId = await this.redis.get(cacheKey);
    if (cachedId) {
      const cached = await this.queue.getJob(cachedId);
      if (cached && (await cached.getState()) !== 'failed') return this.view(cached);
    }

    // backpressure: refuse politely instead of letting the queue grow without bound
    const waiting = await this.queue.getWaitingCount();
    if (waiting >= this.cfg.maxWaitingJobs) {
      throw new ApiError(429, 'BUSY', 'Too many drawings in the queue right now', { retryAfterSec: 30 });
    }

    const id = randomUUID();
    const input = await this.storage.saveInput(id, ext, file.buffer);
    const job = await this.queue.add(
      'generate',
      { id, input, options, hash },
      {
        jobId: id,
        attempts: this.cfg.jobAttempts,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: this.cfg.resultTtlSec },
        removeOnFail: { age: this.cfg.resultTtlSec },
      },
    );
    await this.redis.set(cacheKey, id, 'EX', this.cfg.resultTtlSec);
    this.log.log(`job ${id} queued (${ext}, ${file.size} bytes, ${JSON.stringify(options)})`);
    return this.view(job);
  }

  async get(id: string): Promise<JobView> {
    return this.view(await this.mustGet(id));
  }

  async mustGet(id: string): Promise<Job<JobData, JobResult>> {
    if (!UUID.test(id)) throw new ApiError(404, 'NOT_FOUND', 'No such job');
    const job = await this.queue.getJob(id);
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'No such job (results are kept for 24 hours)');
    return job;
  }

  async file(id: string, name: string) {
    if (!(name in FILES)) throw new ApiError(404, 'NOT_FOUND', 'No such file');
    const job = await this.mustGet(id);
    if ((await job.getState()) !== 'completed' || !job.returnvalue?.files) {
      throw new ApiError(409, 'NOT_READY', 'The drawing is not ready yet');
    }
    const meta = FILES[name as FileName];
    const rel = job.returnvalue.files[meta.key];
    const size = await this.storage.size(rel);
    if (size === null) throw new ApiError(404, 'NOT_FOUND', 'The file has expired');
    return { stream: this.storage.open(rel), size, type: meta.type };
  }

  async view(job: Job<JobData, JobResult>): Promise<JobView> {
    const state = await job.getState();
    const status = mapState(state);
    const v: JobView = {
      id: job.id!,
      status,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      position: status === 'queued' ? await this.position(job.id!) : null,
      createdAt: job.timestamp,
    };
    if (status === 'done' && job.returnvalue) {
      const base = `/api/jobs/${job.id}/files`;
      v.result = {
        pdf: `${base}/dotdot.pdf`,
        puzzle: `${base}/puzzle.png`,
        answer: `${base}/answer.png`,
        stats: job.returnvalue.stats,
      };
      v.progress = 100;
      v.finishedAt = job.finishedOn;
    }
    if (status === 'failed') {
      v.error = parseFailure(job.failedReason);
      v.finishedAt = job.finishedOn;
    }
    return v;
  }

  /** Place in line: BullMQ LPUSHes new jobs to "wait" and workers take from the tail. */
  private async position(id: string): Promise<number | null> {
    const key = `${this.cfg.queuePrefix}:${this.cfg.queueName}:wait`;
    const [idx, len] = await Promise.all([
      this.redis.call('LPOS', key, id) as Promise<number | null>,
      this.redis.llen(key),
    ]);
    return idx === null || idx === undefined ? null : len - Number(idx);
  }

  async counts() {
    return this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  }
}
