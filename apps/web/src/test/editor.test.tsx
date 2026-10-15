import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { I18nProvider } from '../i18n';

const ID = '22222222-2222-4222-8222-222222222222';
const NEW = '33333333-3333-4333-8333-333333333333';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PLAN = {
  v: 1,
  page: { w: 600, h: 400 },
  image: { w: 600, h: 400, s: 1, ox: 0, oy: 0 },
  dotR: 2,
  dots: [
    [100, 100],
    [300, 100],
    [300, 300],
    [100, 300],
  ],
  paths: [[0, 1, 2, 3, 0]],
  lines: [],
};
const done = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'done',
  progress: 100,
  position: null,
  createdAt: 1,
  result: {
    pdf: `/api/jobs/${id}/files/dotdot.pdf`,
    puzzle: '/p.png',
    answer: '/a.png',
    plan: `/api/jobs/${id}/files/plan.json`,
    source: `/api/jobs/${id}/files/source`,
    stats: { dots: 4, strokes: 1, options: { numbering: 'jumps' }, ...extra },
  },
});

let edited: any;

beforeEach(() => {
  edited = null;
  window.location.hash = `#/job/${ID}`;
  vi.stubGlobal('EventSource', undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/config')) return json(200, { limits: { maxUploadMb: 10, formats: [], resultTtlHours: 24 }, donate: {} });
    if (url.endsWith(`/api/jobs/${ID}/files/plan.json`)) return json(200, PLAN);
    if (url.endsWith(`/api/jobs/${ID}/edit`)) {
      edited = JSON.parse(String(init?.body));
      return json(202, { id: NEW, status: 'queued', progress: 0, position: 1, createdAt: 2 });
    }
    if (url.endsWith(`/api/jobs/${ID}`)) return json(200, done(ID));
    if (url.endsWith(`/api/jobs/${NEW}`)) return json(200, done(NEW, { edited: true, dots: 3 }));
    return json(404, { error: { code: 'NOT_FOUND', message: '' } });
  });
  // happy-dom has no layout: make 1 css px == 1 pt so pointer maths is easy to follow
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    right: 600,
    bottom: 400,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pointer = (el: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) =>
  fireEvent[type](el, { clientX: x, clientY: y, button: 0, pointerId: 1 });

describe('dot editor', () => {
  it('opens from the result, edits dots and builds a new sheet', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initial="ru">
        <App />
      </I18nProvider>,
    );
    await user.click(await screen.findByTestId('button-edit'));
    expect(window.location.hash).toBe(`#/job/${ID}/edit`);
    const canvas = await screen.findByTestId('editor-canvas');
    expect(screen.getByTestId('text-editor-stats').textContent).toBe('4 точки · 1 линия');

    // drag dot 2 (index 1) to the right
    pointer(canvas, 'pointerDown', 300, 100);
    pointer(canvas, 'pointerMove', 320, 110);
    pointer(canvas, 'pointerMove', 340, 120);
    pointer(canvas, 'pointerUp', 340, 120);
    expect(screen.getByTestId('panel-selected').textContent).toContain('Точка 2');

    // add a dot in the middle of the bottom edge, then remove the first corner
    await user.click(screen.getByTestId('tool-add'));
    pointer(canvas, 'pointerDown', 200, 302);
    await user.click(screen.getByTestId('tool-delete'));
    pointer(canvas, 'pointerDown', 100, 100);
    await user.click(screen.getByTestId('tool-move'));
    expect(screen.getByTestId('text-editor-stats').textContent).toBe('4 точки · 1 линия');

    // undo the delete, redo it
    await user.click(screen.getByTestId('button-undo'));
    expect(screen.getByTestId('text-editor-stats').textContent).toBe('5 точек · 1 линия');
    await user.click(screen.getByTestId('button-redo'));

    await user.click(screen.getByTestId('button-save'));
    await waitFor(() => expect(window.location.hash).toBe(`#/job/${NEW}`));
    expect(edited.dots).toEqual([
      [340, 120],
      [300, 300],
      [100, 300],
      [200, 300],
    ]);
    expect(edited.paths).toEqual([[0, 1, 3, 2, 0]]);
    expect(await screen.findByTestId('text-edited')).toBeTruthy();
  });

  it('explains when an old sheet cannot be edited', async () => {
    (globalThis.fetch as any).mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/api/config')) return json(200, { limits: { maxUploadMb: 10, formats: [], resultTtlHours: 24 }, donate: {} });
      const v = done(ID) as any;
      delete v.result.plan;
      return json(200, v);
    });
    window.location.hash = `#/job/${ID}/edit`;
    render(
      <I18nProvider initial="en">
        <App />
      </I18nProvider>,
    );
    expect((await screen.findByTestId('status-editor-failed')).textContent).toContain('before the editor');
  });
});
