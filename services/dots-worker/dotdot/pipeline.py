"""End-to-end: image bytes -> connect-the-dots PDF."""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass, replace

import cairo
import numpy as np

from . import features, strategies
from .dots import assign_texts, build_plan, simplify
from .labels import place_labels
from .metrics import evaluate
from .plan_io import parse_plan, plan_from_doc, plan_to_json
from .preprocess import prepare
from .render import Layout, render_pdf, render_png
from .scene import Scene
from .skeleton import build_graph, merge_degree2, prune_spurs
from .strokes import Stroke, chain_edges, order_groups, outline_edge_ids

# level -> (contour tolerance pt, max dots, font pt, dot radius pt, min dot distance pt,
#           max segment pt, strokes shorter than this (pt) are printed as lines)
LEVELS = {
    "kid": (5.0, 50, 11.0, 2.6, 14.0, 90.0, 130.0),
    "school": (2.0, 300, 8.0, 2.0, 8.0, 45.0, 60.0),
    "adult": (1.0, 300, 6.5, 1.6, 5.5, 28.0, 30.0),
}
# kids get a single closed silhouette by default: no pen lifts, details are pre-printed
DEFAULT_MODE = {"kid": "outline", "school": "all", "adult": "all"}
# dots a level aims at; the ceiling above only clips drawings that could hold more
DOT_TARGET = {"kid": 20, "school": 60, "adult": 130}
# the ladder of dot-count variants stays inside the level's range; the top is the page's
# label capacity (~300 readable numbers on A4), not the level's ambition
LEVEL_RANGE = {"kid": (20, 60), "school": (60, 300), "adult": (150, 300)}
LADDER_STEP = 1.35  # the smallest step between variants: closer sheets look the same
LADDER_COUNT = 5
# math examples are wider than numbers: level -> (dot cap factor, spacing factor)
MATH_ROOM = {"kid": (1.0, 1.0), "school": (0.65, 1.15), "adult": (0.55, 1.25)}


def _close_almost_loops(strokes: list[Stroke], gap: float) -> list[Stroke]:
    out = []
    for s in strokes:
        if not s.closed and s.length > gap * 4 and np.hypot(*(s.pts[0] - s.pts[-1])) < gap:
            s = replace(s, pts=np.vstack([s.pts, s.pts[:1]]), closed=True)
        out.append(s)
    return out


class BadOptionsError(ValueError):
    pass


@dataclass
class Options:
    mode: str = "auto"  # auto | all | outline; auto = outline for kids, all otherwise
    strategy: str = "auto"  # auto | components | classes | subject; how objects are found
    numbering: str = "color"  # jumps | color | series
    level: str = "school"  # kid | school | adult
    labels: str = "numbers"  # numbers | math
    math_max: int = 100  # biggest answer in math mode; a larger contour is simplified
    target: int | None = None  # the user's own dot count: three variants around it
    lang: str = "ru"  # ru | en
    seed: int = 1
    debug: bool = False  # adds layout quality metrics to stats

    def validate(self) -> "Options":
        allowed = {
            "mode": ("auto", "all", "outline"),
            "strategy": ("auto",) + strategies.NAMES,
            "numbering": ("jumps", "color", "series"),
            "level": tuple(LEVELS),
            "labels": ("numbers", "math"),
            "lang": ("ru", "en"),
        }
        for k, vals in allowed.items():
            if getattr(self, k) not in vals:
                raise BadOptionsError(f"{k} must be one of {vals}")
        if not isinstance(self.seed, int):
            raise BadOptionsError("seed must be int")
        if not isinstance(self.math_max, int) or isinstance(self.math_max, bool) or not 10 <= self.math_max <= 999:
            raise BadOptionsError("math_max must be an int in 10..999")
        if self.target is not None and (
                not isinstance(self.target, int) or isinstance(self.target, bool) or not 10 <= self.target <= 1000):
            raise BadOptionsError("target must be an int in 10..1000")
        if self.mode == "auto":
            self.mode = DEFAULT_MODE[self.level]
        return self

    @classmethod
    def from_dict(cls, d: dict) -> "Options":
        known = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in (d or {}).items() if k in known and v is not None})


@dataclass
class Result:
    pdf: bytes
    preview_puzzle: bytes
    preview_answer: bytes
    stats: dict
    plan: bytes = b""  # plan.json for the web editor


def analyze(data: bytes, opts: Options) -> Scene:
    """Everything that needs the image: objects, strokes, plain lines, achievable dot range."""
    opts.validate()
    eps0, cap, _, _, dmin, maxseg, detail = LEVELS[opts.level]
    if opts.labels == "math":
        # wider labels need more room: fewer dots and a larger minimum distance
        k_cap, k_space = MATH_ROOM[opts.level]
        cap = int(cap * k_cap)
        dmin *= k_space
    prep = prepare(data)
    sw = prep.stroke_width
    mask = prep.lines_mask
    g = build_graph(mask)
    merge_degree2(g)
    prune_spurs(g, max_len=sw * 1.6 + 4)
    merge_degree2(g)

    h, w = mask.shape
    L = Layout(w, h)
    px = 1.0 / L.s  # image px per page pt
    feat = features.with_graph(features.from_prepared(prep), g)
    strat, strat_scores = strategies.resolve(opts.strategy, feat)
    obj = strat.group(mask, g, sw)
    all_ids = list(g.edges)
    if opts.mode == "outline":
        dot_ids = outline_edge_ids(g, obj.masks, obj.of_edge, sw)
        line_ids = [k for k in all_ids if k not in set(dot_ids)]
    else:
        dot_ids, line_ids = all_ids, []
    look = max(6.0, sw * 2.0)
    bridge = dmin * px * 1.1
    # small details become plain printed lines; re-chain after each pass because removing
    # a branch turns its junction into a pass-through and lets neighbouring strokes merge
    for _ in range(4):
        dotted = chain_edges(g, dot_ids, look, bridge, of_edge=obj.of_edge, of_node=obj.of_node,
                             comp_of_node=obj.comp_of_node)
        small = [s for s in dotted if s.length / px < detail and len(dotted) > 1]
        if not small:
            break
        drop = {k for s in small for k in s.edge_ids}
        dot_ids = [k for k in dot_ids if k not in drop]
        line_ids += sorted(drop)
    dotted = _close_almost_loops(dotted, dmin * px * 2.5)
    dotted = order_groups(dotted, min_tail=dmin * px * 3)
    lines = chain_edges(g, line_ids, look)

    to_page = lambda s: replace(s, pts=L.to_page(s.pts))  # noqa: E731
    strokes = [to_page(s) for s in dotted]
    plain = [to_page(s) for s in lines]
    # the finest and the coarsest sheet this drawing can hold at this level
    hi = min(sum(len(simplify(s, eps0, dmin, maxseg)) for s in strokes), cap)
    lo = min(sum(len(simplify(s, 400.0, dmin, maxseg * 64)) for s in strokes), hi)
    if opts.labels == "math":
        hi = min(hi, opts.math_max * max(1, len({s.group for s in strokes})))
        lo = min(lo, hi)
    # where the uploaded file sits on the page (the editor shows it under the dots)
    image = {"w": prep.orig_w, "h": prep.orig_h, "s": prep.scale * L.s,
             "ox": L.ox - prep.x0 * L.s, "oy": L.oy - prep.y0 * L.s}
    extra = {"stroke_width_px": round(sw, 1), "graph_edges": len(g.edges),
             "strategy": strat.name, "strategy_scores": strat_scores, "features": feat.as_json(),
             "solids": [[[round(float(x), 2), round(float(y), 2)] for x, y in L.to_page(p)]
                        for p in prep.solids]}
    return Scene(L.w, L.h, image, strokes, plain, obj.colors, lo, hi, extra)


def default_target(opts: Options) -> int:
    target = DOT_TARGET[opts.level]
    if opts.labels == "math":
        target = int(target * MATH_ROOM[opts.level][0])
    return target


def ladder_targets(scene: Scene, opts: Options) -> list[int]:
    """Five dot counts from the level's target up to the whole drawing, or three around the user's number.

    The step stretches with what the drawing can hold, so the top variant dots as much of it
    as the level allows. Clamped to the scene, duplicates dropped: a simple sheet gets fewer variants.
    """
    if opts.target:
        bases = [opts.target * k for k in (0.8, 1.0, 1.25)]
    else:
        lo, hi = LEVEL_RANGE[opts.level]
        top = min(scene.dots_max, hi)
        start = min(max(default_target(opts), lo), top)
        step = max(LADDER_STEP, (top / start) ** (1 / (LADDER_COUNT - 1)))
        bases = [start * step ** i for i in range(LADDER_COUNT)]
    out: list[int] = []
    for b in bases:
        t = int(round(min(max(b, scene.dots_min), scene.dots_max)))
        # the top of the ladder piles up against the drawing's limit: 148 and 150 give the same sheet
        if not out or t >= out[-1] * 1.05:
            out.append(t)
    return out


def render_scene(scene: Scene, opts: Options, target: int, t0: float | None = None) -> Result:
    """Dots, labels and sheets for one dot-count target: no image analysis at all."""
    t0 = time.perf_counter() if t0 is None else t0
    opts.validate()
    eps0, cap, font_size, dot_r, dmin, maxseg, _ = LEVELS[opts.level]
    if opts.labels == "math":
        k_cap, k_space = MATH_ROOM[opts.level]
        cap = int(cap * k_cap)
        dmin *= k_space
    plan = build_plan(list(scene.strokes), list(scene.lines), eps0, min(target, cap), dmin, maxseg,
                      group_cap=opts.math_max if opts.labels == "math" else None, colors=scene.colors,
                      solids=[np.asarray(p, float) for p in scene.extra.get("solids", [])],
                      quota=opts.mode != "outline")
    L = Layout.for_page(scene.page_w, scene.page_h)
    plan_json = plan_to_json(plan, L.w, L.h, scene.image, dot_r)
    return _finish(L, plan, opts, font_size, dot_r, plan_json, {**scene.extra, "target": target}, t0)


def generate(data: bytes, opts: Options) -> Result:
    t0 = time.perf_counter()
    scene = analyze(data, opts)
    return render_scene(scene, opts, default_target(opts), t0)


def render_edited(plan_raw: bytes | str | dict, opts: Options) -> Result:
    """Lay out labels and render a plan the user has edited: no image analysis at all."""
    t0 = time.perf_counter()
    opts.validate()
    _, _, font_size, dot_r, _, _, _ = LEVELS[opts.level]
    doc = parse_plan(plan_raw)
    plan = plan_from_doc(doc)
    L = Layout.for_page(doc.page_w, doc.page_h)
    plan_json = plan_to_json(plan, doc.page_w, doc.page_h, doc.image, dot_r, simplify_lines=False)
    return _finish(L, plan, opts, font_size, dot_r, plan_json, {"edited": True}, t0)


def _finish(L: Layout, plan, opts: Options, font_size: float, dot_r: float, plan_json: bytes,
            extra: dict, t0: float) -> Result:
    assign_texts(plan, opts.numbering, opts.labels, opts.level, opts.seed)

    scratch = cairo.Context(cairo.ImageSurface(cairo.FORMAT_A8, 4, 4))
    scratch.select_font_face("DejaVu Sans")
    placed = place_labels(plan, scratch, font_size, dot_r, L.bounds, L.w, L.h,
                          combine=opts.labels == "numbers" and opts.numbering != "color")

    pdf = render_pdf(L, plan, placed, opts, font_size, dot_r)
    prev_p = render_png(L, plan, placed, opts, font_size, dot_r, "puzzle")
    prev_a = render_png(L, plan, placed, opts, font_size, dot_r, "answer")
    stats = {
        "dots": len(plan.dots),
        "numbers": len(plan.seq),
        "strokes": len(plan.paths),
        "contours": len(set(plan.groups)),
        "plain_lines": len(plan.lines),
        **extra,
        "ms": round((time.perf_counter() - t0) * 1000),
        "options": asdict(opts),
    }
    if opts.debug:
        stats["quality"] = evaluate(plan, placed, dot_r)
    return Result(pdf, prev_p, prev_a, stats, plan_json)
