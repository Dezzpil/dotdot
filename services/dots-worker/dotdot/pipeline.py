"""End-to-end: image bytes -> connect-the-dots PDF."""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass

import cairo

from .dots import assign_texts, build_plan
from .labels import place_labels
from .preprocess import prepare
from .render import Layout, render_pdf, render_png
from .skeleton import build_graph, merge_degree2, prune_spurs
from .strokes import Stroke, chain_edges, order_strokes, outline_edge_ids

# level -> (contour tolerance pt, max dots, font pt, dot radius pt, min dot distance pt, max segment pt)
LEVELS = {
    "kid": (5.0, 50, 11.0, 2.6, 14.0, 90.0),
    "school": (2.0, 150, 8.0, 2.0, 8.0, 45.0),
    "adult": (1.0, 320, 6.5, 1.6, 5.5, 28.0),
}


@dataclass
class Options:
    mode: str = "all"  # all | outline
    numbering: str = "jumps"  # jumps | series
    level: str = "school"  # kid | school | adult
    labels: str = "numbers"  # numbers | math
    lang: str = "ru"  # ru | en
    seed: int = 1

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
    eps0, target, font_size, dot_r, dmin, maxseg = LEVELS[opts.level]
    prep = prepare(data)
    sw = prep.stroke_width
    g = build_graph(prep.ink)
    merge_degree2(g)
    prune_spurs(g, max_len=sw * 1.6 + 4)
    merge_degree2(g)

    all_ids = list(g.edges)
    if opts.mode == "outline":
        dot_ids = outline_edge_ids(g, prep.ink, sw)
        line_ids = [k for k in all_ids if k not in set(dot_ids)]
    else:
        dot_ids, line_ids = all_ids, []
    look = max(6.0, sw * 2.0)
    dotted = order_strokes(chain_edges(g, dot_ids, look))
    lines = chain_edges(g, line_ids, look)

    h, w = prep.ink.shape
    L = Layout(w, h)
    to_page = lambda s: Stroke(L.to_page(s.pts), s.closed)  # noqa: E731
    plan = build_plan([to_page(s) for s in dotted], [to_page(s) for s in lines], eps0, target, dmin, maxseg)
    assign_texts(plan, opts.numbering, opts.labels, opts.level, opts.seed)

    scratch = cairo.Context(cairo.ImageSurface(cairo.FORMAT_A8, 4, 4))
    scratch.select_font_face("DejaVu Sans")
    placed = place_labels(plan, scratch, font_size, dot_r, L.bounds, L.w, L.h)

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
    return Result(pdf, prev_p, prev_a, stats)
