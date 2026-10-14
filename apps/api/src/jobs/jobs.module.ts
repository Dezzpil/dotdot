import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { APP_CONFIG, AppConfig } from '../config.js';
import { JobEventsService } from './job-events.service.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [
    // 'dots' is only the DI token; the real queue name comes from QUEUE_NAME
    BullModule.registerQueueAsync({
      name: 'dots',
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({ name: cfg.queueName }),
    }),
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        storage: memoryStorage(),
        limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 10, fieldSize: 1024, parts: 12 },
      }),
    }),
  ],
  controllers: [JobsController],
  providers: [JobsService, JobEventsService],
  exports: [JobsService],
})
export class JobsModule {}
