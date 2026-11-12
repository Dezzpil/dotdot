"""Turn strokes into numbered dots."""
from __future__ import annotations

import random
from dataclasses import dataclass, field

import cv2
import numpy as np

from .objects import INK_HEX
from .strokes import Stroke


@dataclass(eq=False)
class Dot:
    xy: np.ndarray  # page coordinates (pt)
    labels: list[int] = field(default_factory=list)  # indices into Plan.seq


@dataclass(eq=False)
class SeqItem:
    dot: int
    number: int
    series: int  # stroke index (labels.away_dir walks it)
    text: str = ""
    starts_stroke: bool = False
    group: int = 0  # object index
    group_number: int = 0  # number inside the object, restarts at 1


@dataclass(eq=False)
class Plan:
    dots: list[Dot]
    seq: list[SeqItem]
    paths: list[list[int]]  # per dotted stroke: list of seq indices in drawing order
    lines: list[np.ndarray]  # strokes kept as plain lines (page coords)
    groups: list[int] = field(default_factory=list)  # object index per path
    colors: list[str] = field(default_factory=list)  # "#rrggbb" per object
    solids: list[np.ndarray] = field(default_factory=list)  # filled areas, closed polygons (page pt)


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
    for _ in range(18):
        mid = (lo * hi) ** 0.5
        n = sum(len(simplify(s, mid, dmin, maxseg)) for s in strokes)
        if n > target:
            lo = mid
        else:
            hi = mid
    return hi


def _fit(strokes: list[Stroke], eps0: float, target: int, dmin: float,
         maxseg: float) -> tuple[float, float]:
    """Tolerance and arc subdivision that land as close to the target as the geometry allows."""
    def count(eps: float, seg: float) -> int:
        return sum(len(simplify(s, eps, dmin, seg)) for s in strokes)

    def search(lo: float, hi: float) -> float:
        """Coarsest arc step whose corners-only count still fits; count(400, ·) falls as the step grows."""
        for _ in range(10):
            mid = (lo * hi) ** 0.5
            if count(400.0, mid) > target:
                lo = mid
            else:
                hi = mid
        return hi

    seg = maxseg
    if count(400.0, maxseg) > target:
        seg = search(maxseg, maxseg * 64)  # too many corners: stretch the step between them
    elif count(eps0, maxseg) < target * 0.97:
        seg = search(dmin * 1.5, maxseg)  # room to spare: break long arcs into more dots
    return max(eps0, choose_eps(strokes, target, dmin, seg)), seg


DOT_FLOOR = 5  # a stroke that cannot hold this many dots is printed as a line, not dotted


def _quotas(sel: list[Stroke], budget: int, cost: dict[int, int]) -> dict[int, float]:
    """Water-filling: a stroke that fits its share keeps the level tolerance, the rest split the remainder."""
    quota: dict[int, float] = {}
    active, left = list(sel), float(budget)
    while active:
        total = sum(s.length for s in active)
        cheap = [s for s in active if cost[id(s)] <= left * s.length / total]
        if not cheap:
            break
        for s in cheap:
            quota[id(s)] = cost[id(s)]
            left -= cost[id(s)]
        active = [s for s in active if id(s) not in quota]
    total = sum(s.length for s in active)
    for s in active:
        quota[id(s)] = left * s.length / total if total else 0.0
    if left > 0 and not active:
        # every stroke fits: spend the rest on breaking long arcs, longest first
        total = sum(s.length for s in sel)
        for s in sel:
            quota[id(s)] += left * s.length / total
    return quota


def allocate(strokes: list[Stroke], budget: int, eps0: float, dmin: float, maxseg: float,
             floor: int = DOT_FLOOR) -> dict[int, tuple[float, float]]:
    """Share the budget by length: the longest strokes get in, each with its own tolerance.

    A stroke spends its share on bends; only a share too big for its bends is spent on
    breaking long arcs. Strokes missing from the table are printed as plain lines.
    """
    cost = {id(s): len(simplify(s, eps0, dmin)) for s in strokes}
    able = [s for s in strokes if cost[id(s)] >= floor] or list(strokes)
    order = sorted(able, key=lambda s: -s.length)
    if not order:
        return {}
    sel, quota = order, {}
    for k in range(len(order), 0, -1):
        sel = order[:k]
        quota = _quotas(sel, budget, cost)
        if min(quota.values()) >= floor:
            break
    table, rich = {}, {}
    for s in sel:
        q = max(2, round(quota[id(s)]))
        fit = ((choose_eps([s], q, dmin, 1e9), 1e9) if cost[id(s)] >= q
               else _fit([s], eps0, q, dmin, maxseg))
        table[id(s)] = fit
        # the quota is a promise, the spacing may still break it: such a stroke is printed
        if len(simplify(s, fit[0], dmin, fit[1])) >= floor:
            rich[id(s)] = fit
    return rich or table


def number_paths(dots: list[Dot], dot_paths: list[list[int]],
                 groups: list[int]) -> tuple[list[SeqItem], list[list[int]]]:
    """Both numberings at once: across the sheet and inside each object.

    A dot visited by two lines keeps one entry per visit, so it can carry two numbers."""
    seq: list[SeqItem] = []
    paths: list[list[int]] = []
    gnum: dict[int, int] = {}
    for pi, ids in enumerate(dot_paths):
        gi = groups[pi]
        path = []
        for j, di in enumerate(ids):
            gnum[gi] = gnum.get(gi, 0) + 1
            seq.append(SeqItem(di, len(seq) + 1, pi, starts_stroke=(j == 0),
                               group=gi, group_number=gnum[gi]))
            dots[di].labels.append(len(seq) - 1)
            path.append(len(seq) - 1)
        paths.append(path)
    return seq, paths


def build_plan(strokes: list[Stroke], lines: list[Stroke], eps0: float, target: int, dmin: float,
               maxseg: float, group_cap: int | None = None, colors: list[str] | None = None,
               solids: list[np.ndarray] | None = None, quota: bool = False) -> Plan:
    """strokes/lines are already in page coordinates and in drawing order.

    group_cap limits the numbers inside one object (math answers must stay small).
    quota shares the budget between strokes; otherwise dots are spread over the whole drawing."""
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

    def demote(part: list[Stroke], kept: dict[int, tuple[float, float]]) -> None:
        for s in list(part):
            if id(s) not in kept:
                dotted.remove(s)
                lines.append(s)

    if quota:
        table = allocate(dotted, target, eps0, dmin, maxseg)
        demote(dotted, table)
    else:
        eps, seg = _fit(dotted, eps0, target, dmin, maxseg) if dotted else (eps0, maxseg)
        table = {id(s): (eps, seg) for s in dotted}

    def count(s: Stroke) -> int:
        e, g = table[id(s)]
        return len(simplify(s, e, dmin, g))

    # an object over the answer limit is simplified on its own, never split
    if group_cap:
        for gi in sorted({s.group for s in dotted}):
            part = [s for s in dotted if s.group == gi]
            # a loop repeats its first dot, so it costs one number more than it has dots
            while len(part) > 1 and sum(min_cost(s) + s.closed for s in part) > group_cap:
                shortest = min(part, key=lambda s: s.length)
                part.remove(shortest)
                dotted.remove(shortest)
                lines.append(shortest)
            room = group_cap - sum(s.closed for s in part)
            if sum(count(s) for s in part) > room:
                if quota:
                    sub = allocate(part, room, eps0, dmin, maxseg)
                    demote(part, sub)
                    table.update(sub)
                else:
                    e, g = _fit(part, eps, room, dmin, seg)
                    table.update({id(s): (e, g) for s in part})

    dots: list[Dot] = []
    merge = dmin * 0.8

    def dot_at(p: np.ndarray) -> int:
        for i, d in enumerate(dots):
            if np.hypot(*(d.xy - p)) < merge:
                return i
        dots.append(Dot(np.array(p, float)))
        return len(dots) - 1

    dot_paths: list[list[int]] = []
    groups: list[int] = []
    for s in dotted:
        e, g = table[id(s)]
        pts = simplify(s, e, dmin, g)
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
        dot_paths.append(ids)
        groups.append(s.group)
    seq, paths = number_paths(dots, dot_paths, groups)
    n_groups = max(groups, default=-1) + 1
    palette = list(colors[:n_groups]) if colors else [INK_HEX] * n_groups
    return Plan(dots, seq, paths, [l.pts for l in lines], groups, palette, list(solids or []))


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
        gi = plan.groups[si]
        for qi in path:
            it = plan.seq[qi]
            n = it.number if numbering == "jumps" else it.group_number
            core = str(n) if labels == "numbers" else math_expr(n, rng, level)
            if numbering == "series":
                core = f"{series_name(gi)}{core}" if labels == "numbers" else f"{series_name(gi)}: {core}"
            it.text = core
