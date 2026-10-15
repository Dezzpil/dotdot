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
      numbering: 'jumps',
      level: 'kid',
      labels: 'numbers',
      lang: 'ru',
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
    const r = checkEdit({ dots: [[10.123, 20], [30, 40], [50, 60]], paths: [[0, 0, 1, 2], [2]] }, page);
    expect(r).toEqual({ dots: [[10.12, 20], [30, 40], [50, 60]], paths: [[0, 1, 2]] });
  });
  it('explains bad ones', () => {
    expect(checkEdit({ dots: [[1e6, 0]], paths: [] }, page)).toContain('outside');
    expect(checkEdit({ dots: [['x', 0]], paths: [] }, page)).toContain('[x, y]');
    expect(checkEdit({ dots: [[1, 1]], paths: [[0, 3]] }, page)).toContain('missing');
    expect(checkEdit({ dots: [[1, 1]], paths: [[0.5]] }, page)).toContain('indices');
    expect(checkEdit({ dots: [[1, 1]], paths: [[0]] }, page)).toContain('no dots');
    expect(checkEdit({ dots: Array(1501).fill([1, 1]), paths: [] }, page)).toContain('too many');
  });
});
