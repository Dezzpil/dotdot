import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AppConfig, loadConfig } from './config.js';
import { ApiError } from './common/api-error.js';

export async function createApp(cfg: AppConfig = loadConfig()): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(cfg), {
    logger: process.env.NODE_ENV === 'test' ? ['error', 'warn'] : undefined,
  });
  app.set('trust proxy', cfg.trustProxy);
  app.disable('x-powered-by');
  // when the web app lives on another origin (CORS_ORIGINS set), its <img> must be able to load the sheets
  app.use(helmet({ crossOriginResourcePolicy: { policy: cfg.corsOrigins.length ? 'cross-origin' : 'same-site' } }));
  // '*' allows any origin (e.g. a preview host); otherwise an exact list
  if (cfg.corsOrigins.length) app.enableCors({ origin: cfg.corsOrigins.includes('*') ? true : cfg.corsOrigins });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new ApiError(
          400,
          'BAD_OPTIONS',
          errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ') || 'Invalid options',
        ),
    }),
  );
  app.enableShutdownHooks();
  return app;
}
