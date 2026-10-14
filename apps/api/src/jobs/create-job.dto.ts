import { IsIn, IsOptional } from 'class-validator';

export const MODES = ['auto', 'all', 'outline'] as const;
export const NUMBERINGS = ['jumps', 'series'] as const;
export const LEVELS = ['kid', 'school', 'adult'] as const;
export const LABELS = ['numbers', 'math'] as const;
export const LANGS = ['ru', 'en'] as const;

/** Multipart text fields sent together with the image. All optional: the worker has defaults. */
export class CreateJobDto {
  @IsOptional() @IsIn(MODES) mode?: (typeof MODES)[number];
  @IsOptional() @IsIn(NUMBERINGS) numbering?: (typeof NUMBERINGS)[number];
  @IsOptional() @IsIn(LEVELS) level?: (typeof LEVELS)[number];
  @IsOptional() @IsIn(LABELS) labels?: (typeof LABELS)[number];
  @IsOptional() @IsIn(LANGS) lang?: (typeof LANGS)[number];
}

export type JobOptions = Required<CreateJobDto>;

export function normalizeOptions(dto: CreateJobDto): JobOptions {
  return {
    mode: dto.mode ?? 'auto',
    numbering: dto.numbering ?? 'jumps',
    level: dto.level ?? 'school',
    labels: dto.labels ?? 'numbers',
    lang: dto.lang ?? 'ru',
  };
}
