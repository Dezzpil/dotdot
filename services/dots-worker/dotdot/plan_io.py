"""Plan <-> JSON: what the web editor reads and sends back.

plan.json (all coordinates in PDF points, origin top-left of the page):
    {
      "v": 2,
      "page":  {"w": 595.28, "h": 841.89},
      "image": {"w": 1000, "h": 760, "s": 0.52, "ox": 34.0, "oy": 120.0},  # uploaded file: page = px * s + (ox, oy)
      "dotR": 2.0,
      "dots":  [[x, y], ...],
      "paths": [[0, 1, 2, 0], [3, 4], ...],   # drawing order, dot indices; a closed line repeats its first dot
      "groups": [0, 0, 1],                    # object per line, index into colors
      "colors": ["#1f5fbf", "#d9480f"],       # one colour per object
      "lines": [[[x, y], ...], ...],          # details printed as plain lines (not editable)
      "solids": [[[x, y], ...], ...]          # filled areas (pupils), closed polygons; optional
    }

v1 (no groups/colors) is still accepted: every line becomes its own object, all black.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field

import numpy as np

from .dots import Dot, Plan, number_paths, rdp_indices
from .objects import INK_HEX

VERSION = 2
ACCEPTED = (1, VERSION)
MAX_DOTS = 1500
MAX_PATHS = 500
MAX_NUMBERS = 3000
MAX_LINE_POINTS = 60000
MAX_SOLIDS = 64
MAX_SOLID_POINTS = 20000
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class BadPlanError(ValueError):
    pass


@dataclass
class PlanDoc:
    page_w: float
    page_h: float
    image: dict
    dots: list[list[float]]
    paths: list[list[int]]
    lines: list[list[list[float]]]
    dot_r: float
    groups: list[int]
    colors: list[str]
    solids: list[list[list[float]]] = field(default_factory=list)


def plan_to_json(plan: Plan, page_w: float, page_h: float, image: dict, dot_r: float,
                 simplify_lines: bool = True) -> bytes:
    lines = []
    for ln in plan.lines:
        pts = np.asarray(ln, float)
        if simplify_lines and len(pts) > 2:
            pts = pts[rdp_indices(pts, 0.25)]  # 0.25 pt is invisible on paper, keeps the file small
        lines.append([[round(float(x), 1), round(float(y), 1)] for x, y in pts])
    doc = {
        "v": VERSION,
        "page": {"w": round(page_w, 2), "h": round(page_h, 2)},
        "image": {k: (round(v, 6) if isinstance(v, float) else v) for k, v in image.items()},
        "dotR": dot_r,
        "dots": [[round(float(d.xy[0]), 2), round(float(d.xy[1]), 2)] for d in plan.dots],
        "paths": [[plan.seq[q].dot for q in path] for path in plan.paths],
        "groups": plan.groups,
        "colors": plan.colors,
        "lines": lines,
    }
    if plan.solids:
        doc["solids"] = [[[round(float(x), 1), round(float(y), 1)] for x, y in poly]
                         for poly in plan.solids]
    return json.dumps(doc, separators=(",", ":")).encode()


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_plan(raw: bytes | str | dict) -> PlanDoc:
    """Validate a plan (possibly edited by a user) and normalise it.

    Drops repeated neighbours, lines that became too short and dots no line uses;
    renumbers dots so indices stay dense.
    """
    try:
        d = raw if isinstance(raw, dict) else json.loads(raw)
    except (ValueError, TypeError) as e:
        raise BadPlanError(f"not JSON: {e}")
    v = d.get("v") if isinstance(d, dict) else None
    if isinstance(v, bool) or v not in ACCEPTED:
        raise BadPlanError("unsupported plan version")
    page = d.get("page") or {}
    w, h = page.get("w"), page.get("h")
    if not (_num(w) and _num(h) and 100 <= w <= 2000 and 100 <= h <= 2000):
        raise BadPlanError("bad page size")
    dots, paths, lines = d.get("dots"), d.get("paths"), d.get("lines", [])
    if not isinstance(dots, list) or not isinstance(paths, list) or not isinstance(lines, list):
        raise BadPlanError("dots, paths and lines must be lists")
    if len(dots) > MAX_DOTS:
        raise BadPlanError(f"too many dots (max {MAX_DOTS})")
    if len(paths) > MAX_PATHS:
        raise BadPlanError(f"too many lines (max {MAX_PATHS})")
    if v == 1:
        # a sheet made before objects existed: one object per line keeps its old numbering
        colors, groups = [INK_HEX] * len(paths), list(range(len(paths)))
    else:
        colors, groups = d.get("colors"), d.get("groups")
        # a legacy plan may carry one black colour per line, so the bound is lines, not the palette
        if not isinstance(colors, list) or not 1 <= len(colors) <= MAX_PATHS or not all(
                isinstance(c, str) and _HEX.match(c) for c in colors):
            raise BadPlanError("colors must be a non-empty list of #rrggbb")
        if not isinstance(groups, list) or len(groups) != len(paths) or not all(
                isinstance(gi, int) and not isinstance(gi, bool) and 0 <= gi < len(colors) for gi in groups):
            raise BadPlanError("groups must name a colour for every line")
    for p in dots:
        if not (isinstance(p, list) and len(p) == 2 and _num(p[0]) and _num(p[1])):
            raise BadPlanError("a dot must be [x, y]")
        if not (-5 <= p[0] <= w + 5 and -5 <= p[1] <= h + 5):
            raise BadPlanError("a dot is outside the page")
    clean: list[list[int]] = []
    clean_groups: list[int] = []
    for pi, path in enumerate(paths):
        if not isinstance(path, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in path):
            raise BadPlanError("a line must be a list of dot indices")
        if any(i < 0 or i >= len(dots) for i in path):
            raise BadPlanError("a line refers to a missing dot")
        out: list[int] = []
        for i in path:
            if not out or out[-1] != i:
                out.append(i)
        if len(out) >= 3 and out[0] == out[-1] and len(set(out)) < 3:
            out = out[:-1]  # a "loop" of two dots is just a segment
        if len(out) >= 2:
            clean.append(out)
            clean_groups.append(groups[pi])
    if not clean:
        raise BadPlanError("no dots left to connect")
    if sum(len(p) for p in clean) > MAX_NUMBERS:
        raise BadPlanError(f"too many numbers (max {MAX_NUMBERS})")
    used = sorted({i for p in clean for i in p})
    remap = {old: new for new, old in enumerate(used)}
    n_pts = 0
    plain = []
    for ln in lines:
        if not isinstance(ln, list) or not all(isinstance(p, list) and len(p) == 2 and _num(p[0]) and _num(p[1]) for p in ln):
            raise BadPlanError("a plain line must be a list of [x, y]")
        n_pts += len(ln)
        if len(ln) >= 2:
            plain.append(ln)
    if n_pts > MAX_LINE_POINTS:
        raise BadPlanError("plain lines are too detailed")
    solids = d.get("solids", [])
    if not isinstance(solids, list) or len(solids) > MAX_SOLIDS:
        raise BadPlanError(f"solids must be a list of at most {MAX_SOLIDS} polygons")
    n_solid = 0
    for poly in solids:
        if not isinstance(poly, list) or len(poly) < 3:
            raise BadPlanError("a solid must be a polygon of at least 3 points")
        n_solid += len(poly)
        for p in poly:
            if not (isinstance(p, list) and len(p) == 2 and _num(p[0]) and _num(p[1])):
                raise BadPlanError("a solid point must be [x, y]")
            if not (-5 <= p[0] <= w + 5 and -5 <= p[1] <= h + 5):
                raise BadPlanError("a solid point is outside the page")
    if n_solid > MAX_SOLID_POINTS:
        raise BadPlanError("solids are too detailed")
    image = d.get("image") if isinstance(d.get("image"), dict) else {}
    dot_r = d.get("dotR") if _num(d.get("dotR")) else 2.0
    return PlanDoc(float(w), float(h), image, [[float(dots[i][0]), float(dots[i][1])] for i in used],
                   [[remap[i] for i in p] for p in clean], plain, float(dot_r), clean_groups, list(colors),
                   [[[float(x), float(y)] for x, y in poly] for poly in solids])


def plan_from_doc(doc: PlanDoc) -> Plan:
    """Rebuild the numbering sequence exactly like build_plan does."""
    dots = [Dot(np.array(p, float)) for p in doc.dots]
    seq, paths = number_paths(dots, doc.paths, doc.groups)
    return Plan(dots, seq, paths, [np.array(ln, float) for ln in doc.lines], doc.groups, doc.colors,
                [np.array(poly, float) for poly in doc.solids])
