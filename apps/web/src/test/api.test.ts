import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, createJob, getJob, JobView, watchJob } from '../api';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const view = (status: JobView['status'], extra: Partial<JobView> = {}): JobView => ({
  id: 'j1',
  status,
  progress: 0,
  position: null,
  createdAt: 1,
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('api client', () => {
  it('sends the file and every option as multipart', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(202, view('queued', { position: 3 })));
    const v = await createJob(new Blob(['x']), { mode: 'auto', numbering: 'series', level: 'adult', labels: 'math', lang: 'en' }, 'a.png');
    expect(v.position).toBe(3);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/jobs');
    const form = init!.body as FormData;
    expect(form.get('numbering')).toBe('series');
    expect(form.get('labels')).toBe('math');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('turns server errors into codes the UI can explain', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(429, { error: { code: 'RATE_LIMITED', message: 'x' } }, { 'retry-after': '17' }));
    const e = (await getJob('j1').catch((x) => x)) as ApiFailure;
    expect(e).toBeInstanceOf(ApiFailure);
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.retryAfterSec).toBe(17);
  });

  it('reports NETWORK when the server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    expect(((await getJob('j1').catch((x) => x)) as ApiFailure).code).toBe('NETWORK');
  });

  it('falls back to polling and stops on the final state', async () => {
    const replies = [view('queued', { position: 2 }), view('processing', { progress: 10 }), view('done', { progress: 100 })];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, replies.shift() ?? view('done')));
    const seen: string[] = [];
    await new Promise<void>((resolve) => {
      watchJob(
        'j1',
        (v) => {
          seen.push(v.status);
          if (v.status === 'done') resolve();
        },
        () => undefined,
        { useSse: false, pollMs: 5 },
      );
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toEqual(['queued', 'processing', 'done']);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('gives up on NOT_FOUND', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    const err = await new Promise<ApiFailure>((resolve) => watchJob('j1', () => undefined, resolve, { useSse: false, pollMs: 5 }));
    expect(err.code).toBe('NOT_FOUND');
  });
});
