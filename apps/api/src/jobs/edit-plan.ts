import { IsArray, IsIn, IsOptional } from 'class-validator';
import { LABELS, LANGS, NUMBERINGS } from './create-job.dto.js';

/** Same limits as the worker (services/dots-worker/dotdot/plan_io.py). */
export const PLAN_LIMITS = { dots: 1500, paths: 500, numbers: 3000, solids: 64 } as const;
export const INK_HEX = '#212129';

/** Body of POST /api/jobs/:id/edit. Plain lines, colours and page geometry come from the parent job. */
export class EditJobDto {
  @IsArray() dots!: unknown[];
  @IsArray() paths!: unknown[];
  /** object index per line: merging or cutting lines must not desync them from the colours */
  @IsArray() groups!: unknown[];
  @IsOptional() @IsIn(NUMBERINGS) numbering?: (typeof NUMBERINGS)[number];
  @IsOptional() @IsIn(LABELS) labels?: (typeof LABELS)[number];
  @IsOptional() @IsIn(LANGS) lang?: (typeof LANGS)[number];
}

export interface EditedDots {
  dots: [number, number][];
  paths: number[][];
  groups: number[];
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Returns a problem description, or the normalised dots, paths and groups. */
export function checkEdit(
  body: { dots: unknown[]; paths: unknown[]; groups: unknown[] },
  page: { w: number; h: number },
  colorCount: number,
): string | EditedDots {
  const { dots, paths, groups } = body;
  if (dots.length > PLAN_LIMITS.dots) return `too many dots (max ${PLAN_LIMITS.dots})`;
  if (paths.length > PLAN_LIMITS.paths) return `too many lines (max ${PLAN_LIMITS.paths})`;
  if (groups.length !== paths.length) return 'groups must name a colour for every line';
  if (!groups.every((g) => Number.isInteger(g) && (g as number) >= 0 && (g as number) < colorCount)) {
    return 'a group must be a colour index of the parent drawing';
  }
  const outDots: [number, number][] = [];
  for (const p of dots) {
    if (!Array.isArray(p) || p.length !== 2 || !num(p[0]) || !num(p[1])) return 'a dot must be [x, y]';
    if (p[0] < -5 || p[0] > page.w + 5 || p[1] < -5 || p[1] > page.h + 5) return 'a dot is outside the page';
    outDots.push([Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
  }
  const outPaths: number[][] = [];
  const outGroups: number[] = [];
  let numbers = 0;
  for (const [k, path] of paths.entries()) {
    if (!Array.isArray(path) || !path.every((i) => Number.isInteger(i))) return 'a line must be a list of dot indices';
    if (path.some((i: number) => i < 0 || i >= outDots.length)) return 'a line refers to a missing dot';
    const ids = (path as number[]).filter((i, j, a) => j === 0 || a[j - 1] !== i);
    if (ids.length >= 2) {
      outPaths.push(ids);
      outGroups.push(groups[k] as number);
      numbers += ids.length;
    }
  }
  if (!outPaths.length) return 'no dots left to connect';
  if (numbers > PLAN_LIMITS.numbers) return `too many numbers (max ${PLAN_LIMITS.numbers})`;
  return { dots: outDots, paths: outPaths, groups: outGroups };
}
