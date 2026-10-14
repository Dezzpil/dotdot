import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const app = await createApp(cfg);
await app.listen(cfg.port, '0.0.0.0');
new Logger('DotDot').log(`API listening on :${cfg.port}`);
