"""Greedy collision-aware placement of dot labels."""
from __future__ import annotations

import math
from dataclasses import dataclass

import cairo
import cv2
import numpy as np

from .dots import Plan

GRID = 2.0  # cells per pt


@dataclass
class Placed:
    x: float  # text origin (baseline-left), pt
    y: float
    w: float
    h: float
    text: str
    dot: int


class CostMap:
    def __init__(self, w: float, h: float):
        self.a = np.zeros((int(h * GRID) + 2, int(w * GRID) + 2), np.float32)

    def _box(self, x0, y0, x1, y1):
        H, W = self.a.shape
        return (max(int(y0 * GRID), 0), min(int(math.ceil(y1 * GRID)), H),
                max(int(x0 * GRID), 0), min(int(math.ceil(x1 * GRID)), W))

    def add_rect(self, x0, y0, x1, y1, wgt):
        r0, r1, c0, c1 = self._box(x0, y0, x1, y1)
        if r1 > r0 and c1 > c0:
            self.a[r0:r1, c0:c1] += wgt

    def add_disc(self, cx, cy, r, wgt):
        r0, r1, c0, c1 = self._box(cx - r, cy - r, cx + r, cy + r)
        if r1 <= r0 or c1 <= c0:
            return
        yy, xx = np.mgrid[r0:r1, c0:c1]
        m = (xx / GRID - cx) ** 2 + (yy / GRID - cy) ** 2 <= r * r
        self.a[r0:r1, c0:c1] += m * wgt

    def add_segment(self, p, q, half, wgt):
        L = float(np.hypot(*(q - p)))
        steps = max(int(L * GRID / 1.0), 1)
        for t in np.linspace(0, 1, steps + 1):
            c = p + (q - p) * t
            self.add_rect(c[0] - half, c[1] - half, c[0] + half, c[1] + half, wgt / max(1, steps) * 4)

    def cost(self, x0, y0, x1, y1) -> float:
        r0, r1, c0, c1 = self._box(x0, y0, x1, y1)
        if r1 <= r0 or c1 <= c0:
            return 1e9
        return float(self.a[r0:r1, c0:c1].sum())


def place_labels(plan: Plan, ctx: cairo.Context, font_size: float, dot_r: float,
                 bounds: tuple[float, float, float, float], page_w: float, page_h: float) -> list[Placed]:
    cm = CostMap(page_w, page_h)
    shape = cm.a.shape
    lay_dots = np.zeros(shape, np.uint8)
    lay_segs = np.zeros(shape, np.uint8)
    lay_lines = np.zeros(shape, np.uint8)
    g = GRID
    for d in plan.dots:
        cv2.circle(lay_dots, (int(d.xy[0] * g), int(d.xy[1] * g)), int((dot_r + 1.2) * g), 1, -1)
    for path in plan.paths:
        pts = np.array([plan.dots[plan.seq[i].dot].xy * g for i in path], np.int32)
        cv2.polylines(lay_segs, [pts], False, 1, max(1, int(1.2 * g)))
    for line in plan.lines:
        cv2.polylines(lay_lines, [np.round(line * g).astype(np.int32)], False, 1, max(1, int(1.6 * g)))
    cm.a += lay_dots * 400.0 + lay_lines * 30.0 + lay_segs * 6.0

    ctx.set_font_size(font_size)
    asc, desc, _, _, _ = ctx.font_extents()
    th = asc * 0.78 + 0.8  # digits have cap height ~0.73 em
    dots_xy = np.array([d.xy for d in plan.dots])

    # crowded dots first: they have the fewest good spots
    def crowd(i: int) -> float:
        d = np.hypot(*(dots_xy - dots_xy[i]).T)
        return float((d < font_size * 3).sum() + 0.5 * len(plan.dots[i].labels))

    order = sorted(range(len(plan.dots)), key=crowd, reverse=True)
    angles = [math.radians(a) for a in range(0, 360, 20)]
    placed: list[Placed] = []
    x_lo, y_lo, x_hi, y_hi = bounds
    for di in order:
        d = plan.dots[di]
        # preferred direction: away from the neighbouring dots of its sequence
        nb = []
        for qi in d.labels:
            it = plan.seq[qi]
            path = plan.paths[it.series]
            j = path.index(qi)
            for k in (j - 1, j + 1):
                if 0 <= k < len(path):
                    nb.append(plan.dots[plan.seq[path[k]].dot].xy - d.xy)
        away = -np.sum([v / (np.hypot(*v) + 1e-9) for v in nb], axis=0) if nb else np.zeros(2)
        an = np.hypot(*away)
        away = away / an if an > 1e-6 else np.array([0.0, -1.0])
        for qi in d.labels:
            text = plan.seq[qi].text
            te = ctx.text_extents(text)
            tw = te.x_advance
            best, best_c = None, 1e18
            for gap in (dot_r + 1.0, dot_r + 3.0, dot_r + 6.0):
                for a in angles:
                    v = np.array([math.cos(a), math.sin(a)])
                    ext = abs(v[0]) * tw / 2 + abs(v[1]) * th / 2
                    cx, cy = d.xy + v * (gap + ext)
                    x0, y0, x1, y1 = cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2
                    if x0 < x_lo or x1 > x_hi or y0 < y_lo or y1 > y_hi:
                        continue
                    c = cm.cost(x0 - 0.6, y0 - 0.6, x1 + 0.6, y1 + 0.6)
                    # ambiguity: another dot closer to the label than its own dot
                    dd = np.hypot(dots_xy[:, 0] - cx, dots_xy[:, 1] - cy)
                    own = dd[di]
                    dd[di] = np.inf
                    if dd.min() < own:
                        c += 60.0 * (own - dd.min() + 1)
                    c += (1 - float(np.dot(v, away))) * 6.0 + gap * 2.0
                    if c < best_c:
                        best_c, best = c, (x0, y0, x1, y1)
            if best is None:
                x0, y0 = d.xy[0] + dot_r + 1, d.xy[1] - th / 2
                best = (x0, y0, x0 + tw, y0 + th)
            x0, y0, x1, y1 = best
            cm.add_rect(x0 - 0.8, y0 - 0.8, x1 + 0.8, y1 + 0.8, 500.0)
            placed.append(Placed(x0 - te.x_bearing * 0, y1 - 0.4, tw, th, text, di))
    return placed
