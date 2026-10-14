import type { ErrorCode } from '../common/api-error.js';

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface JobView {
  id: string;
  status: JobStatus;
  progress: number;
  /** 1-based place in the queue while status is "queued" */
  position: number | null;
  result?: {
    pdf: string;
    puzzle: string;
    answer: string;
    stats: Record<string, unknown>;
  };
  error?: { code: ErrorCode; message: string };
  createdAt: number;
  finishedAt?: number;
}

const KNOWN: ErrorCode[] = ['BAD_IMAGE', 'BAD_OPTIONS', 'TIMEOUT', 'NOT_FOUND'];

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
