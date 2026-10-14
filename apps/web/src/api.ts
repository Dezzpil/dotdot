export type Mode = 'auto' | 'all' | 'outline';
export type Numbering = 'jumps' | 'series';
export type Level = 'kid' | 'school' | 'adult';
export type Labels = 'numbers' | 'math';
export type Lang = 'ru' | 'en';

export interface JobOptions {
  mode: Mode;
  numbering: Numbering;
  level: Level;
  labels: Labels;
  lang: Lang;
}

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface JobView {
  id: string;
  status: JobStatus;
  progress: number;
  position: number | null;
  result?: {
    pdf: string;
    puzzle: string;
    answer: string;
    stats: { dots?: number; strokes?: number; plain_lines?: number; ms?: number; options?: Partial<JobOptions> };
  };
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
  for (const [k, v] of Object.entries(options)) form.append(k, v);
  return request<JobView>('/api/jobs', { method: 'POST', body: form });
}

export const getJob = (id: string) => request<JobView>(`/api/jobs/${encodeURIComponent(id)}`);

export const isFinal = (v: JobView) => v.status === 'done' || v.status === 'failed';

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
