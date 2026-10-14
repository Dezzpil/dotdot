"""Turn strokes into numbered dots."""
from __future__ import annotations

import random
from dataclasses import dataclass, field

import cv2
import numpy as np

from .strokes import Stroke


@dataclass(eq=False)
class Dot:
    xy: np.ndarray  # page coordinates (pt)
    labels: list[int] = field(default_factory=list)  # indices into Plan.seq


@dataclass(eq=False)
class SeqItem:
    dot: int
    number: int
    series: int  # stroke index (for series numbering)
    text: str = ""
    starts_stroke: bool = False


@dataclass(eq=False)
class Plan:
    dots: list[Dot]
    seq: list[SeqItem]
    paths: list[list[int]]  # per dotted stroke: list of seq indices in drawing order
    lines: list[np.ndarray]  # strokes kept as plain lines (page coords)


def rdp_indices(pts: np.ndarray, eps: float) -> list[int]:
    """Ramer-Douglas-Peucker returning indices of kept vertices."""
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = pts[i], pts[j]
        seg = pts[i + 1:j]
        d = q - p
        L = np.hypot(*d)
        if L < 1e-9:
            dist = np.hypot(*(seg - p).T)
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / L
        k = int(np.argmax(dist))
        if dist[k] > eps:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return list(np.nonzero(keep)[0])


def _subdivide(pts: np.ndarray, idx: list[int], maxseg: float) -> list[int]:
    out = [idx[0]]
    cum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])
    for i, j in zip(idx, idx[1:]):
        L = cum[j] - cum[i]
        n = int(L // maxseg)
        if n >= 1:
            for t in range(1, n + 1):
                target = cum[i] + L * t / (n + 1)
                out.append(int(np.searchsorted(cum, target)))
        out.append(j)
    return out


def simplify(s: Stroke, eps: float, dmin: float, maxseg: float = 1e9) -> np.ndarray:
    pts = s.pts
    if s.closed:
        # split the loop at the start and its farthest point, simplify both halves
        far = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
        if far == 0 or len(pts) < 4:
            return pts[:1]
        i1 = rdp_indices(pts[:far + 1], eps)
        i2 = [far + k for k in rdp_indices(pts[far:], eps)]
        idx = i1 + i2[1:]
    else:
        idx = rdp_indices(pts, eps)
    idx = _subdivide(pts, idx, maxseg)
    a = pts[idx]
    keep = [a[0]]
    for p in a[1:]:
        if np.hypot(*(p - keep[-1])) >= dmin:
            keep.append(p)
    if not s.closed and np.hypot(*(a[-1] - keep[-1])) > 1e-6:
        if len(keep) > 1 and np.hypot(*(a[-1] - keep[-1])) < dmin:
            keep[-1] = a[-1]  # always keep the true end point
        elif len(keep) == 1:
            keep.append(a[-1])
    if s.closed:
        while len(keep) > 2 and np.hypot(*(keep[-1] - keep[0])) < dmin:
            keep.pop()
    return np.array(keep)


def choose_eps(strokes: list[Stroke], target: int, dmin: float, maxseg: float) -> float:
    lo, hi = 0.3, 400.0
    for _ in range(28):
        mid = (lo * hi) ** 0.5
        n = sum(len(simplify(s, mid, dmin, maxseg)) for s in strokes)
        if n > target:
            lo = mid
        else:
            hi = mid
    return hi


def build_plan(strokes: list[Stroke], lines: list[Stroke], eps0: float, target: int, dmin: float,
               maxseg: float) -> Plan:
    """strokes/lines are already in page coordinates and in drawing order."""
    # strokes too small to hold a sensible number of dots become plain lines
    dotted = []
    for s in strokes:
        (dotted if s.length >= dmin * 2.2 else lines).append(s)
    # if the budget cannot cover every stroke, demote the shortest ones to lines
    def min_cost(s: Stroke) -> int:
        return 3 if s.closed else 2

    while dotted and sum(min_cost(s) for s in dotted) > target * 0.7 and len(dotted) > 1:
        shortest = min(dotted, key=lambda s: s.length)
        dotted.remove(shortest)
        lines.append(shortest)
    eps = eps0
    if sum(len(simplify(s, eps, dmin, maxseg)) for s in dotted) > target:
        maxseg = 1e9  # over budget: drop the extra in-between dots first
        eps = max(eps0, choose_eps(dotted, target, dmin, maxseg))

    dots: list[Dot] = []
    seq: list[SeqItem] = []
    paths: list[list[int]] = []
    merge = dmin * 0.8

    def dot_at(p: np.ndarray) -> int:
        for i, d in enumerate(dots):
            if np.hypot(*(d.xy - p)) < merge:
                return i
        dots.append(Dot(np.array(p, float)))
        return len(dots) - 1

    number = 0
    for si, s in enumerate(dotted):
        pts = simplify(s, eps, dmin, maxseg)
        ids = []
        for p in pts:
            di = dot_at(p)
            if not ids or ids[-1] != di:
                ids.append(di)
        if s.closed and len(ids) > 2:
            ids.append(ids[0])
        if len(ids) < 2:
            lines.append(s)
            continue
        path = []
        for j, di in enumerate(ids):
            number += 1
            seq.append(SeqItem(di, number, len(paths), starts_stroke=(j == 0)))
            dots[di].labels.append(len(seq) - 1)
            path.append(len(seq) - 1)
        paths.append(path)
    return Plan(dots, seq, paths, [l.pts for l in lines])


SERIES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def series_name(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = SERIES[r] + s
    return s


def math_expr(n: int, rng: random.Random, level: str) -> str:
    ops = ["+", "-"] + (["×"] if level == "adult" else [])
    op = rng.choice(ops)
    if op == "×":
        divs = [d for d in range(2, 10) if n % d == 0 and 1 < n // d <= 12]
        if divs:
            d = rng.choice(divs)
            return f"{d}×{n // d}"
        op = "+"
    if op == "+" and n >= 2:
        a = rng.randint(1, n - 1) if level != "kid" else rng.randint(max(1, n - 9), n - 1) if n > 1 else 1
        return f"{a}+{n - a}"
    b = rng.randint(1, 9 if level != "adult" else 20)
    return f"{n + b}−{b}"


def assign_texts(plan: Plan, numbering: str, labels: str, level: str, seed: int) -> None:
    rng = random.Random(seed)
    for si, path in enumerate(plan.paths):
        for j, qi in enumerate(path):
            it = plan.seq[qi]
            n = it.number if numbering == "jumps" else j + 1
            core = str(n) if labels == "numbers" else math_expr(n, rng, level)
            if numbering == "series":
                core = f"{series_name(si)}{core}" if labels == "numbers" else f"{series_name(si)}: {core}"
            it.text = core
