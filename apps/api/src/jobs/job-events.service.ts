import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { Observable, Subject, filter } from 'rxjs';
import { APP_CONFIG, AppConfig, redisOptions } from '../config.js';

export interface QueueEvent {
  jobId: string;
  event: 'waiting' | 'active' | 'progress' | 'completed' | 'failed';
}

/**
 * One QueueEvents stream reader per API replica, fanned out to all SSE clients of that replica.
 * Keeps Redis connections constant no matter how many browsers are watching.
 */
@Injectable()
export class JobEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(JobEventsService.name);
  private readonly bus = new Subject<QueueEvent>();
  private qe?: QueueEvents;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async onModuleInit() {
    this.qe = new QueueEvents(this.cfg.queueName, {
      connection: redisOptions(this.cfg.redisUrl),
      prefix: this.cfg.queuePrefix,
    });
    for (const event of ['waiting', 'active', 'progress', 'completed', 'failed'] as const) {
      this.qe.on(event, ({ jobId }: { jobId: string }) => this.bus.next({ jobId, event }));
    }
    this.qe.on('error', (e) => this.log.warn(`queue events: ${e.message}`));
    await this.qe.waitUntilReady();
  }

  async onModuleDestroy() {
    this.bus.complete();
    await this.qe?.close();
  }

  /** Events of one job, plus every "active"/"completed" (they move everyone's queue position). */
  stream(jobId: string): Observable<QueueEvent> {
    return this.bus.pipe(filter((e) => e.jobId === jobId || e.event === 'active' || e.event === 'completed'));
  }
}
