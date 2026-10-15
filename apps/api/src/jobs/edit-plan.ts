import { IsArray, IsIn, IsOptional } from 'class-validator';
import { LABELS, LANGS, NUMBERINGS } from './create-job.dto.js';

/** Same limits as the worker (services/dots-worker/dotdot/plan_io.py). */
export const PLAN_LIMITS = { dots: 1500, paths: 500, numbers: 3000 } as const;

/** Body of POST /api/jobs/:id/edit. Plain lines and page geometry come from the parent job, not the client. */
export class EditJobDto {
  @IsArray() dots!: unknown[];
  @IsArray() paths!: unknown[];
  @IsOptional() @IsIn(NUMBERINGS) numbering?: (typeof NUMBERINGS)[number];
  @IsOptional() @IsIn(LABELS) labels?: (typeof LABELS)[number];
  @IsOptional() @IsIn(LANGS) lang?: (typeof LANGS)[number];
}

export interface EditedDots {
  dots: [number, number][];
  paths: number[][];
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Returns a problem description, or the normalised dots and paths. */
export function checkEdit(body: { dots: unknown[]; paths: unknown[] }, page: { w: number; h: number }): string | EditedDots {
  const { dots, paths } = body;
  if (dots.length > PLAN_LIMITS.dots) return `too many dots (max ${PLAN_LIMITS.dots})`;
  if (paths.length > PLAN_LIMITS.paths) return `too many lines (max ${PLAN_LIMITS.paths})`;
  const outDots: [number, number][] = [];
  for (const p of dots) {
    if (!Array.isArray(p) || p.length !== 2 || !num(p[0]) || !num(p[1])) return 'a dot must be [x, y]';
    if (p[0] < -5 || p[0] > page.w + 5 || p[1] < -5 || p[1] > page.h + 5) return 'a dot is outside the page';
    outDots.push([Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
  }
  const outPaths: number[][] = [];
  let numbers = 0;
  for (const path of paths) {
    if (!Array.isArray(path) || !path.every((i) => Number.isInteger(i))) return 'a line must be a list of dot indices';
    if (path.some((i: number) => i < 0 || i >= outDots.length)) return 'a line refers to a missing dot';
    const ids = (path as number[]).filter((i, k, a) => k === 0 || a[k - 1] !== i);
    if (ids.length >= 2) {
      outPaths.push(ids);
      numbers += ids.length;
    }
  }
  if (!outPaths.length) return 'no dots left to connect';
  if (numbers > PLAN_LIMITS.numbers) return `too many numbers (max ${PLAN_LIMITS.numbers})`;
  return { dots: outDots, paths: outPaths };
}
