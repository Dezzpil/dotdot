import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { JobStatus, JobView, VariantView } from '../api';
import { I18nProvider } from '../i18n';

const SET = '11111111-1111-4111-8111-111111111111';
const vid = (i: number) => `2222222${i}-2222-4222-8222-222222222222`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PLAN = {
  v: 2,
  page: { w: 600, h: 400 },
  dotR: 2,
  dots: [
    [100, 100],
    [300, 100],
    [300, 300],
  ],
  paths: [[0, 1, 2]],
  groups: [0],
  colors: ['#1f5fbf'],
  lines: [],
};

let jobs: Record<string, JobView>;
let variants: VariantView[];
let posted: FormData | null;

/** An analyzed set: the ladder it asked for, with a state per card. */
function seed(targets: number[], states: JobStatus[] = [], custom?: number) {
  variants = targets.map((target, i) => {
    const id = vid(i);
    const status = states[i] ?? 'done';
    const v: VariantView = { id, target, status, progress: status === 'processing' ? 40 : 0, position: status === 'queued' ? i + 1 : null };
    if (status === 'done')
      v.result = {
        pdf: `/api/jobs/${id}/files/dotdot.pdf`,
        puzzle: `/p${i}.png`,
        answer: `/a${i}.png`,
        plan: `/api/jobs/${id}/files/plan.json`,
        stats: { dots: target - 3, strokes: 2, contours: 2, target },
      };
    if (status === 'failed') v.error = { code: 'BAD_IMAGE', message: 'x' };
    jobs[id] = { id, status, progress: v.progress, position: v.position, parent: SET, createdAt: 1, ...(v.result && { result: v.result }), ...(v.error && { error: v.error }) };
    return v;
  });
  jobs[SET] = {
    id: SET,
    status: 'done',
    progress: 100,
    position: null,
    createdAt: 1,
    result: {
      source: `/api/jobs/${SET}/files/source`,
      stats: { contours: 2, dots_min: 18, dots_max: 150, targets, ...(custom != null && { options: { target: custom } }) },
      variants,
    },
  };
}

/** What the server would answer after the worker finishes more cards. */
function finish(...indexes: number[]) {
  for (const i of indexes) {
    const v = variants[i];
    v.status = 'done';
    v.progress = 100;
    v.position = null;
    v.result = { puzzle: `/p${i}.png`, answer: `/a${i}.png`, pdf: `/api/jobs/${v.id}/files/dotdot.pdf`, stats: { dots: v.target - 3, strokes: 2, contours: 2 } };
    jobs[v.id] = { ...jobs[v.id], status: 'done', progress: 100, position: null, result: v.result };
  }
}

beforeEach(() => {
  jobs = {};
  posted = null;
  window.location.hash = '';
  vi.stubGlobal('EventSource', undefined); // the polling path, so tests can watch cards fill in
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/config')) return json(200, { limits: { maxUploadMb: 10, formats: [], resultTtlHours: 24 }, donate: {} });
    if (url.endsWith('/api/jobs') && init?.method === 'POST') {
      posted = init.body as FormData;
      return json(202, jobs[SET]);
    }
    if (url.endsWith('/files/plan.json')) return json(200, PLAN);
    const id = /\/api\/jobs\/([0-9a-f-]{36})$/.exec(url)?.[1];
    if (id && jobs[id]) return json(200, jobs[id]);
    return json(404, { error: { code: 'NOT_FOUND', message: '' } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'cat.png', { type: 'image/png' });

async function upload(user: ReturnType<typeof userEvent.setup>) {
  render(
    <I18nProvider initial="ru">
      <App />
    </I18nProvider>,
  );
  await user.upload(screen.getByTestId('input-file'), png());
}

describe('choosing a dot count', () => {
  it('lays out the ladder, opens the chosen sheet and comes back to the shelf', async () => {
    seed([20, 27, 36, 49, 60]);
    const user = userEvent.setup();
    await upload(user);
    await user.click(screen.getByTestId('button-submit'));

    await screen.findByTestId('screen-picker');
    expect(screen.getByTestId('text-pick-lead').textContent).toContain('5 листов');
    expect(screen.getByTestId('text-range').textContent).toBe('Рисунок держит от 18 до 150 точек.');
    expect(screen.getAllByTestId(/^variant-\d+$/)).toHaveLength(5);
    // the fact, not the aim, is the big number once the sheet exists
    expect(screen.getByTestId('variant-dots-27').textContent).toBe('24');
    expect(within(screen.getByTestId('variant-27')).getByText('цель 27')).toBeTruthy();
    expect(within(screen.getByTestId('variant-20')).getByText('как для уровня')).toBeTruthy();
    expect(screen.getByTestId('variant-img-49').getAttribute('src')).toBe('/p3.png');

    await user.click(screen.getByTestId('variant-49'));
    await waitFor(() => expect(window.location.hash).toBe(`#/job/${vid(3)}`));
    expect(await screen.findByTestId('text-dots')).toHaveProperty('textContent', '46');
    expect(screen.getByTestId('link-download').getAttribute('href')).toBe(`/api/jobs/${vid(3)}/files/dotdot.pdf`);

    await user.click(await screen.findByTestId('button-variants'));
    await waitFor(() => expect(window.location.hash).toBe(`#/job/${SET}`));
    expect(await screen.findByTestId('screen-picker')).toBeTruthy();
  });

  it('fills the cards in as they are counted and lets one failure stand alone', async () => {
    seed([20, 27, 36, 49, 60], ['done', 'processing', 'queued', 'failed', 'queued']);
    const user = userEvent.setup();
    await upload(user);
    await user.click(screen.getByTestId('button-submit'));

    await screen.findByTestId('screen-picker');
    expect(screen.getByTestId('variant-state-20').textContent).toBe('готово');
    expect(screen.getByTestId('variant-state-27').textContent).toBe('считаем');
    expect(screen.getByTestId('variant-state-36').textContent).toBe('в очереди');
    expect(screen.getByTestId('variant-state-49').textContent).toBe('не получилось');
    expect(within(screen.getByTestId('variant-49')).getByText(/Не получилось разглядеть линии/)).toBeTruthy();
    expect(screen.getByTestId('picker-progress').textContent).toContain('Готово 2 из 5');
    expect(screen.getByTestId('variant-dots-36').textContent).toBe('≈36');

    // the ready one is usable right away, the rest catch up on the next live update
    expect(screen.getByTestId('variant-20').tagName).toBe('BUTTON');
    expect(screen.getByTestId('variant-36').tagName).toBe('DIV');
    finish(1, 2, 4);
    await waitFor(() => expect(screen.queryByTestId('picker-progress')).toBeNull(), { timeout: 5000 });
    expect(screen.getByTestId('variant-36').tagName).toBe('BUTTON');
    expect(screen.getByTestId('variant-state-49').textContent).toBe('не получилось');
  });

  it('explains a drawing where every variant failed', async () => {
    seed([20, 27], ['failed', 'failed']);
    const user = userEvent.setup();
    await upload(user);
    await user.click(screen.getByTestId('button-submit'));
    expect(await screen.findByTestId('status-failed')).toBeTruthy();
    expect(screen.queryByTestId('screen-picker')).toBeNull();
  });

  it('centres three cards on your own number and marks it', async () => {
    seed([80, 100, 125], [], 100);
    const user = userEvent.setup();
    await upload(user);
    await user.click(screen.getByTestId('button-more'));
    await user.type(screen.getByTestId('input-target'), '100');
    await user.click(screen.getByTestId('button-submit'));
    expect(posted?.get('target')).toBe('100');

    await screen.findByTestId('screen-picker');
    expect(screen.getAllByTestId(/^variant-\d+$/)).toHaveLength(3);
    expect(within(screen.getByTestId('variant-100')).getByText('ваше число')).toBeTruthy();
    expect(within(screen.getByTestId('variant-80')).queryByText('как для уровня')).toBeNull();
  });

  it('keeps the dot count automatic until asked and clamps it to what the worker takes', async () => {
    seed([20, 27, 36, 49, 60]);
    const user = userEvent.setup();
    await upload(user);
    await user.click(screen.getByTestId('button-more'));
    const field = screen.getByTestId('input-target');
    expect(field).toHaveProperty('value', '');
    await user.type(field, '5');
    await user.tab();
    expect(field).toHaveProperty('value', '10');
    await user.clear(field);
    await user.tab();
    await user.click(screen.getByTestId('button-submit'));
    expect(posted?.get('target')).toBeNull();
  });

  it('compares the cards by answer sheet', async () => {
    seed([20, 27]);
    const user = userEvent.setup();
    await upload(user);
    await user.click(screen.getByTestId('button-submit'));
    await screen.findByTestId('screen-picker');
    expect(screen.getByTestId('variant-img-27').getAttribute('src')).toBe('/p1.png');
    await user.click(screen.getByTestId('picker-tab-answer'));
    expect(screen.getByTestId('variant-img-20').getAttribute('src')).toBe('/a0.png');
    expect(screen.getByTestId('variant-img-27').getAttribute('src')).toBe('/a1.png');
    await user.click(screen.getByTestId('picker-tab-puzzle'));
    expect(screen.getByTestId('variant-img-27').getAttribute('src')).toBe('/p1.png');
  });

  it('regroups the same drawing by another strategy', async () => {
    seed([20, 27]);
    jobs[SET].result!.stats.strategy = 'classes';
    const user = userEvent.setup();
    await upload(user);
    await user.click(screen.getByTestId('button-submit'));
    await screen.findByTestId('screen-picker');
    expect(screen.getByTestId('strategy-auto').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('text-strategy-chosen').textContent).toBe('выбрано: Объект и детали');
    await user.click(screen.getByTestId('strategy-components'));
    await waitFor(() => expect(posted?.get('strategy')).toBe('components'));
    expect(posted?.get('file')).toBeInstanceOf(Blob);
  });

  it('only names the strategy when the drawing is gone after a reload', async () => {
    seed([20, 27]);
    jobs[SET].result!.stats.strategy = 'subject';
    jobs[SET].result!.stats.options = { strategy: 'subject' };
    window.location.hash = `#/job/${SET}`;
    render(
      <I18nProvider initial="ru">
        <App />
      </I18nProvider>,
    );
    await screen.findByTestId('screen-picker');
    expect(screen.getByTestId('strategy-badge').textContent).toBe('Один объект');
    expect(screen.queryByTestId('strategy-components')).toBeNull();
    expect(screen.queryByTestId('text-strategy-chosen')).toBeNull();
  });

  it('walks from the shelf into the editor and back to the sheet', async () => {
    seed([20, 27]);
    const user = userEvent.setup();
    await upload(user);
    await user.click(screen.getByTestId('button-submit'));
    await screen.findByTestId('screen-picker');
    await user.click(screen.getByTestId('variant-27'));
    await user.click(await screen.findByTestId('button-edit'));
    await waitFor(() => expect(window.location.hash).toBe(`#/job/${vid(1)}/edit`));
    expect(await screen.findByTestId('text-editor-stats')).toBeTruthy();
    await user.click(screen.getByTestId('button-editor-back'));
    await waitFor(() => expect(window.location.hash).toBe(`#/job/${vid(1)}`));
    expect(await screen.findByTestId('button-variants')).toBeTruthy();
  });
});