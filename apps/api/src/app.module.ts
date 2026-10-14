import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { RateLimitGuard } from './common/rate-limit.js';
import { APP_CONFIG, AppConfig, loadConfig, redisOptions } from './config.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MetaController } from './meta/meta.controller.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({})
export class ConfigModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    return { module: ConfigModule, global: true, providers: [{ provide: APP_CONFIG, useValue: cfg }], exports: [APP_CONFIG] };
  }
}

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig = loadConfig()): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(cfg),
        RedisModule,
        StorageModule,
        BullModule.forRoot({ connection: redisOptions(cfg.redisUrl), prefix: cfg.queuePrefix }),
        JobsModule,
      ],
      controllers: [HealthController, MetaController],
      providers: [
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}
