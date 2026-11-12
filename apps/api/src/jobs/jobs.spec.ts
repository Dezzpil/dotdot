import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { redisOptions } from '../config.js';
import { normalizeOptions } from './create-job.dto.js';
import { detectImage } from './file-type.js';
import { mapState, parseFailure } from './job-view.js';
import { checkEdit } from './edit-plan.js';

describe('detectImage', () => {
  const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);
  it('recognises formats by magic bytes', () => {
    expect(detectImage(pad([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(detectImage(pad([0xff, 0xd8, 0xff]))).toBe('jpg');
    expect(detectImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(detectImage(pad([0x42, 0x4d]))).toBe('bmp');
    expect(detectImage(Buffer.from('GIF89a........'))).toBe('gif');
  });
  it('rejects everything else', () => {
    expect(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImage(Buffer.from('%PDF-1.7 ......'))).toBeNull();
    expect(detectImage(Buffer.alloc(3))).toBeNull();
  });
});

describe('parseFailure', () => {
  it('keeps known worker codes', () => {
    expect(parseFailure('BAD_IMAGE: cannot decode image')).toEqual({ code: 'BAD_IMAGE', message: 'cannot decode image' });
    expect(parseFailure('TIMEOUT: drawing is too complex').code).toBe('TIMEOUT');
  });
  it('hides internals', () => {
    expect(parseFailure("KeyError: 'x'").code).toBe('INTERNAL');
    expect(parseFailure(undefined).code).toBe('INTERNAL');
  });
});

describe('mapState', () => {
  it('maps BullMQ states to UI statuses', () => {
    expect(mapState('waiting')).toBe('queued');
    expect(mapState('prioritized')).toBe('queued');
    expect(mapState('active')).toBe('processing');
    expect(mapState('completed')).toBe('done');
    expect(mapState('failed')).toBe('failed');
  });
});

describe('options and config', () => {
  it('fills defaults', () => {
    expect(normalizeOptions({ level: 'kid' })).toEqual({
      mode: 'auto',
      strategy: 'auto',
      numbering: 'color',
      level: 'kid',
      labels: 'numbers',
      lang: 'ru',
      math_max: 100,
    });
  });
  it('parses redis urls', () => {
    expect(redisOptions('redis://:s3cret@redis:6380/2')).toMatchObject({ host: 'redis', port: 6380, password: 's3cret', db: 2 });
    expect(redisOptions('rediss://r.example.com').tls).toEqual({});
  });
});

describe('checkEdit', () => {
  const page = { w: 595, h: 842 };
  it('normalises good edits', () => {
    const r = checkEdit({ dots: [[10.123, 20], [30, 40], [50, 60]], paths: [[0, 0, 1, 2], [2]], groups: [0, 1] }, page, 2);
    expect(r).toEqual({ dots: [[10.12, 20], [30, 40], [50, 60]], paths: [[0, 1, 2]], groups: [0] });
  });
  it('explains bad ones', () => {
    const edit = (paths: unknown[], groups: unknown[], dots: unknown[] = [[1, 1]]) => checkEdit({ dots, paths, groups }, page, 2);
    expect(edit([], [], [[1e6, 0]])).toContain('outside');
    expect(edit([], [], [['x', 0]])).toContain('[x, y]');
    expect(edit([[0, 3]], [0])).toContain('missing');
    expect(edit([[0.5]], [0])).toContain('indices');
    expect(edit([[0]], [0])).toContain('no dots');
    expect(edit([], [], Array(1501).fill([1, 1]))).toContain('too many');
  });
  it('keeps groups in step with the lines', () => {
    const edit = (groups: unknown[]) => checkEdit({ dots: [[1, 1], [2, 2]], paths: [[0, 1]], groups }, page, 2);
    expect(edit([0])).toEqual({ dots: [[1, 1], [2, 2]], paths: [[0, 1]], groups: [0] });
    expect(edit([0, 1])).toContain('every line');
    expect(edit([2])).toContain('colour index');
    expect(edit(['0'])).toContain('colour index');
    expect(edit([-1])).toContain('colour index');
  });
});
