import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config.js';
import { LABELS, LANGS, LEVELS, MODES, NUMBERINGS } from '../jobs/create-job.dto.js';

/** Public settings for the web app: limits, option values, donate links. */
@Controller('config')
export class MetaController {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Get()
  config() {
    return {
      limits: {
        maxUploadMb: Math.round(this.cfg.maxUploadBytes / 1024 / 1024),
        formats: ['png', 'jpg', 'webp', 'bmp', 'gif'],
        resultTtlHours: Math.round(this.cfg.resultTtlSec / 3600),
      },
      options: {
        mode: MODES,
        numbering: NUMBERINGS,
        level: LEVELS,
        labels: LABELS,
        lang: LANGS,
        defaults: { mode: 'auto', numbering: 'jumps', level: 'school', labels: 'numbers', lang: 'ru' },
        defaultModeByLevel: { kid: 'outline', school: 'all', adult: 'all' },
      },
      donate: this.cfg.donate,
    };
  }
}
