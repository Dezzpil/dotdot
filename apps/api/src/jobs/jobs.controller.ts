import {
  Body,
  Controller,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  Post,
  Res,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Observable, concatMap, defer, interval, merge, of, takeWhile, throttleTime } from 'rxjs';
import { RateLimit } from '../common/rate-limit.js';
import { CreateJobDto } from './create-job.dto.js';
import { JobEventsService } from './job-events.service.js';
import { JobView } from './job-view.js';
import { JobsService } from './jobs.service.js';

const SSE_MAX_MS = 5 * 60 * 1000;

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly events: JobEventsService,
  ) {}

  /** Upload a drawing. Multipart: file + optional mode/numbering/level/labels/lang. */
  @Post()
  @HttpCode(202)
  @RateLimit('create')
  @UseInterceptors(FileInterceptor('file'))
  create(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: CreateJobDto): Promise<JobView> {
    return this.jobs.create(file, dto);
  }

  @Get(':id')
  @RateLimit('read')
  get(@Param('id') id: string): Promise<JobView> {
    return this.jobs.get(id);
  }

  /** Server-sent events: the current JobView on every change, closes when done or failed. */
  @Sse(':id/events')
  @RateLimit('read')
  async watch(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    await this.jobs.mustGet(id); // 404 before the stream is opened
    // subscribe to queue events *and* fetch the current state at once: nothing can slip between
    const views = merge(of(null), this.events.stream(id)).pipe(
      throttleTime(250, undefined, { leading: true, trailing: true }),
      concatMap(() => defer(() => this.jobs.get(id))),
      takeWhile((v) => v.status !== 'done' && v.status !== 'failed', true),
    );
    return new Observable<MessageEvent>((sub) => {
      const s = views.subscribe({
        next: (v) => sub.next({ type: 'job', data: v }),
        error: (e) => sub.error(e),
        complete: () => sub.complete(),
      });
      const ping = interval(15000).subscribe(() => sub.next({ type: 'ping', data: '' }));
      const limit = setTimeout(() => sub.complete(), SSE_MAX_MS);
      return () => {
        s.unsubscribe();
        ping.unsubscribe();
        clearTimeout(limit);
      };
    });
  }

  @Get(':id/files/:name')
  @RateLimit('read')
  async file(@Param('id') id: string, @Param('name') name: string, @Res() res: Response) {
    const f = await this.jobs.file(id, name);
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    if (name.endsWith('.pdf')) res.setHeader('Content-Disposition', 'attachment; filename="dotdot.pdf"');
    f.stream.on('error', () => res.destroy());
    f.stream.pipe(res);
  }
}
