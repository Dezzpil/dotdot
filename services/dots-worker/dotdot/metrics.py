"""Objective quality metrics for a laid-out puzzle (used by tests and tuning)."""
from __future__ import annotations

import numpy as np

from .dots import Plan
from .labels import Placed


def _rect(p: Placed):
    return p.x, p.y - p.h, p.x + p.w, p.y


def _overlap(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _seg_hits_rect(p, q, r, pad=0.0) -> bool:
    x0, y0, x1, y1 = r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad
    for t in np.linspace(0, 1, 12):
        c = p + (q - p) * t
        if x0 <= c[0] <= x1 and y0 <= c[1] <= y1:
            return True
    return False


def evaluate(plan: Plan, placed: list[Placed], dot_r: float) -> dict:
    rects = [_rect(p) for p in placed]
    xy = np.array([d.xy for d in plan.dots])
    lab_lab = int(sum(_overlap(rects[i], rects[j]) for i in range(len(rects)) for j in range(i + 1, len(rects))))
    lab_dot = ambiguous = lab_line = lab_seg = 0
    for p, r in zip(placed, rects):
        cx, cy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
        for i, (x, y) in enumerate(xy):
            if r[0] - dot_r < x < r[2] + dot_r and r[1] - dot_r < y < r[3] + dot_r:
                lab_dot += 1
        # ambiguity: distance from label box to own dot vs nearest other dot
        def box_d(x, y):
            dx = max(r[0] - x, 0, x - r[2])
            dy = max(r[1] - y, 0, y - r[3])
            return float(np.hypot(dx, dy))
        own = box_d(*xy[p.dot])
        others = [box_d(x, y) for i, (x, y) in enumerate(xy) if i != p.dot]
        if others and min(others) < own - 0.5:
            ambiguous += 1
        for line in plan.lines:
            if any(_seg_hits_rect(a, b, r) for a, b in zip(line, line[1:])):
                lab_line += 1
                break
        for path in plan.paths:
            if any(_seg_hits_rect(xy[plan.seq[a].dot], xy[plan.seq[b].dot], r, -0.5) for a, b in zip(path, path[1:])):
                lab_seg += 1
                break
    multi = sum(1 for d in plan.dots if len(d.labels) > 1)
    return {"labels": len(placed), "label_overlaps": lab_lab, "label_on_dot": lab_dot,
            "ambiguous": ambiguous, "label_on_line": lab_line, "label_on_solution": lab_seg,
            "strokes": len(plan.paths), "multi_number_dots": multi}
