"""End-to-end: image bytes -> connect-the-dots PDF."""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass

import cairo
import numpy as np

from .dots import assign_texts, build_plan
from .labels import place_labels
from .metrics import evaluate
from .preprocess import prepare
from .render import Layout, render_pdf, render_png
from .skeleton import build_graph, merge_degree2, prune_spurs
from .strokes import Stroke, chain_edges, order_strokes, outline_edge_ids

# level -> (contour tolerance pt, max dots, font pt, dot radius pt, min dot distance pt,
#           max segment pt, strokes shorter than this (pt) are printed as lines)
LEVELS = {
    "kid": (5.0, 50, 11.0, 2.6, 14.0, 90.0, 130.0),
    "school": (2.0, 150, 8.0, 2.0, 8.0, 45.0, 60.0),
    "adult": (1.0, 320, 6.5, 1.6, 5.5, 28.0, 30.0),
}
# math examples are wider than numbers: level -> (dot cap factor, spacing factor)
MATH_ROOM = {"kid": (1.0, 1.0), "school": (0.65, 1.15), "adult": (0.55, 1.25)}


def _close_almost_loops(strokes: list[Stroke], gap: float) -> list[Stroke]:
    out = []
    for s in strokes:
        if not s.closed and s.length > gap * 4 and np.hypot(*(s.pts[0] - s.pts[-1])) < gap:
            s = Stroke(np.vstack([s.pts, s.pts[:1]]), True, s.edge_ids)
        out.append(s)
    return out


@dataclass
class Options:
    mode: str = "all"  # all | outline
    numbering: str = "jumps"  # jumps | series
    level: str = "school"  # kid | school | adult
    labels: str = "numbers"  # numbers | math
    lang: str = "ru"  # ru | en
    seed: int = 1
    debug: bool = False  # adds layout quality metrics to stats

    def validate(self) -> "Options":
        assert self.mode in ("all", "outline")
        assert self.numbering in ("jumps", "series")
        assert self.level in LEVELS
        assert self.labels in ("numbers", "math")
        assert self.lang in ("ru", "en")
        return self


@dataclass
class Result:
    pdf: bytes
    preview_puzzle: bytes
    preview_answer: bytes
    stats: dict


def generate(data: bytes, opts: Options) -> Result:
    t0 = time.perf_counter()
    opts.validate()
    eps0, cap, font_size, dot_r, dmin, maxseg, detail = LEVELS[opts.level]
    if opts.labels == "math":
        # wider labels need more room: fewer dots and a larger minimum distance
        k_cap, k_space = MATH_ROOM[opts.level]
        cap = int(cap * k_cap)
        dmin *= k_space
    prep = prepare(data)
    sw = prep.stroke_width
    g = build_graph(prep.ink)
    merge_degree2(g)
    prune_spurs(g, max_len=sw * 1.6 + 4)
    merge_degree2(g)

    h, w = prep.ink.shape
    L = Layout(w, h)
    px = 1.0 / L.s  # image px per page pt
    all_ids = list(g.edges)
    if opts.mode == "outline":
        dot_ids = outline_edge_ids(g, prep.ink, sw)
        line_ids = [k for k in all_ids if k not in set(dot_ids)]
    else:
        dot_ids, line_ids = all_ids, []
    look = max(6.0, sw * 2.0)
    bridge = dmin * px * 1.1
    # small details become plain printed lines; re-chain after each pass because removing
    # a branch turns its junction into a pass-through and lets neighbouring strokes merge
    for _ in range(4):
        dotted = chain_edges(g, dot_ids, look, bridge)
        small = [s for s in dotted if s.length / px < detail and len(dotted) > 1]
        if not small:
            break
        drop = {k for s in small for k in s.edge_ids}
        dot_ids = [k for k in dot_ids if k not in drop]
        line_ids += sorted(drop)
    dotted = order_strokes(_close_almost_loops(dotted, dmin * px * 2.5))
    lines = chain_edges(g, line_ids, look)

    to_page = lambda s: Stroke(L.to_page(s.pts), s.closed)  # noqa: E731
    plan = build_plan([to_page(s) for s in dotted], [to_page(s) for s in lines], eps0, cap, dmin, maxseg)
    assign_texts(plan, opts.numbering, opts.labels, opts.level, opts.seed)

    scratch = cairo.Context(cairo.ImageSurface(cairo.FORMAT_A8, 4, 4))
    scratch.select_font_face("DejaVu Sans")
    placed = place_labels(plan, scratch, font_size, dot_r, L.bounds, L.w, L.h,
                          combine=opts.labels == "numbers")

    pdf = render_pdf(L, plan, placed, opts, font_size, dot_r)
    prev_p = render_png(L, plan, placed, opts, font_size, dot_r, "puzzle")
    prev_a = render_png(L, plan, placed, opts, font_size, dot_r, "answer")
    stats = {
        "dots": len(plan.dots),
        "numbers": len(plan.seq),
        "strokes": len(plan.paths),
        "plain_lines": len(plan.lines),
        "stroke_width_px": round(sw, 1),
        "graph_edges": len(g.edges),
        "ms": round((time.perf_counter() - t0) * 1000),
        "options": asdict(opts),
    }
    if opts.debug:
        stats["quality"] = evaluate(plan, placed, dot_r)
    return Result(pdf, prev_p, prev_a, stats)
