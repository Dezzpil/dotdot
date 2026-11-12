"""What the drawing looks like, measured before any dots are placed.

Two stages: the mask alone tells us how many objects there are and whether one of them
dominates; the skeleton graph adds topology for free. `strategies.choose` reads these.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import cv2
import numpy as np

from . import objects
from .preprocess import Prepared
from .skeleton import Graph


@dataclass(frozen=True)
class Features:
    rel_stroke_width: float
    n_components: int
    n_roots: int  # objects after small parts joined the object they belong to
    dominance: float  # largest silhouette / all silhouettes, after nesting
    top3_share: float
    area_p50: float  # component silhouette area, share of the page
    area_p90: float
    n_solid: int
    solid_share: float
    n_classes: int  # kinds of repeated decoration
    text_rows: int
    frame_removed: bool
    cycle_rank: int = 0  # enclosed regions
    n_junctions: int = 0

    def as_json(self) -> dict:
        return asdict(self)


def from_prepared(prep: Prepared) -> Features:
    ink, sw = prep.lines_mask, prep.stroke_width
    h, w = ink.shape
    c = objects._components(ink, sw)
    u = objects._nest(c)
    areas = [u.garea[r] for r in u.roots()]
    total = sum(areas) or 1
    comp = np.array([c.area[i] for i in c.ids], float) if c.ids else np.zeros(1)
    solid_px = sum(cv2.contourArea(p.astype(np.float32)) for p in prep.solids)
    return Features(
        rel_stroke_width=round(sw / max(h, w), 5),
        n_components=len(c.ids),
        n_roots=len(areas),
        dominance=round(max(areas, default=0) / total, 4),
        top3_share=round(sum(sorted(areas, reverse=True)[:3]) / total, 4),
        area_p50=round(float(np.percentile(comp, 50)) / (h * w), 6),
        area_p90=round(float(np.percentile(comp, 90)) / (h * w), 6),
        n_solid=len(prep.solids),
        solid_share=round(solid_px / max(1, int(prep.ink.sum())), 4),
        n_classes=len(objects._classes(c)),
        text_rows=prep.report.text_rows,
        frame_removed=prep.report.frame_removed,
    )


def with_graph(f: Features, g: Graph) -> Features:
    parent = list(range(len(g.nodes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for e in g.edges.values():
        a, b = find(e.u), find(e.v)
        if a != b:
            parent[b] = a
    comps = len({find(i) for i in range(len(g.nodes))})
    deg = g.degree()
    return Features(**{**f.as_json(),
                       "cycle_rank": len(g.edges) - len(g.nodes) + comps,
                       "n_junctions": sum(1 for d in deg.values() if d >= 3)})