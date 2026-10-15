/**
 * The dot editor's data model: pure functions, easy to test.
 * Mirrors plan.json from the worker (services/dots-worker/dotdot/plan_io.py).
 */
import type { Numbering } from '../api';

export type Pt = [number, number];

export interface PlanDoc {
  v: 1;
  page: { w: number; h: number };
  image?: { w: number; h: number; s: number; ox: number; oy: number };
  dotR: number;
  dots: Pt[];
  /** drawing order as dot indices; a closed line repeats its first dot at the end */
  paths: number[][];
  /** details printed as plain lines, not editable */
  lines: Pt[][];
}

export interface Draft {
  dots: Pt[];
  paths: number[][];
}

export const isClosed = (p: number[]) => p.length >= 3 && p[0] === p[p.length - 1];

export function moveDot(d: Draft, i: number, to: Pt): Draft {
  const dots = d.dots.slice();
  dots[i] = [Math.round(to[0] * 100) / 100, Math.round(to[1] * 100) / 100];
  return { dots, paths: d.paths };
}

/** Remove a dot from every line; lines that become too short disappear, loops stay loops. */
export function deleteDot(d: Draft, i: number): Draft {
  const paths: number[][] = [];
  for (const p of d.paths) {
    const closed = isClosed(p);
    let core = (closed ? p.slice(0, -1) : p).filter((k) => k !== i);
    core = core.filter((k, j) => j === 0 || core[j - 1] !== k);
    if (closed && core.length > 1 && core[0] === core[core.length - 1]) core.pop();
    if (closed && core.length >= 3) paths.push([...core, core[0]]);
    else if (core.length >= 2) paths.push(core);
  }
  const dots = d.dots.filter((_, k) => k !== i);
  return { dots, paths: paths.map((p) => p.map((k) => (k > i ? k - 1 : k))) };
}

/** Insert a new dot into line `path` right after its `seg`-th dot. */
export function insertDot(d: Draft, path: number, seg: number, at: Pt): Draft {
  const dots = [...d.dots, [Math.round(at[0] * 100) / 100, Math.round(at[1] * 100) / 100] as Pt];
  const paths = d.paths.map((p, k) => (k === path ? [...p.slice(0, seg + 1), dots.length - 1, ...p.slice(seg + 1)] : p));
  return { dots, paths };
}

/**
 * Make dot `i` number 1: its line goes first; a loop rotates to start there,
 * an open line flips when `i` is its last dot. A dot in the middle of an open line cannot start it.
 */
export function startAt(d: Draft, i: number): Draft {
  if (!canStartAt(d, i)) return d;
  const k = d.paths.findIndex((p) => p.includes(i));
  const p = d.paths[k];
  let next = p;
  if (isClosed(p) && p[0] !== i) {
    const core = p.slice(0, -1);
    const j = core.indexOf(i);
    next = [...core.slice(j), ...core.slice(0, j), i];
  } else if (!isClosed(p) && p[p.length - 1] === i) {
    next = p.slice().reverse();
  }
  return { dots: d.dots, paths: [next, ...d.paths.filter((_, m) => m !== k)] };
}

export function canStartAt(d: Draft, i: number): boolean {
  const k = d.paths.findIndex((q) => q.includes(i));
  if (k < 0) return false;
  const p = d.paths[k];
  if (isClosed(p) || p[0] === i || p[p.length - 1] === i) return !(k === 0 && p[0] === i);
  return false;
}

const SERIES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function seriesName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n) {
    const r = (n - 1) % 26;
    s = SERIES[r] + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** What the worker will print next to each dot (numbers mode). */
export function dotLabels(d: Draft, numbering: Numbering): string[] {
  const out: string[][] = d.dots.map(() => []);
  let n = 0;
  d.paths.forEach((p, si) =>
    p.forEach((di, j) => {
      n += 1;
      out[di].push(numbering === 'series' ? `${seriesName(si)}${j + 1}` : String(n));
    }),
  );
  return out.map((x) => x.join('/'));
}

/** Dots that start a line get a ring on the sheet. */
export const starts = (d: Draft) => new Set(d.paths.map((p) => p[0]));

export function nearestDot(d: Draft, at: Pt, maxDist: number): number | null {
  let best: number | null = null;
  let bd = maxDist;
  d.dots.forEach(([x, y], i) => {
    const dist = Math.hypot(x - at[0], y - at[1]);
    if (dist <= bd) {
      bd = dist;
      best = i;
    }
  });
  return best;
}

/** Closest point on any segment of any line, within maxDist. */
export function nearestSegment(d: Draft, at: Pt, maxDist: number): { path: number; seg: number; point: Pt } | null {
  let best: { path: number; seg: number; point: Pt } | null = null;
  let bd = maxDist;
  d.paths.forEach((p, pi) => {
    for (let j = 0; j + 1 < p.length; j++) {
      const [ax, ay] = d.dots[p[j]];
      const [bx, by] = d.dots[p[j + 1]];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - ay) * dy) / len2)) : 0;
      const q: Pt = [ax + dx * t, ay + dy * t];
      const dist = Math.hypot(q[0] - at[0], q[1] - at[1]);
      // stay off the end dots: inserting on top of an existing dot helps nobody
      if (dist <= bd && t > 0.08 && t < 0.92) {
        bd = dist;
        best = { path: pi, seg: j, point: q };
      }
    }
  });
  return best;
}

export const clampToPage = (p: Pt, page: { w: number; h: number }): Pt => [
  Math.min(Math.max(p[0], 0), page.w),
  Math.min(Math.max(p[1], 0), page.h),
];

/** Undo/redo history; a drag is one step (begin once, then live updates). */
export interface History {
  past: Draft[];
  present: Draft;
  future: Draft[];
}

export type Action =
  | { type: 'reset'; draft: Draft }
  | { type: 'apply'; draft: Draft }
  | { type: 'begin' }
  | { type: 'live'; draft: Draft }
  | { type: 'undo' }
  | { type: 'redo' };

const LIMIT = 200;

export function history(h: History, a: Action): History {
  switch (a.type) {
    case 'reset':
      return { past: [], present: a.draft, future: [] };
    case 'apply':
      return { past: [...h.past, h.present].slice(-LIMIT), present: a.draft, future: [] };
    case 'begin':
      return { past: [...h.past, h.present].slice(-LIMIT), present: h.present, future: [] };
    case 'live':
      return { ...h, present: a.draft };
    case 'undo':
      return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h;
    case 'redo':
      return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
  }
}

/** Drop history steps that changed nothing (a click on a dot without moving it). */
export function squash(h: History): History {
  const last = h.past[h.past.length - 1];
  return last && last.dots === h.present.dots && last.paths === h.present.paths ? { ...h, past: h.past.slice(0, -1) } : h;
}
