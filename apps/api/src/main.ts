import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const app = await createApp(cfg);
await app.listen(cfg.port, cfg.host);
new Logger('DotDot').log(`API listening on ${cfg.host}:${cfg.port}`);
