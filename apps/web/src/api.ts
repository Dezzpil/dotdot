import type { Draft, PlanDoc } from './editor/model';

export type Mode = 'auto' | 'all' | 'outline';
export type Strategy = 'auto' | 'subject' | 'classes' | 'components';
export type Numbering = 'jumps' | 'color' | 'series';
export type Level = 'kid' | 'school' | 'adult';
export type Labels = 'numbers' | 'math';
export type Lang = 'ru' | 'en';

export interface JobOptions {
  mode: Mode;
  strategy: Strategy;
  numbering: Numbering;
  level: Level;
  labels: Labels;
  lang: Lang;
  /** biggest answer in math mode */
  math_max: number;
  /** approximate dot count; absent = the ladder picked for the level */
  target?: number;
}

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface JobStats {
  dots?: number;
  strokes?: number;
  contours?: number;
  plain_lines?: number;
  ms?: number;
  edited?: boolean;
  /** the grouping strategy actually used (options.strategy may be 'auto') */
  strategy?: Strategy;
  /** an analyzed set: the dot counts the drawing can actually carry */
  dots_min?: number;
  dots_max?: number;
  targets?: number[];
  /** a variant: the dot count it aimed at */
  target?: number;
  options?: Partial<JobOptions>;
}

export interface JobResultView {
  pdf?: string;
  puzzle?: string;
  answer?: string;
  /** plan.json for the dot editor (missing for sheets made before the editor) */
  plan?: string;
  /** the uploaded drawing, shown faintly under the dots while editing */
  source?: string;
  stats: JobStats;
  /** an analyzed set: the dot-count variants to choose from */
  variants?: VariantView[];
}

/** One dot-count variant of an analyzed drawing: a leaf job with its own sheet. */
export interface VariantView {
  id: string;
  target: number;
  status: JobStatus;
  progress: number;
  position: number | null;
  result?: JobResultView;
  error?: { code: string; message: string };
}

export interface JobView {
  id: string;
  status: JobStatus;
  progress: number;
  position: number | null;
  /** the set a variant belongs to, or the sheet an edit was made from */
  parent?: string;
  result?: JobResultView;
  error?: { code: string; message: string };
  createdAt: number;
  finishedAt?: number;
}

export interface PublicConfig {
  limits: { maxUploadMb: number; formats: string[]; resultTtlHours: number };
  donate: { cloudtips?: string; boosty?: string; kofi?: string };
}

export const FALLBACK_CONFIG: PublicConfig = {
  limits: { maxUploadMb: 10, formats: ['png', 'jpg', 'webp', 'bmp', 'gif'], resultTtlHours: 24 },
  donate: {},
};

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export const apiUrl = (path: string) => `${BASE}${path}`;

/** A failed API call with the server's error code (or NETWORK when the server was unreachable). */
export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryAfterSec?: number,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiFailure('NETWORK', 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    const retry = e?.retryAfterSec ?? (Number(res.headers.get('retry-after')) || undefined);
    throw new ApiFailure(typeof e?.code === 'string' ? e.code : res.status >= 500 ? 'INTERNAL' : 'BAD_OPTIONS', res.status, retry);
  }
  return body as T;
}

export const getConfig = () => request<PublicConfig>('/api/config');

export function createJob(file: Blob, options: JobOptions, filename = 'drawing.png') {
  const form = new FormData();
  form.append('file', file, filename);
  for (const [k, v] of Object.entries(options)) if (v !== undefined) form.append(k, String(v));
  return request<JobView>('/api/jobs', { method: 'POST', body: form });
}

export const getPlan = (path: string) => request<PlanDoc>(path);

/** A new sheet from edited dots; page geometry, colours and plain lines stay on the server. */
export function editJob(id: string, draft: Draft) {
  return request<JobView>(`/api/jobs/${encodeURIComponent(id)}/edit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dots: draft.dots, paths: draft.paths, groups: draft.groups }),
  });
}

export const getJob = (id: string) => request<JobView>(`/api/jobs/${encodeURIComponent(id)}`);

/** A set is final only when every variant is, so the live stream stays open until then. */
export const isFinal = (v: JobView) =>
  v.status === 'failed' || (v.status === 'done' && (!v.result?.variants || v.result.variants.every((x) => x.status === 'done' || x.status === 'failed')));

/** The set behind a sheet: a variant points at it directly, an edit points at the sheet it was made from. */
export async function findSetId(id: string): Promise<string | null> {
  for (let hop = 0; hop < 5; hop++) {
    const v = await getJob(id);
    if (v.result?.variants) return v.id;
    if (!v.parent) return null;
    id = v.parent;
  }
  return null;
}

/**
 * Live job updates: server-sent events first, polling as a fallback
 * (old proxies, flaky mobile networks). Returns an unsubscribe function.
 */
export function watchJob(
  id: string,
  onView: (v: JobView) => void,
  onError: (e: ApiFailure) => void,
  opts: { pollMs?: number; useSse?: boolean } = {},
): () => void {
  let stopped = false;
  let es: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pollMs = opts.pollMs ?? 1500;

  const emit = (v: JobView) => {
    if (stopped) return;
    onView(v);
    if (isFinal(v)) stop();
  };

  const poll = async () => {
    if (stopped) return;
    try {
      emit(await getJob(id));
    } catch (e) {
      const f = e instanceof ApiFailure ? e : new ApiFailure('INTERNAL', 0);
      if (f.code === 'NOT_FOUND') {
        onError(f);
        return stop();
      }
      // transient trouble: keep trying, a bit slower
      if (!stopped) timer = setTimeout(poll, pollMs * 2);
      return;
    }
    if (!stopped) timer = setTimeout(poll, pollMs);
  };

  const stop = () => {
    stopped = true;
    es?.close();
    if (timer) clearTimeout(timer);
  };

  if ((opts.useSse ?? true) && typeof EventSource !== 'undefined') {
    es = new EventSource(apiUrl(`/api/jobs/${encodeURIComponent(id)}/events`));
    es.addEventListener('job', (ev) => emit(JSON.parse((ev as MessageEvent).data)));
    es.onerror = () => {
      if (stopped) return;
      es?.close();
      es = undefined;
      void poll();
    };
  } else {
    void poll();
  }
  return stop;
}
