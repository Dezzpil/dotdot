"""Chain graph edges into long pen strokes and order them for drawing."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .skeleton import Edge, Graph


@dataclass(eq=False)
class Stroke:
    pts: np.ndarray  # (N, 2) polyline
    closed: bool
    edge_ids: list = field(default_factory=list)  # real graph edges used (virtual bridges excluded)

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


def _bridges(g: Graph, edges: dict[int, Edge], max_gap: float) -> dict[int, Edge]:
    """Invisible links between odd-degree nodes that almost touch: each one removes a pen lift."""
    deg: dict[int, int] = {}
    for e in edges.values():
        deg[e.u] = deg.get(e.u, 0) + 1
        deg[e.v] = deg.get(e.v, 0) + 1
    odd = [n for n, d in deg.items() if d % 2]
    adj: dict[int, list[tuple[int, float]]] = {}
    for e in edges.values():
        adj.setdefault(e.u, []).append((e.v, e.length))
        adj.setdefault(e.v, []).append((e.u, e.length))

    def path_len(a: int, b: int, cutoff: float) -> float:
        """Shortest graph distance a->b, or inf if longer than cutoff (bounded Dijkstra)."""
        import heapq
        best = {a: 0.0}
        q = [(0.0, a)]
        while q:
            d, n = heapq.heappop(q)
            if n == b:
                return d
            if d > best.get(n, np.inf) or d > cutoff:
                continue
            for m, w in adj.get(n, []):
                nd = d + w
                if nd < best.get(m, np.inf) and nd <= cutoff:
                    best[m] = nd
                    heapq.heappush(q, (nd, m))
        return np.inf

    pairs = []
    for i, a in enumerate(odd):
        for b in odd[i + 1:]:
            d = float(np.hypot(*(g.nodes[a] - g.nodes[b])))
            # skip nodes already joined by a short path: a bridge there just makes a tiny loop
            if d < max_gap and path_len(a, b, max(4 * d, max_gap * 3)) == np.inf:
                pairs.append((d, a, b))
    used: set[int] = set()
    out: dict[int, Edge] = {}
    for d, a, b in sorted(pairs):
        if a in used or b in used:
            continue
        used |= {a, b}
        out[-1 - len(out)] = Edge(a, b, np.array([g.nodes[a], g.nodes[b]]))
    return out


def chain_edges(g: Graph, edge_ids: list[int], look: float, bridge: float = 0.0,
                start_top: bool = False) -> list[Stroke]:
    """Greedy Euler-like walk: continue through junctions along the straightest unused edge.

    With start_top the first walk begins at the odd node closest to the top of the drawing,
    so dot 1 lands near the top and the first stroke is returned first."""
    edges = {k: g.edges[k] for k in edge_ids}
    if bridge > 0:
        edges.update(_bridges(g, edges, bridge))
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
        if start_top and not strokes:
            top = min((e.pts[int(np.argmin(e.pts[:, 1]))] for e in edges.values() if len(e.pts)),
                      key=lambda p: p[1])
            start = min(pool, key=lambda n: float(np.hypot(*(g.nodes[n] - top))))
        else:
            # long open chains first: start at the odd node whose free edges are the longest
            start = max(pool, key=lambda n: sum(edges[k].length for k in free(n)))
        cur, heading, parts, ids = start, None, [], []
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
            if k >= 0:
                ids.append(k)
            parts.append(p if not parts else p[1:])
            heading = -_dir(p[::-1], look)
            e = edges[k]
            cur = e.v if e.u == cur else e.u
        if not ids:
            continue
        pts = np.vstack(parts)
        closed = bool(np.hypot(*(pts[0] - pts[-1])) < 1.5)
        strokes.append(Stroke(pts, closed, ids))
    return strokes


def order_strokes(strokes: list[Stroke], keep_first: bool = False) -> list[Stroke]:
    """Nearest-neighbour ordering. Dot 1 goes to the top: either the first stroke as walked
    (keep_first) or the top-most stroke; closed loops are rotated to their top point."""
    if not strokes:
        return []
    rest = list(strokes)
    first = rest[0] if keep_first else min(rest, key=lambda s: s.pts[:, 1].min())
    rest.remove(first)
    if first.closed:
        i = int(np.argmin(first.pts[:, 1]))
        first = _rotate(first, i)
    elif not keep_first and first.pts[-1, 1] < first.pts[0, 1]:
        first = Stroke(first.pts[::-1].copy(), False, first.edge_ids)
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
                for cand in (s, Stroke(s.pts[::-1].copy(), False, s.edge_ids)):
                    d = float(np.hypot(*(cand.pts[0] - end)))
                    if d < best_d:
                        best, best_d, best_s = s, d, cand
        rest.remove(best)
        out.append(best_s)
    return out


def start_at_top(strokes: list[Stroke], min_tail: float) -> list[Stroke]:
    """Put dot 1 at the top of the drawing (where people expect it).

    The stroke holding the top-most point goes first. A closed loop is rotated to that point;
    an open stroke is split there into two branches that both start at the top (one extra
    pen lift, but the start is obvious). Tiny tails are not worth a split: start at the end."""
    if not strokes:
        return strokes
    si = min(range(len(strokes)), key=lambda i: strokes[i].pts[:, 1].min())
    s = strokes[si]
    rest = strokes[:si] + strokes[si + 1:]
    i = int(np.argmin(s.pts[:, 1]))
    if s.closed:
        return [_rotate(s, i)] + rest
    head, tail = s.pts[:i + 1][::-1], s.pts[i:]
    seg = lambda p: float(np.hypot(*np.diff(p, axis=0).T).sum()) if len(p) > 1 else 0.0  # noqa: E731
    if seg(head) < min_tail:
        return [Stroke(tail.copy(), False, s.edge_ids)] + rest
    if seg(tail) < min_tail:
        return [Stroke(head.copy(), False, s.edge_ids)] + rest
    # longer branch first, the other one is ordered like any other stroke
    a, b = (head, tail) if seg(head) >= seg(tail) else (tail, head)
    return [Stroke(a.copy(), False, s.edge_ids), Stroke(b.copy(), False, s.edge_ids)] + rest


def _rotate(s: Stroke, i: int) -> Stroke:
    body = s.pts[:-1]
    r = np.vstack([body[i:], body[:i], body[i:i + 1]])
    return Stroke(r, True, s.edge_ids)


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
