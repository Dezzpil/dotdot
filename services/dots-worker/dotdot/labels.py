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
                 bounds: tuple[float, float, float, float], page_w: float, page_h: float,
                 combine: bool = True) -> list[Placed]:
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
    x_lo, y_lo, x_hi, y_hi = bounds
    angles = [math.radians(a) for a in range(0, 360, 15)]
    gaps = (dot_r + 0.8, dot_r + 2.5, dot_r + 5.0, dot_r + 8.0)

    # one label per dot when several numbers share it ("31/144"); math stays separate
    items: list[tuple[int, str]] = []
    for di, d in enumerate(plan.dots):
        texts = [plan.seq[q].text for q in d.labels]
        if combine and len(texts) > 1:
            items.append((di, "/".join(texts)))
        else:
            items += [(di, t) for t in texts]

    def away_dir(di: int) -> np.ndarray:
        nb = []
        for qi in plan.dots[di].labels:
            it = plan.seq[qi]
            path = plan.paths[it.series]
            j = path.index(qi)
            for k in (j - 1, j + 1):
                if 0 <= k < len(path):
                    nb.append(plan.dots[plan.seq[path[k]].dot].xy - plan.dots[di].xy)
        v = -np.sum([u / (np.hypot(*u) + 1e-9) for u in nb], axis=0) if nb else np.zeros(2)
        n = np.hypot(*v)
        return v / n if n > 1e-6 else np.array([0.0, -1.0])

    def box_dist(x0, y0, x1, y1):
        dx = np.maximum(np.maximum(x0 - dots_xy[:, 0], 0), dots_xy[:, 0] - x1)
        dy = np.maximum(np.maximum(y0 - dots_xy[:, 1], 0), dots_xy[:, 1] - y1)
        return np.hypot(dx, dy)

    def best_spot(di: int, tw: float, away: np.ndarray):
        best, best_c = None, 1e18
        for gap in gaps:
            for a in angles:
                v = np.array([math.cos(a), math.sin(a)])
                ext = abs(v[0]) * tw / 2 + abs(v[1]) * th / 2
                cx, cy = plan.dots[di].xy + v * (gap + ext)
                x0, y0, x1, y1 = cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2
                if x0 < x_lo or x1 > x_hi or y0 < y_lo or y1 > y_hi:
                    continue
                c = cm.cost(x0 - 0.6, y0 - 0.6, x1 + 0.6, y1 + 0.6)
                dd = box_dist(x0, y0, x1, y1)
                own = dd[di]
                dd[di] = np.inf
                other = float(dd.min()) if len(dd) > 1 else np.inf
                # a label must be clearly closer to its own dot than to any other
                margin = other - own
                if margin < 1.5:
                    c += 120.0 * (1.5 - margin)
                c += (1 - float(np.dot(v, away))) * 5.0 + (gap - dot_r) * 3.0
                if c < best_c:
                    best_c, best = c, (x0, y0, x1, y1)
        return best, best_c

    def crowd(i: int) -> float:
        d = np.hypot(*(dots_xy - dots_xy[i]).T)
        return float((d < font_size * 3).sum())

    order = sorted(range(len(items)), key=lambda i: crowd(items[i][0]), reverse=True)
    rects: dict[int, tuple] = {}
    costs: dict[int, float] = {}
    widths = {i: ctx.text_extents(items[i][1]).x_advance for i in range(len(items))}
    aways = {di: away_dir(di) for di in {d for d, _ in items}}
    LABEL_W = 500.0

    def put(i):
        di, _ = items[i]
        r, c = best_spot(di, widths[i], aways[di])
        if r is None:
            x0, y0 = plan.dots[di].xy[0] + dot_r + 1, plan.dots[di].xy[1] - th / 2
            r, c = (x0, y0, x0 + widths[i], y0 + th), 1e6
        rects[i], costs[i] = r, c
        cm.add_rect(r[0] - 0.8, r[1] - 0.8, r[2] + 0.8, r[3] + 0.8, LABEL_W)

    for i in order:
        put(i)
    # refinement: lift the worst labels and place them again with full knowledge of the others
    for _ in range(2):
        worst = sorted(costs, key=costs.get, reverse=True)[: max(5, len(items) // 6)]
        for i in worst:
            r = rects[i]
            cm.add_rect(r[0] - 0.8, r[1] - 0.8, r[2] + 0.8, r[3] + 0.8, -LABEL_W)
            put(i)

    return [Placed(r[0], r[3] - 0.4, widths[i], th, items[i][1], items[i][0]) for i, r in rects.items()]
