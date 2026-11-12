/**
 * End-to-end: real Redis (TEST_REDIS_URL) + real Python worker + the Nest app on a random port.
 * Run: TEST_REDIS_URL=redis://localhost:6390 npm run test:e2e
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { AppConfig, loadConfig } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = path.resolve(here, '../../../services/dots-worker');
const SAMPLE = path.join(WORKER_DIR, 'samples/among-us.png');
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

interface Stack {
  app: INestApplication;
  base: string;
  cfg: AppConfig;
}

async function start(over: Partial<AppConfig>, dir: string): Promise<Stack> {
  const cfg: AppConfig = { ...loadConfig({}), redisUrl: REDIS_URL, storageDir: dir, trustProxy: true, ...over };
  const app = await createApp(cfg);
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address();
  return { app, cfg, base: `http://127.0.0.1:${addr.port}` };
}

const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function upload(base: string, data: Buffer, fields: Record<string, string> = {}, from = ip()) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)]), 'drawing.png');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${base}/api/jobs`, { method: 'POST', body: form, headers: { 'x-forwarded-for': from } });
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

/** Read SSE "job" events until the stream ends. */
async function events(base: string, id: string): Promise<any[]> {
  const res = await fetch(`${base}/api/jobs/${id}/events`, { headers: { 'x-forwarded-for': ip() } });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((b) => b.includes('event: job'))
    .map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
}

describe('DotDot API', () => {
  const queueName = `dots-e2e-${randomUUID().slice(0, 8)}`;
  const queuePrefix = 'dotdot-e2e';
  let dir: string;
  let s: Stack;
  let worker: ChildProcess;
  let sample: Buffer;

  /** Upload and wait for the whole set: the SSE stream ends only when every variant is final. */
  async function sheet(base: string, fields: Record<string, string> = {}) {
    const up = await upload(base, sample, fields);
    expect(up.status).toBe(202);
    const set = (await events(base, up.body.id)).at(-1);
    expect(set.status).toBe('done');
    const variants = set.result.variants as any[];
    expect(variants.length).toBeGreaterThanOrEqual(1);
    expect(variants.every((v) => v.status === 'done' || v.status === 'failed')).toBe(true);
    return { up, set, variant: variants[0] };
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dotdot-e2e-'));
    sample = await readFile(SAMPLE);
    s = await start({ queueName, queuePrefix, rateLimits: { createPerMinute: 50, createPerHour: 500, readPerMinute: 1000 } }, dir);
    worker = spawn('python3', ['-m', 'dotdot.worker'], {
      cwd: WORKER_DIR,
      env: { ...process.env, REDIS_URL, STORAGE_DIR: dir, QUEUE_NAME: queueName, QUEUE_PREFIX: queuePrefix, LOG_LEVEL: 'WARNING' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  });

  afterAll(async () => {
    worker?.kill('SIGTERM');
    await s?.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('reports health and public config', async () => {
    const h = (await (await fetch(`${s.base}/api/health`)).json()) as any;
    expect(h).toMatchObject({ ok: true, redis: true, storage: true });
    const c = (await (await fetch(`${s.base}/api/config`)).json()) as any;
    expect(c.options.defaultModeByLevel.kid).toBe('outline');
    expect(c.limits.maxUploadMb).toBe(10);
  });

  it('turns a drawing into a set of variants: upload -> SSE -> files -> cache hit', async () => {
    const { up, set, variant } = await sheet(s.base, { level: 'kid', lang: 'en' });
    expect(set.result.stats.contours).toBeGreaterThanOrEqual(1);
    expect(set.result.stats.dots_min).toBeLessThanOrEqual(set.result.stats.dots_max);
    const targets = set.result.variants.map((v: any) => v.target);
    expect(targets).toEqual([...new Set(targets)].sort((a, b) => a - b));
    expect(variant.result.stats.options).toMatchObject({ mode: 'outline', level: 'kid', lang: 'en' });
    expect(variant.result.stats.strokes).toBe(1);
    expect(variant.result.stats.dots).toBeLessThanOrEqual(variant.target);

    const pdf = await fetch(`${s.base}${variant.result.pdf}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toContain('dotdot.pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const png = await fetch(`${s.base}${variant.result.puzzle}`);
    expect(png.headers.get('content-type')).toBe('image/png');
    // the set itself has no sheet of its own
    expect((await fetch(`${s.base}/api/jobs/${up.body.id}/files/dotdot.pdf`)).status).toBe(404);

    const again = await upload(s.base, sample, { level: 'kid', lang: 'en' });
    expect(again.body.id).toBe(up.body.id);
    expect(again.body.status).toBe('done');
    expect(again.body.result.variants.every((v: any) => v.status === 'done')).toBe(true);
    const other = await upload(s.base, sample, { level: 'kid', lang: 'ru' });
    expect(other.body.id).not.toBe(up.body.id);
  });

  it('passes the grouping strategy to the worker and keys the cache on it', async () => {
    const one = await sheet(s.base, { level: 'school', strategy: 'subject' });
    expect(one.set.result.stats.strategy).toBe('subject');
    expect(one.variant.result.stats.options).toMatchObject({ strategy: 'subject' });
    const many = await sheet(s.base, { level: 'school', strategy: 'components' });
    expect(many.set.result.stats.strategy).toBe('components');
    expect(many.up.body.id).not.toBe(one.up.body.id);
    const again = await upload(s.base, sample, { level: 'school', strategy: 'subject' });
    expect(again.body.id).toBe(one.up.body.id);
  });

  it('centres three variants on the user\'s own dot count', async () => {
    const { set, variant } = await sheet(s.base, { level: 'school', target: '100' });
    expect(set.result.variants.map((v: any) => v.target)).toEqual([80, 100, 125]);
    expect(variant.result.stats.target).toBe(80);
    const view = (await (await fetch(`${s.base}/api/jobs/${variant.id}`)).json()) as any;
    expect(view.parent).toBe(set.id);
    expect((await upload(s.base, sample, { target: '9' })).status).toBe(400);
    expect((await upload(s.base, sample, { target: '1001' })).status).toBe(400);
  });

  it('explains what is wrong with a bad request', async () => {
    const form = new FormData();
    form.append('level', 'kid');
    let r = await fetch(`${s.base}/api/jobs`, { method: 'POST', body: form });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe('NO_FILE');

    let up = await upload(s.base, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    expect(up.status).toBe(415);
    expect(up.body.error.code).toBe('UNSUPPORTED_TYPE');

    up = await upload(s.base, sample, { level: 'genius' });
    expect(up.status).toBe(400);
    expect(up.body.error.code).toBe('BAD_OPTIONS');

    up = await upload(s.base, sample, { colour: 'red' });
    expect(up.status).toBe(400);

    up = await upload(s.base, Buffer.concat([sample, Buffer.alloc(11 * 1024 * 1024)]));
    expect(up.status).toBe(413);
    expect(up.body.error.code).toBe('FILE_TOO_LARGE');

    r = await fetch(`${s.base}/api/jobs/not-a-job`);
    expect(r.status).toBe(404);
    expect(((await r.json()) as any).error.code).toBe('NOT_FOUND');
    r = await fetch(`${s.base}/api/jobs/${randomUUID()}/events`);
    expect(r.status).toBe(404);
  });

  it('reports broken images as BAD_IMAGE without retrying', async () => {
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
    const up = await upload(s.base, broken);
    expect(up.status).toBe(202);
    const last = (await events(s.base, up.body.id)).at(-1);
    expect(last.status).toBe('failed');
    expect(last.error.code).toBe('BAD_IMAGE');
  });

  it('rate-limits uploads per client IP', async () => {
    const lim = await start(
      { queueName: `${queueName}-rl`, queuePrefix, rateLimits: { createPerMinute: 3, createPerHour: 100, readPerMinute: 100 } },
      dir,
    );
    try {
      const me = ip();
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await upload(lim.base, sample, { level: 'adult', lang: i % 2 ? 'ru' : 'en' }, me)).status);
      expect(codes.slice(0, 3).every((c) => c === 202)).toBe(true);
      const blocked = await upload(lim.base, sample, {}, me);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await upload(lim.base, sample, { level: 'kid' }, ip())).status).toBe(202); // other users unaffected
    } finally {
      await lim.app.close();
    }
  });

  it('shows queue position and pushes back when the queue is full', async () => {
    // a queue nobody consumes: jobs stay waiting
    const busy = await start({ queueName: `${queueName}-busy`, queuePrefix, maxWaitingJobs: 2 }, dir);
    try {
      const a = await upload(busy.base, sample, { level: 'kid' });
      const b = await upload(busy.base, sample, { level: 'adult' });
      expect([a.status, b.status]).toEqual([202, 202]);
      expect(a.body.position).toBe(1);
      expect(b.body.position).toBe(2);
      const c = await upload(busy.base, sample, { level: 'school' });
      expect(c.status).toBe(429);
      expect(c.body.error.code).toBe('BUSY');
      const r = await fetch(`${busy.base}${'/api/jobs/'}${a.body.id}/files/dotdot.pdf`);
      expect(r.status).toBe(409);
      expect(((await r.json()) as any).error.code).toBe('NOT_READY');
    } finally {
      await busy.app.close();
    }
  });

  it('edits dots: plan.json -> POST edit -> a new sheet from the same drawing', async () => {
    const { variant } = await sheet(s.base, { level: 'school', lang: 'ru' });
    const done = variant;
    expect(done.result.plan).toBe(`/api/jobs/${done.id}/files/plan.json`);
    const src = await fetch(`${s.base}${done.result.source}`);
    expect(src.headers.get('content-type')).toBe('image/png');
    const plan = (await (await fetch(`${s.base}${done.result.plan}`)).json()) as any;
    expect(plan.dots.length).toBe(done.result.stats.dots);

    // move one dot, drop the last line, switch the sheet to English
    plan.dots[0][0] += 10;
    const paths = plan.paths.slice(0, -1);
    const groups = plan.groups.slice(0, -1);
    const post = (body: unknown) =>
      fetch(`${s.base}/api/jobs/${done.id}/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
        body: JSON.stringify(body),
      });
    const r = await post({ dots: plan.dots, paths, groups, lang: 'en' });
    expect(r.status).toBe(202);
    const job = (await r.json()) as any;
    expect(job.id).not.toBe(done.id);
    const edited = (await events(s.base, job.id)).at(-1);
    expect(edited.status).toBe('done');
    expect(edited.result.stats.edited).toBe(true);
    expect(edited.result.stats.strokes).toBe(paths.length);
    expect(edited.result.stats.options).toMatchObject({ level: 'school', lang: 'en' });
    expect(edited.result.source).toBeDefined(); // the drawing travels with every version
    expect((await fetch(`${s.base}${edited.result.source}`)).status).toBe(200);
    const again = (await (await fetch(`${s.base}${edited.result.plan}`)).json()) as any;
    expect(again.lines).toEqual(plan.lines); // plain lines come from the parent, not from the client
    expect(again.v).toBe(2);
    expect(again.groups).toEqual(groups);
    expect(again.colors).toEqual(plan.colors);

    // broken edits are refused before they reach the queue
    let bad = await post({ dots: [[1e6, 0]], paths: [[0, 0]], groups: [0] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe('BAD_PLAN');
    bad = await post({ dots: plan.dots, paths: [[0, 99999]], groups: [0] });
    expect(((await bad.json()) as any).error.code).toBe('BAD_PLAN');
    bad = await post({ dots: plan.dots, paths, groups: [99] });
    expect(((await bad.json()) as any).error.code).toBe('BAD_PLAN');
    bad = await post({ dots: plan.dots, paths, groups, lines: [] });
    expect(bad.status).toBe(400); // unknown fields are rejected
    bad = await fetch(`${s.base}/api/jobs/${randomUUID()}/edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dots: [], paths: [], groups: [] }),
    });
    expect(bad.status).toBe(404);
  });

  it('numbers contours by colour and caps math answers', async () => {
    const { set, variant } = await sheet(s.base, { level: 'school', labels: 'math', math_max: '25' });
    expect(set.result.stats.options).toMatchObject({ numbering: 'color', labels: 'math', math_max: 25 });
    expect(set.result.stats.contours).toBeGreaterThanOrEqual(1);
    for (const v of set.result.variants) {
      const plan = (await (await fetch(`${s.base}${v.result.plan}`)).json()) as any;
      expect(plan.v).toBe(2);
      expect(plan.groups.length).toBe(plan.paths.length);
      const perGroup = new Map<number, number>();
      plan.paths.forEach((p: number[], i: number) => perGroup.set(plan.groups[i], (perGroup.get(plan.groups[i]) ?? 0) + p.length));
      expect(Math.max(...perGroup.values())).toBeLessThanOrEqual(25);
    }
    expect(variant.result.stats.contours).toBe(set.result.stats.contours);

    for (const math_max of ['9', '1000', 'abc']) {
      const bad = await upload(s.base, sample, { labels: 'math', math_max });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('BAD_OPTIONS');
    }
    expect((await upload(s.base, sample, { numbering: 'rainbow' })).status).toBe(400);
  });
});
