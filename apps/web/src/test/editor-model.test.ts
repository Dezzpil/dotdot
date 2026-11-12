import { describe, expect, it } from 'vitest';
import {
  canStartAt,
  cutSegment,
  draftOf,
  INK_HEX,
  isClosed,
  mergeDots,
  planColors,
  Pt,
  unmergeDot,
  visits,
  deleteDot,
  dotLabelRuns,
  dotLabels,
  Draft,
  history,
  insertDot,
  moveDot,
  nearestDot,
  nearestSegment,
  squash,
  startAt,
} from '../editor/model';

// a square loop 0-1-2-3-0 and an open tail 4-5
const d: Draft = {
  dots: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [20, 0],
    [30, 0],
  ],
  paths: [
    [0, 1, 2, 3, 0],
    [4, 5],
  ],
  groups: [0, 1],
};

describe('editor model', () => {
  it('moves a dot without touching the order', () => {
    const m = moveDot(d, 2, [12.345, 11]);
    expect(m.dots[2]).toEqual([12.35, 11]);
    expect(m.paths).toBe(d.paths);
    expect(d.dots[2]).toEqual([10, 10]); // immutable
  });

  it('deletes a dot and keeps the loop closed', () => {
    const r = deleteDot(d, 1);
    expect(r.dots).toHaveLength(5);
    expect(r.paths).toEqual([
      [0, 1, 2, 0],
      [3, 4],
    ]);
  });

  it('deleting the start of a loop starts it at the next dot', () => {
    const r = deleteDot(d, 0);
    expect(r.paths[0]).toEqual([0, 1, 2, 0]); // was 1-2-3-1, renumbered
  });

  it('drops lines that become too short', () => {
    const r = deleteDot(d, 4);
    expect(r.paths).toEqual([[0, 1, 2, 3, 0]]);
    const tri = deleteDot(deleteDot(d, 3), 2);
    expect(tri.paths[0]).toEqual([0, 1]); // a two-dot "loop" is just a segment
  });

  it('inserts a dot into the chosen segment', () => {
    const r = insertDot(d, 0, 1, [10, 5]);
    expect(r.dots[6]).toEqual([10, 5]);
    expect(r.paths[0]).toEqual([0, 1, 6, 2, 3, 0]);
  });

  it('finds the segment under the pointer but not the dots at its ends', () => {
    expect(nearestSegment(d, [10.5, 5], 2)).toMatchObject({ path: 0, seg: 1, point: [10, 5] });
    expect(nearestSegment(d, [10, 0.2], 2)).toBeNull();
    expect(nearestSegment(d, [5, 5], 2)).toBeNull();
    expect(nearestDot(d, [9, 1], 3)).toBe(1);
  });

  it('numbers dots like the sheet does', () => {
    expect(dotLabels(d, 'jumps')).toEqual(['1/5', '2', '3', '4', '6', '7']);
    expect(dotLabels(d, 'series')).toEqual(['A1/A5', 'A2', 'A3', 'A4', 'B1', 'B2']);
  });

  it('moves the start of a line', () => {
    expect(canStartAt(d, 2)).toBe(true);
    expect(canStartAt(d, 0)).toBe(false);
    expect(startAt(d, 2).paths[0]).toEqual([2, 3, 0, 1, 2]);
    const flipped = startAt(d, 5);
    expect(flipped.paths[0]).toEqual([5, 4]); // that line now goes first
    expect(canStartAt(d, 4)).toBe(true); // already starts its line: the line just moves first
    expect(startAt(d, 4).paths).toEqual([
      [4, 5],
      [0, 1, 2, 3, 0],
    ]);
    const mid: Draft = { dots: d.dots, paths: [[0, 1, 2]], groups: [0] };
    expect(canStartAt(mid, 1)).toBe(false);
  });

  it('undoes and redoes, a drag is one step', () => {
    let h = history({ past: [], present: d, future: [] }, { type: 'begin' });
    h = history(h, { type: 'live', draft: moveDot(h.present, 0, [1, 1]) });
    h = history(h, { type: 'live', draft: moveDot(h.present, 0, [2, 2]) });
    expect(h.past).toHaveLength(1);
    h = history(h, { type: 'undo' });
    expect(h.present).toBe(d);
    h = history(h, { type: 'redo' });
    expect(h.present.dots[0]).toEqual([2, 2]);
    // a click without movement leaves no empty step
    expect(squash(history(h, { type: 'begin' })).past).toHaveLength(1);
  });
});

describe('merge, cut, unmerge', () => {
  const pt = (n: number): Pt[] => Array.from({ length: n }, (_, i) => [i * 10, i] as Pt);

  it('joins the ends of two open lines into one line', () => {
    // line A: 0-1-2, line B: 3-4-5; merge 2 into 3
    const d: Draft = { dots: pt(6), paths: [[0, 1, 2], [3, 4, 5]], groups: [0, 1] };
    const { draft, kind } = mergeDots(d, 2, 3);
    expect(kind).toBe('joined');
    expect(draft.dots).toHaveLength(5);
    expect(draft.paths).toEqual([[0, 1, 2, 3, 4]]);
    expect(draft.dots[2]).toEqual([30, 3]); // the dot kept the target position
  });

  it('flips lines so that the merged ends meet', () => {
    const d: Draft = { dots: pt(6), paths: [[0, 1, 2], [3, 4, 5]], groups: [0, 1] };
    // start of A (dot 0) into the end of B (dot 5): 2-1 then 5-4-3
    const { draft, kind } = mergeDots(d, 0, 5);
    expect(kind).toBe('joined');
    expect(draft.paths).toHaveLength(1);
    expect(draft.paths[0].map((k) => draft.dots[k][0])).toEqual([20, 10, 50, 40, 30]);
  });

  it('closes a line when its two ends merge', () => {
    const d: Draft = { dots: pt(4), paths: [[0, 1, 2, 3]], groups: [0] };
    const { draft, kind } = mergeDots(d, 3, 0);
    expect(kind).toBe('closed');
    expect(draft.paths).toEqual([[0, 1, 2, 0]]);
    expect(isClosed(draft.paths[0])).toBe(true);
  });

  it('merges neighbours inside a line without leaving a double dot', () => {
    const d: Draft = { dots: pt(4), paths: [[0, 1, 2, 3]], groups: [0] };
    const { draft, kind } = mergeDots(d, 1, 2);
    expect(kind).toBe('merged');
    expect(draft.paths).toEqual([[0, 1, 2]]);
  });

  it('a merged middle dot gets two numbers and can be split again', () => {
    const d: Draft = { dots: pt(6), paths: [[0, 1, 2], [3, 4, 5]], groups: [0, 1] };
    const { draft } = mergeDots(d, 1, 4); // middles: no joining
    expect(draft.paths).toEqual([[0, 3, 1], [2, 3, 4]]);
    expect(visits(draft, 3)).toBe(2);
    expect(dotLabels(draft, 'jumps')[3]).toBe('2/5');
    const back = unmergeDot(draft, 3, { w: 1000, h: 1000 });
    expect(back.dots).toHaveLength(6);
    expect(back.paths).toEqual([[0, 3, 1], [2, 5, 4]]);
    expect(visits(back, 3)).toBe(1);
  });

  it('unmerge keeps a loop closed', () => {
    const d: Draft = { dots: pt(5), paths: [[0, 1, 2, 0], [3, 0, 4]], groups: [0, 1] };
    const back = unmergeDot(d, 0, { w: 1000, h: 1000 });
    expect(back.paths[0]).toEqual([0, 1, 2, 0]);
    expect(back.paths[1]).toEqual([3, 5, 4]);
  });

  it('cuts an open line in two, the second part right after the first', () => {
    const d: Draft = { dots: pt(6), paths: [[0, 1, 2, 3], [4, 5]], groups: [0, 1] };
    const out = cutSegment(d, 0, 1);
    expect(out.paths).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(dotLabels(out, 'jumps')).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('opens a loop at the cut', () => {
    const d: Draft = { dots: pt(4), paths: [[0, 1, 2, 3, 0]], groups: [0] };
    expect(cutSegment(d, 0, 1).paths).toEqual([[2, 3, 0, 1]]);
    expect(cutSegment(d, 0, 3).paths).toEqual([[0, 1, 2, 3]]);
  });

  it('drops a dot left alone by a cut at the end of a line', () => {
    const d: Draft = { dots: pt(4), paths: [[0, 1, 2, 3]], groups: [0] };
    const out = cutSegment(d, 0, 2);
    expect(out.dots).toHaveLength(3);
    expect(out.paths).toEqual([[0, 1, 2]]);
  });
});

describe('contours', () => {
  const pt = (n: number): Pt[] => Array.from({ length: n }, (_, i) => [i * 10, i] as Pt);

  it('keeps a colour for every line through the edits', () => {
    expect(deleteDot(d, 4).groups).toEqual([0]); // the tail was the second contour, it is gone
    const two: Draft = { dots: pt(6), paths: [[0, 1, 2, 3], [4, 5]], groups: [0, 1] };
    expect(cutSegment(two, 0, 1).groups).toEqual([0, 0, 1]);
    expect(startAt(d, 4).groups).toEqual([1, 0]);
    const joined = mergeDots({ dots: pt(6), paths: [[0, 1, 2], [3, 4, 5]], groups: [1, 0] }, 2, 3);
    expect(joined.draft.groups).toEqual([1]); // the first line's colour wins
  });

  it('counts inside a contour in colour mode, across all of its lines', () => {
    expect(dotLabels(d, 'color')).toEqual(['1/5', '2', '3', '4', '1', '2']);
    const same: Draft = { dots: pt(6), paths: [[0, 1, 2], [3, 4, 5]], groups: [0, 0] };
    expect(dotLabels(same, 'color')).toEqual(['1', '2', '3', '4', '5', '6']);
    const apart: Draft = { ...same, groups: [0, 1] };
    expect(dotLabels(apart, 'color')).toEqual(['1', '2', '3', '1', '2', '3']);
    expect(dotLabelRuns(d, 'color')[0]).toEqual([
      { text: '1', group: 0 },
      { text: '5', group: 0 },
    ]);
    expect(dotLabelRuns(d, 'jumps')[0]).toEqual([{ text: '1/5', group: 0 }]);
  });

  it('reads a plan of either version', () => {
    const page = { w: 100, h: 100 };
    const v2 = { v: 2 as const, page, dotR: 2, dots: pt(4), paths: [[0, 1], [2, 3]], groups: [1, 1], colors: ['#000000', '#ff0000'], lines: [] };
    expect(draftOf(v2).groups).toEqual([1, 1]);
    expect(planColors(v2)).toEqual(['#000000', '#ff0000']);
    const v1 = { v: 1 as const, page, dotR: 2, dots: pt(4), paths: [[0, 1], [2, 3]], lines: [] };
    expect(draftOf(v1).groups).toEqual([0, 1]);
    expect(planColors(v1)).toEqual([INK_HEX, INK_HEX]);
  });
});
