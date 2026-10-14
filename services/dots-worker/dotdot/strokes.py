"""Chain graph edges into long pen strokes and order them for drawing."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .skeleton import Edge, Graph


@dataclass(eq=False)
class Stroke:
    pts: np.ndarray  # (N, 2) polyline
    closed: bool

    @property
    def length(self) -> float:
        d = np.diff(self.pts, axis=0)
        return float(np.hypot(d[:, 0], d[:, 1]).sum())


def _dir(pts: np.ndarray, look: float) -> np.ndarray:
    """Unit direction of travel leaving pts[0], measured `look` px along the polyline."""
    acc = 0.0
    for i in range(1, len(pts)):
        acc += float(np.hypot(*(pts[i] - pts[i - 1])))
        if acc >= look:
            break
    v = pts[i] - pts[0]
    n = np.hypot(*v)
    return v / n if n > 1e-9 else np.array([1.0, 0.0])


def chain_edges(g: Graph, edge_ids: list[int], look: float) -> list[Stroke]:
    """Greedy Euler-like walk: continue through junctions along the straightest unused edge."""
    edges = {k: g.edges[k] for k in edge_ids}
    inc: dict[int, list[int]] = {}
    for k, e in edges.items():
        inc.setdefault(e.u, []).append(k)
        if e.v != e.u:
            inc.setdefault(e.v, []).append(k)
        else:
            inc.setdefault(e.u, []).append(k)
    used: set[int] = set()
    strokes: list[Stroke] = []

    def free(nid: int) -> list[int]:
        return [k for k in inc.get(nid, []) if k not in used]

    while len(used) < len(edges):
        # prefer starting at odd nodes (endpoints) to minimise pen lifts
        cands = [n for n in inc if free(n)]
        odd = [n for n in cands if len(free(n)) % 2 == 1]
        pool = odd or cands
        start = min(pool, key=lambda n: (g.nodes[n][1], g.nodes[n][0]))
        cur, heading, parts = start, None, []
        while True:
            opts = list(dict.fromkeys(free(cur)))
            if not opts:
                break

            def oriented(k: int) -> np.ndarray:
                e: Edge = edges[k]
                return e.pts if e.u == cur else e.pts[::-1]

            if heading is None:
                k = max(opts, key=lambda k: edges[k].length)
            else:
                k = max(opts, key=lambda k: float(np.dot(heading, _dir(oriented(k), look))))
            p = oriented(k)
            used.add(k)
            parts.append(p if not parts else p[1:])
            heading = -_dir(p[::-1], look)
            e = edges[k]
            cur = e.v if e.u == cur else e.u
        pts = np.vstack(parts)
        closed = bool(np.hypot(*(pts[0] - pts[-1])) < 1.5)
        strokes.append(Stroke(pts, closed))
    return strokes


def order_strokes(strokes: list[Stroke]) -> list[Stroke]:
    """Nearest-neighbour ordering, starting from the top-most stroke."""
    if not strokes:
        return []
    rest = list(strokes)
    first = min(rest, key=lambda s: s.pts[:, 1].min())
    rest.remove(first)
    if first.closed:
        i = int(np.argmin(first.pts[:, 1]))
        first = _rotate(first, i)
    elif first.pts[-1, 1] < first.pts[0, 1]:
        first = Stroke(first.pts[::-1].copy(), False)
    out = [first]
    while rest:
        end = out[-1].pts[-1]
        best, best_d, best_s = None, np.inf, None
        for s in rest:
            if s.closed:
                d = np.hypot(*(s.pts - end).T)
                i = int(np.argmin(d))
                if d[i] < best_d:
                    best, best_d, best_s = s, d[i], _rotate(s, i)
            else:
                for cand in (s, Stroke(s.pts[::-1].copy(), False)):
                    d = float(np.hypot(*(cand.pts[0] - end)))
                    if d < best_d:
                        best, best_d, best_s = s, d, cand
        rest.remove(best)
        out.append(best_s)
    return out


def _rotate(s: Stroke, i: int) -> Stroke:
    body = s.pts[:-1]
    r = np.vstack([body[i:], body[:i], body[i:i + 1]])
    return Stroke(r, True)


def outline_edge_ids(g: Graph, ink: np.ndarray, stroke_width: float) -> list[int]:
    """Edges that run along the outer silhouette of the drawing."""
    import cv2
    from scipy.ndimage import binary_fill_holes

    sil = binary_fill_holes(ink).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(sil, connectivity=8)
    if n > 1:
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        sil = (labels == big).astype(np.uint8)
    boundary = sil - cv2.erode(sil, np.ones((3, 3), np.uint8))
    dist = cv2.distanceTransform((1 - boundary).astype(np.uint8), cv2.DIST_L2, 5)
    lim = stroke_width * 0.75 + 2
    out = []
    h, w = ink.shape
    for k, e in g.edges.items():
        p = np.clip(np.round(e.pts).astype(int), 0, [w - 1, h - 1])
        frac = float((dist[p[:, 1], p[:, 0]] <= lim).mean())
        if frac >= 0.6:
            out.append(k)
    return out
