// Только чтение: снимок состояния очереди BullMQ для диагностики зависших вариантов.
// Запуск на сервере: node deploy/queue-dump.cjs   (переменные берутся из .env рядом с клоном)
const path = require('node:path');
const fs = require('node:fs');

const APP_DIR = process.env.DOTDOT_APP_DIR ?? path.resolve(__dirname, '..', '..');
const ENV_FILE = process.env.DOTDOT_ENV_FILE ?? path.join(APP_DIR, '.env');
const API = path.join(APP_DIR, 'apps', 'api');

const env = {};
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const NAME = env.QUEUE_NAME ?? 'dots';
const PREFIX = env.QUEUE_PREFIX ?? 'dotdot';
const REDIS = env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const u = new URL(REDIS);
const db = u.pathname && u.pathname !== '/' ? u.pathname.slice(1) : '0';

const { Queue } = require(path.join(API, 'node_modules', 'bullmq'));
const Redis = require(path.join(API, 'node_modules', 'ioredis'));

const Q = `${PREFIX}:${NAME}`;
const ts = (ms) => (ms == null ? '-' : new Date(Number(ms)).toISOString().slice(11, 19));
const age = (ms) => `${((Date.now() - Number(ms)) / 1000).toFixed(1)} с`;
const line = (t) => console.log(`\n=== ${t} ===`);

async function main() {
  console.log(`queue ${Q} redis ${u.hostname}:${u.port || 6379}/${db}`);
  const raw = new Redis({ host: u.hostname, port: Number(u.port || 6379), db: Number(db), password: u.password || undefined });
  const queue = new Queue(NAME, { connection: { host: u.hostname, port: Number(u.port || 6379), db: Number(db), password: u.password || undefined }, prefix: PREFIX });

  line('counts');
  console.log(await queue.getJobCounts('waiting', 'paused', 'active', 'delayed', 'completed', 'failed'));

  line('meta (paused / concurrency / limiter должны отсутствовать)');
  console.log(await raw.hgetall(`${Q}:meta`));

  line('marker — пусто или score в будущем = воркеры не просыпаются');
  const marker = await raw.zrange(`${Q}:marker`, 0, -1, 'WITHSCORES');
  console.log(marker.length
    ? marker.map((v, i) => (i % 2 ? `score ${v} ${Number(v) > 1e12 ? `(проснуться в ${ts(Number(v) / 0x1000)})` : '(проснуться сейчас)'}` : `member ${v}`)).join(' | ')
    : '(пусто) — воркеры ждут сигнала, новые задачи их не разбудят');

  line('wait — кто ждёт и сколько');
  const wait = await raw.lrange(`${Q}:wait`, 0, -1);
  console.log(`длина ${wait.length}`);
  for (const id of wait.slice(0, 12)) {
    const j = await queue.getJob(id);
    console.log(` ${id} ${j?.data?.kind ?? '?'} создан ${ts(j?.timestamp)} ждёт ${age(j?.timestamp)} attempts ${j?.attemptsMade ?? '?'}`);
  }

  line('active — кто выполняется и жив ли его блокировка');
  const active = await raw.lrange(`${Q}:active`, 0, -1);
  for (const id of active) {
    const j = await queue.getJob(id);
    const ttl = await raw.pttl(`${Q}:${id}:lock`);
    console.log(` ${id} ${j?.data?.kind ?? '?'} взят ${ts(j?.processedOn)} идёт ${age(j?.processedOn)} lock TTL ${ttl} мс`);
  }
  if (!active.length) console.log('(пусто)');

  line('delayed — через сколько реально задержаны');
  const delayed = await raw.zrange(`${Q}:delayed`, 0, -1, 'WITHSCORES');
  for (let i = 0; i < delayed.length; i += 2) {
    const due = Number(delayed[i + 1]) / 0x1000;
    console.log(` ${delayed[i]} должен начаться в ${ts(due)} (${((due - Date.now()) / 1000).toFixed(1)} с) через ${age((await queue.getJob(delayed[i]))?.timestamp)}`);
  }
  if (!delayed.length) console.log('(пусто)');

  line('failed — последние 15 с причинами');
  const failed = await raw.zrange(`${Q}:failed`, 0, -1, 'REV');
  for (const id of failed.slice(0, 15)) {
    const j = await queue.getJob(id);
    console.log(` ${id} ${j?.data?.kind ?? '?'} упал ${ts(j?.finishedOn)} попыток ${j?.attemptsMade}: ${j?.failedReason ?? j?.data?.failedReason ?? '?'}`);
  }
  if (!failed.length) console.log('(пусто)');

  line('stalled / last failed set');
  console.log('stalled:', await raw.smembers(`${Q}:stalled`));

  line('последние 80 событий потока');
  const ev = await raw.xrange(`${Q}:events`, '-', '+', 'COUNT', 100000);
  for (const [id, f] of ev.slice(-80)) {
    const h = {};
    for (let i = 0; i < f.length; i += 2) h[f[i]] = f[i + 1];
    console.log(` ${id} ${h.event} ${String(h.jobId ?? '')}${h.attemptsMade ? ` att=${h.attemptsMade}` : ''}${h.failedReason ? ` :: ${String(h.failedReason).slice(0, 160)}` : ''}`);
  }

  await queue.close();
  raw.disconnect();
}

main().catch((e) => { console.error('diagnostics failed:', e); process.exit(1); });
