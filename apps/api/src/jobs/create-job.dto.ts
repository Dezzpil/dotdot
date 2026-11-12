import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const MODES = ['auto', 'all', 'outline'] as const;
export const STRATEGIES = ['auto', 'subject', 'classes', 'components'] as const;
export const NUMBERINGS = ['jumps', 'color', 'series'] as const;
export const LEVELS = ['kid', 'school', 'adult'] as const;
export const LABELS = ['numbers', 'math'] as const;
export const LANGS = ['ru', 'en'] as const;

/** Multipart text fields sent together with the image. All optional: the worker has defaults. */
export class CreateJobDto {
  @IsOptional() @IsIn(MODES) mode?: (typeof MODES)[number];
  /** how the drawing is split into objects (dot groups); auto picks by measured features */
  @IsOptional() @IsIn(STRATEGIES) strategy?: (typeof STRATEGIES)[number];
  @IsOptional() @IsIn(NUMBERINGS) numbering?: (typeof NUMBERINGS)[number];
  @IsOptional() @IsIn(LEVELS) level?: (typeof LEVELS)[number];
  @IsOptional() @IsIn(LABELS) labels?: (typeof LABELS)[number];
  @IsOptional() @IsIn(LANGS) lang?: (typeof LANGS)[number];
  /** biggest answer in math mode; multipart sends it as text */
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(999) math_max?: number;
  /** the user's own dot count: three variants around it instead of the level ladder */
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(1000) target?: number;
}

export type JobOptions = Required<Omit<CreateJobDto, 'target'>> & Pick<CreateJobDto, 'target'>;

export function normalizeOptions(dto: CreateJobDto): JobOptions {
  return {
    mode: dto.mode ?? 'auto',
    strategy: dto.strategy ?? 'auto',
    numbering: dto.numbering ?? 'color',
    level: dto.level ?? 'school',
    labels: dto.labels ?? 'numbers',
    lang: dto.lang ?? 'ru',
    math_max: dto.math_max ?? 100,
    ...(dto.target !== undefined && { target: dto.target }),
  };
}
