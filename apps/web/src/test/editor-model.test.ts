import { describe, expect, it } from 'vitest';
import {
  canStartAt,
  deleteDot,
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
    const mid: Draft = { dots: d.dots, paths: [[0, 1, 2]] };
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
