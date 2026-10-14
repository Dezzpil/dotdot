import { describe, expect, it } from 'vitest';
import { DICTS, errorText } from '../i18n';

describe('texts', () => {
  it('declines Russian numbers', () => {
    const t = DICTS.ru;
    expect(t.doneLead(1)).toBe('1 точка ждёт карандаша.');
    expect(t.doneLead(21)).toBe('21 точка ждёт карандаша.');
    expect(t.doneLead(33)).toBe('33 точки ждут карандаша.');
    expect(t.doneLead(110)).toContain('110 точек');
    expect(t.doneLead(11)).toContain('11 точек');
    expect(t.queuedPos(1)).toContain('вы следующий');
    expect(t.queuedPos(3)).toContain('2 рисунка');
    expect(t.queuedPos(6)).toContain('5 рисунков');
  });

  it('has a friendly text for every API error code in both languages', () => {
    const codes = ['NO_FILE', 'FILE_TOO_LARGE', 'UNSUPPORTED_TYPE', 'BAD_OPTIONS', 'BAD_IMAGE', 'BUSY', 'RATE_LIMITED', 'NOT_FOUND', 'NOT_READY', 'TIMEOUT', 'NETWORK', 'INTERNAL', 'SOMETHING_NEW'];
    for (const t of Object.values(DICTS)) {
      for (const c of codes) {
        const s = errorText(t, c, { maxUploadMb: 10, retryAfterSec: 30 });
        expect(s.length).toBeGreaterThan(10);
        expect(s).not.toMatch(/[A-Z]{3,}_[A-Z]+/); // never show raw codes
      }
    }
    expect(errorText(DICTS.ru, 'FILE_TOO_LARGE', { maxUploadMb: 10 })).toContain('10 МБ');
    expect(errorText(DICTS.en, 'RATE_LIMITED', { maxUploadMb: 10, retryAfterSec: 30 })).toContain('30-second');
  });

  it('keeps both dictionaries in sync', () => {
    expect(Object.keys(DICTS.en).sort()).toEqual(Object.keys(DICTS.ru).sort());
  });
});
