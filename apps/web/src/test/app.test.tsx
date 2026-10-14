import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { I18nProvider } from '../i18n';

const ID = '11111111-1111-4111-8111-111111111111';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let posted: FormData | null;
let jobReplies: unknown[];

beforeEach(() => {
  posted = null;
  window.location.hash = '';
  vi.stubGlobal('EventSource', undefined); // use the polling path in tests
  jobReplies = [
    { id: ID, status: 'processing', progress: 10, position: null, createdAt: 1 },
    {
      id: ID,
      status: 'done',
      progress: 100,
      position: null,
      createdAt: 1,
      result: { pdf: `/api/jobs/${ID}/files/dotdot.pdf`, puzzle: '/p.png', answer: '/a.png', stats: { dots: 48, strokes: 2 } },
    },
  ];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/config'))
      return json(200, { limits: { maxUploadMb: 10, formats: [], resultTtlHours: 24 }, donate: { cloudtips: 'https://example.org/tip' } });
    if (url.endsWith('/api/jobs') && init?.method === 'POST') {
      posted = init.body as FormData;
      return json(202, { id: ID, status: 'queued', progress: 0, position: 1, createdAt: 1 });
    }
    if (url.endsWith(`/api/jobs/${ID}`)) return json(200, jobReplies.shift() ?? jobReplies.at(-1));
    return json(404, { error: { code: 'NOT_FOUND', message: '' } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'cat.png', { type: 'image/png' });

describe('DotDot web app', () => {
  it('takes a drawing from upload to a downloadable PDF', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initial="ru">
        <App />
      </I18nProvider>,
    );
    await user.upload(screen.getByTestId('input-file'), png());
    expect(screen.getByTestId('text-filename').textContent).toBe('cat.png');

    await user.click(screen.getByTestId('radio-level-adult'));
    await user.click(screen.getByTestId('button-more'));
    await user.click(screen.getByTestId('radio-labels-math'));
    await user.click(screen.getByTestId('button-submit'));

    await waitFor(() => expect(window.location.hash).toBe(`#/job/${ID}`));
    expect(posted?.get('level')).toBe('adult');
    expect(posted?.get('labels')).toBe('math');
    expect(posted?.get('lang')).toBe('ru');
    expect(posted?.get('mode')).toBe('auto');

    await waitFor(() => expect(screen.getByTestId('text-done').textContent).toBe('48 точек ждут карандаша.'), { timeout: 5000 });
    expect(screen.getByTestId('link-download').getAttribute('href')).toBe(`/api/jobs/${ID}/files/dotdot.pdf`);
    expect(screen.getByTestId('text-lines').textContent).toBe('2');
    expect(screen.getByTestId('link-donate-cloudtips').getAttribute('href')).toBe('https://example.org/tip');

    await user.click(screen.getByTestId('tab-answer'));
    expect(screen.getByTestId('img-answer').getAttribute('src')).toBe('/a.png');

    // "another level" goes back to the settings with the same picture
    await user.click(screen.getByTestId('button-again'));
    expect(screen.getByTestId('text-filename').textContent).toBe('cat.png');
  });

  it('refuses unsupported and oversized files with a friendly hint', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(
      <I18nProvider initial="en">
        <App />
      </I18nProvider>,
    );
    await user.upload(screen.getByTestId('input-file'), new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }));
    expect(screen.getByTestId('text-error').textContent).toContain('PNG, JPG');
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('input-file'), big);
    await waitFor(() => expect(screen.getByTestId('text-error').textContent).toContain('10 MB'));
  });

  it('switches language and keeps the sheet language in step until chosen', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initial="ru">
        <App />
      </I18nProvider>,
    );
    await user.click(screen.getByTestId('button-lang-en'));
    expect(document.documentElement.lang).toBe('en');
    await act(async () => {
      await user.upload(screen.getByTestId('input-file'), png());
    });
    await user.click(screen.getByTestId('button-submit'));
    await waitFor(() => expect(posted?.get('lang')).toBe('en'));
  });
});
