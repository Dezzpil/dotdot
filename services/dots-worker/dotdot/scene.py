"""Scene: the analysed drawing, shared by every dot-count variant of one upload.

Written once by the analyze job, read by the variant jobs: no image analysis per variant.
All coordinates are PDF points, like plan.json.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

import numpy as np

from .strokes import Stroke

VERSION = 1


class BadSceneError(ValueError):
    pass


@dataclass
class Scene:
    page_w: float
    page_h: float
    image: dict
    strokes: list[Stroke]  # dot candidates, page coords, drawing order
    lines: list[Stroke]  # details printed as plain lines
    colors: list[str]  # one colour per object
    dots_min: int  # achievable dot counts for this level/mode/labels
    dots_max: int
    extra: dict = field(default_factory=dict)


def _strokes_json(strokes: list[Stroke]) -> list[dict]:
    return [{"pts": [[round(float(x), 2), round(float(y), 2)] for x, y in s.pts],
             "closed": bool(s.closed), "group": int(s.group)} for s in strokes]


def scene_to_json(scene: Scene) -> bytes:
    doc = {
        "v": VERSION,
        "page": {"w": round(scene.page_w, 2), "h": round(scene.page_h, 2)},
        "image": scene.image,
        "strokes": _strokes_json(scene.strokes),
        "lines": _strokes_json(scene.lines),
        "colors": scene.colors,
        "dotsMin": scene.dots_min,
        "dotsMax": scene.dots_max,
        "extra": scene.extra,
    }
    return json.dumps(doc, separators=(",", ":")).encode()


def _strokes(raw) -> list[Stroke]:
    if not isinstance(raw, list):
        raise BadSceneError("strokes and lines must be lists")
    out = []
    for s in raw:
        pts = np.asarray(s.get("pts"), float)
        if pts.ndim != 2 or pts.shape[1] != 2 or len(pts) < 2:
            raise BadSceneError("a stroke must be a polyline of [x, y]")
        out.append(Stroke(pts, bool(s.get("closed")), group=int(s.get("group", 0))))
    return out


def scene_from_json(raw: bytes | str | dict) -> Scene:
    try:
        d = raw if isinstance(raw, dict) else json.loads(raw)
    except (ValueError, TypeError) as e:
        raise BadSceneError(f"not JSON: {e}")
    if not isinstance(d, dict) or d.get("v") != VERSION:
        raise BadSceneError("unsupported scene version")
    page = d.get("page") or {}
    strokes, lines = _strokes(d.get("strokes")), _strokes(d.get("lines"))
    if not strokes:
        raise BadSceneError("scene has no strokes")
    colors = d.get("colors")
    if not isinstance(colors, list) or not colors:
        raise BadSceneError("scene has no colors")
    lo, hi = d.get("dotsMin"), d.get("dotsMax")
    if not all(isinstance(v, int) and not isinstance(v, bool) and 0 < v for v in (lo, hi)) or lo > hi:
        raise BadSceneError("bad dot range")
    return Scene(float(page["w"]), float(page["h"]), d.get("image") or {}, strokes, lines,
                 list(colors), lo, hi, d.get("extra") or {})