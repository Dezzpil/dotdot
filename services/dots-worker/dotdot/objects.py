"""Objects on the drawing: one object = one colour = one numbering starting at 1.

A drawing often holds several things (a cat and a ball). Connected components alone would
split the cat into silhouette, eye and spots, so small parts are absorbed by the object
they sit inside or almost touch. Two comparable objects are never merged.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations

import cv2
import numpy as np
from scipy.ndimage import binary_fill_holes

from .skeleton import Graph

PALETTE = ("#1f5fbf", "#d9480f", "#2b8a3e", "#7048e8", "#0b7285", "#a61e4d")
INK_HEX = "#212129"
MAX_GROUPS = len(PALETTE)
# a part this much smaller than its neighbour may be a detail of it, not an object of its own
PART_AREA = 0.25
# similarity tolerances for repeated decoration: area, aspect, solidity
SIM_TOL = (float(np.log(1.8)), float(np.log(1.35)), 0.15)
# a repeated part this big and this far from the subject is a scene element, not decoration
CLASS_BIG = 0.05
CLASS_FAR = 2.0


@dataclass
class Objects:
    count: int
    colors: list[str]
    masks: list[np.ndarray]  # per group: bool mask of its ink (image px)
    of_edge: dict[int, int] = field(default_factory=dict)
    of_node: dict[int, int] = field(default_factory=dict)
    tops: list[float] = field(default_factory=list)  # top-most ink y per group, drawing order
    comp_of_node: dict[int, int] = field(default_factory=dict)  # connected component per node


@dataclass
class Components:
    lab: np.ndarray
    stats: np.ndarray
    cent: np.ndarray
    ids: list[int]  # by filled area, largest first
    box: dict[int, tuple[int, int, int, int]]
    filled: dict[int, np.ndarray]
    area: dict[int, int]  # silhouette area, holes filled
    gap: float
    pad: int


class _Groups:
    """Union-find over components, tracking the silhouette area of each merged group."""

    def __init__(self, ids, area):
        self.parent = {i: i for i in ids}
        self.garea = dict(area)

    def find(self, i: int) -> int:
        p = self.parent
        while p[i] != i:
            p[i] = p[p[i]]
            i = p[i]
        return i

    def union(self, big: int, small: int) -> None:
        a, b = self.find(big), self.find(small)
        if a == b:
            return
        self.parent[b] = a
        self.garea[a] += self.garea[b]
        del self.garea[b]

    def roots(self) -> list[int]:
        return sorted({self.find(i) for i in self.parent}, key=lambda r: -self.garea[r])

    def members(self, roots) -> dict[int, list[int]]:
        out = {r: [] for r in roots}
        for i in self.parent:
            out[self.find(i)].append(i)
        return out


def _components(ink: np.ndarray, sw: float) -> Components:
    _, lab, stats, cent = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    ids = list(range(1, len(stats)))
    gap = max(4.0, sw * 2.0)
    box: dict[int, tuple[int, int, int, int]] = {}
    filled: dict[int, np.ndarray] = {}
    area: dict[int, int] = {}
    for i in ids:
        x, y, bw, bh, _ = stats[i]
        box[i] = (x, y, x + bw, y + bh)
        f = binary_fill_holes(lab[y:y + bh, x:x + bw] == i)
        filled[i] = f
        area[i] = int(f.sum())
    ids.sort(key=lambda i: -area[i])
    return Components(lab=lab, stats=stats, cent=cent, ids=ids, box=box, filled=filled,
                      area=area, gap=gap, pad=int(np.ceil(gap)) + 2)


def _nest(c: Components, protected=frozenset()) -> _Groups:
    """Absorb small parts into the object they sit inside or almost touch."""
    u = _Groups(c.ids, c.area)
    h, w = c.lab.shape
    dist_cache: dict[int, tuple[int, int, np.ndarray]] = {}

    def distance_field(i: int) -> tuple[int, int, np.ndarray]:
        if i not in dist_cache:
            x0, y0, x1, y1 = c.box[i]
            X0, Y0 = max(x0 - c.pad, 0), max(y0 - c.pad, 0)
            X1, Y1 = min(x1 + c.pad, w), min(y1 + c.pad, h)
            d = cv2.distanceTransform((c.lab[Y0:Y1, X0:X1] != i).astype(np.uint8), cv2.DIST_L2, 5)
            dist_cache[i] = (X0, Y0, d)
        return dist_cache[i]

    for si, s in enumerate(c.ids):
        if s in protected:
            continue
        sx0, sy0, sx1, sy1 = c.box[s]
        scx, scy = c.cent[s]
        pys, pxs = np.nonzero(c.lab[sy0:sy1, sx0:sx1] == s)
        sys_, sxs = pys + sy0, pxs + sx0
        for l in c.ids[:si]:
            if l in protected:
                continue
            if u.find(l) == u.find(s) or c.area[s] > PART_AREA * u.garea[u.find(l)]:
                continue
            lx0, ly0, lx1, ly1 = c.box[l]
            if sx1 + c.pad < lx0 or lx1 + c.pad < sx0 or sy1 + c.pad < ly0 or ly1 + c.pad < sy0:
                continue
            ix, iy = int(round(scx)) - lx0, int(round(scy)) - ly0
            if 0 <= iy < c.filled[l].shape[0] and 0 <= ix < c.filled[l].shape[1] and c.filled[l][iy, ix]:
                u.union(l, s)
                break
            X0, Y0, d = distance_field(l)
            ok = (sxs >= X0) & (sxs < X0 + d.shape[1]) & (sys_ >= Y0) & (sys_ < Y0 + d.shape[0])
            if ok.any() and float(d[sys_[ok] - Y0, sxs[ok] - X0].min()) <= c.gap:
                u.union(l, s)
                break
    return u


def _classes(c: Components) -> list[list[int]]:
    """Groups of repeated similar parts: four leaves, four stars, four clouds."""
    if len(c.ids) < 2:
        return []
    desc = {}
    for i in c.ids:
        _, _, bw, bh, ink = c.stats[i]
        aspect = max(bw, bh) / max(1, min(bw, bh))
        desc[i] = (float(np.log(max(1, c.area[i]))), float(np.log(aspect)),
                   float(ink) / max(1, c.area[i]))
    u = _Groups(c.ids, c.area)
    for a, b in combinations(c.ids, 2):
        if all(abs(desc[a][k] - desc[b][k]) <= SIM_TOL[k] for k in range(3)):
            u.union(a, b)
    return [sorted(m, key=lambda i: -c.area[i])
            for m in u.members(u.roots()).values() if len(m) >= 2]


def _collapsed(c: Components, classes: list[list[int]]) -> list[list[int]]:
    """Decoration folds into one object; a big part far from the subject stands on its own."""
    if not classes:
        return []
    subject = c.ids[0]
    d = cv2.distanceTransform((c.lab != subject).astype(np.uint8), cv2.DIST_L2, 5)
    out = []
    for cl in classes:
        if subject in cl:
            continue
        rel, dist = [], []
        for i in cl:
            x0, y0, x1, y1 = c.box[i]
            ys, xs = np.nonzero(c.lab[y0:y1, x0:x1] == i)
            rel.append(c.area[i] / max(1, c.area[subject]))
            dist.append(float(d[ys + y0, xs + x0].min()) / c.gap)
        if not (max(rel) > CLASS_BIG and float(np.median(dist)) > CLASS_FAR):
            out.append(cl)
    return out


def _finish(c: Components, u: _Groups, g: Graph, classes=()) -> Objects:
    h, w = c.lab.shape
    roots = u.roots()
    members = u.members(roots)

    def centroid(r):
        return np.average([c.cent[i] for i in members[r]], axis=0,
                          weights=[c.area[i] for i in members[r]])

    gc = {r: centroid(r) for r in roots}

    def absorb(dst: int, src: int) -> None:
        members[dst] += members.pop(src)
        gc[dst] = centroid(dst)
        u.union(dst, src)

    # more objects than colours: the smallest joins the nearest one, otherwise two contours
    # would share a colour and both numberings would start at 1
    while len(roots) > MAX_GROUPS:
        spread = [cl for cl in classes if len({u.find(i) for i in cl}) > 1]
        if spread:
            # repeated parts share one colour rather than splitting across several
            cl = min(spread, key=lambda m: sum(c.area[i] for i in m))
            head = u.find(cl[0])
            for i in cl:
                r = u.find(i)
                if r != head:
                    roots.remove(r)
                    absorb(head, r)
            continue
        small = roots.pop()
        near = min(roots, key=lambda r: float(np.hypot(*(gc[r] - gc[small]))))
        absorb(near, small)

    box = c.box
    top = {r: min(box[i][1] for i in members[r]) for r in roots}
    left = {r: min(box[i][0] for i in members[r]) for r in roots}
    first = min(roots, key=lambda r: top[r])
    order = [first] + sorted((r for r in roots if r != first), key=lambda r: (top[r], left[r]))
    index = {r: k for k, r in enumerate(order)}

    comp_group = np.zeros(len(c.stats), np.int16)
    for i in c.ids:
        comp_group[i] = index[u.find(i)] + 1  # 0 stays "background"
    pixel_group = comp_group[c.lab]
    count = len(order)
    masks = [pixel_group == k + 1 for k in range(count)]

    of_edge: dict[int, int] = {}
    for k, e in g.edges.items():
        p = np.clip(np.round(e.pts).astype(int), 0, [w - 1, h - 1])
        votes = np.bincount(pixel_group[p[:, 1], p[:, 0]], minlength=count + 1)
        votes[0] = 0
        of_edge[k] = int(votes.argmax()) - 1 if votes.max() else 0

    inc = g.incident()
    of_node: dict[int, int] = {}
    comp_of_node: dict[int, int] = {}
    for nid, xy in enumerate(g.nodes):
        x, y = np.clip(np.round(xy).astype(int), 0, [w - 1, h - 1])
        comp_of_node[nid] = int(c.lab[y, x])
        gr = int(pixel_group[y, x]) - 1
        if gr < 0:
            votes = np.bincount([of_edge[k] for k in inc.get(nid, [])], minlength=count)
            gr = int(votes.argmax()) if len(inc.get(nid, [])) else 0
        of_node[nid] = gr

    return Objects(count=count, colors=list(PALETTE[:count]), masks=masks, of_edge=of_edge,
                   of_node=of_node, tops=[float(top[r]) for r in order],
                   comp_of_node=comp_of_node)


def detect(ink: np.ndarray, g: Graph, sw: float) -> Objects:
    c = _components(ink, sw)
    return _finish(c, _nest(c), g)


def detect_classes(ink: np.ndarray, g: Graph, sw: float) -> Objects:
    """The subject plus its repeated decoration, each kind of decoration one object."""
    c = _components(ink, sw)
    classes = _classes(c)
    folded = _collapsed(c, classes)
    protected = {i for cl in folded for i in cl}
    u = _nest(c, protected)
    for cl in folded:
        for i in cl[1:]:
            u.union(cl[0], i)
    return _finish(c, u, g, classes)


def detect_single(ink: np.ndarray, g: Graph, sw: float) -> Objects:
    """The whole drawing is one object: one colour, one numbering."""
    c = _components(ink, sw)
    u = _Groups(c.ids, c.area)
    for i in c.ids[1:]:
        u.union(c.ids[0], i)
    return _finish(c, u, g)