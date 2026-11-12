import type { ErrorCode } from '../common/api-error.js';

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

/** One dot-count variant of an analyzed drawing: a leaf job with its own sheet. */
export interface VariantView {
  id: string;
  target: number;
  status: JobStatus;
  progress: number;
  position: number | null;
  result?: JobResultView;
  error?: { code: ErrorCode; message: string };
}

export interface JobResultView {
  pdf?: string;
  puzzle?: string;
  answer?: string;
  /** structure for the dot editor; missing for jobs made before the editor existed */
  plan?: string;
  /** the uploaded drawing, shown under the dots in the editor */
  source?: string;
  stats: Record<string, unknown>;
  /** present on an analyzed set: the dot-count variants to choose from */
  variants?: VariantView[];
}

export interface JobView {
  id: string;
  status: JobStatus;
  progress: number;
  /** 1-based place in the queue while status is "queued" */
  position: number | null;
  /** the set this variant belongs to, or the parent of an edit */
  parent?: string;
  result?: JobResultView;
  error?: { code: ErrorCode; message: string };
  createdAt: number;
  finishedAt?: number;
}

/** A set is final only when every variant is: the SSE stream lives until then. */
export function isFinal(v: JobView): boolean {
  if (v.status === 'failed') return true;
  if (v.status !== 'done') return false;
  return !v.result?.variants || v.result.variants.every((x) => x.status === 'done' || x.status === 'failed');
}

const KNOWN: ErrorCode[] = ['BAD_IMAGE', 'BAD_OPTIONS', 'BAD_PLAN', 'BAD_SCENE', 'TIMEOUT', 'NOT_FOUND'];

/** Worker failures look like "CODE: message"; anything else is an internal error. */
export function parseFailure(reason: string | undefined): { code: ErrorCode; message: string } {
  const m = /^([A-Z_]+):\s*(.*)$/s.exec(reason ?? '');
  if (m && (KNOWN as string[]).includes(m[1])) return { code: m[1] as ErrorCode, message: m[2] };
  if (m && m[1] === 'INPUT_MISSING') return { code: 'NOT_FOUND', message: m[2] };
  return { code: 'INTERNAL', message: 'Processing failed, please try again' };
}

export function mapState(state: string): JobStatus {
  switch (state) {
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'active':
      return 'processing';
    default:
      return 'queued'; // waiting, delayed, prioritized, waiting-children, unknown-yet
  }
}
