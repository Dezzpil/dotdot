"""Offline quality comparison: answer sheets, a contact sheet and objective metrics.

    python -m tools.compare --images /imgs --out /tmp/dotdot-compare

Judged by the ANSWER sheet (dots connected), not by the dot sheet: it shows whether the
dot set reproduces the drawing. Never imported by the worker; not copied into the image.
"""
from __future__ import annotations

import argparse
import io
import json
import pathlib
import time

import cairo
import cv2
import numpy as np

from dotdot.metrics import ink_coverage
from dotdot.pipeline import Options, analyze, default_target, render_scene
from dotdot.plan_io import parse_plan, plan_from_doc
from dotdot.preprocess import prepare

SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
CELL_W = 380
CAPTION_H = 58
GUTTER = 168
PAD = 12
FONT = "DejaVu Sans"


def _surface(png: bytes) -> cairo.ImageSurface:
    return cairo.ImageSurface.create_from_png(io.BytesIO(png))


def _thumb_png(data: bytes) -> bytes:
    """Any input image as PNG, so Cairo can load it."""
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("cannot re-encode source image")
    return buf.tobytes()


def _text(ctx, s, x, y, size=11.0, bold=False, rgb=(0.13, 0.13, 0.16)):
    ctx.select_font_face(FONT, cairo.FONT_SLANT_NORMAL,
                         cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
    ctx.set_font_size(size)
    ctx.set_source_rgb(*rgb)
    ctx.move_to(x, y)
    ctx.show_text(s)


def _cell(ctx, surf, x, y, w, h):
    """Fit a surface into a box, centred, on white."""
    ctx.set_source_rgb(1, 1, 1)
    ctx.rectangle(x, y, w, h)
    ctx.fill()
    if surf is None:
        return
    k = min(w / surf.get_width(), h / surf.get_height())
    dw, dh = surf.get_width() * k, surf.get_height() * k
    ctx.save()
    ctx.translate(x + (w - dw) / 2, y + (h - dh) / 2)
    ctx.scale(k, k)
    ctx.set_source_surface(surf, 0, 0)
    ctx.paint()
    ctx.restore()
    ctx.set_source_rgb(0.85, 0.85, 0.88)
    ctx.set_line_width(1)
    ctx.rectangle(x + 0.5, y + 0.5, w - 1, h - 1)
    ctx.stroke()


def _caption(ctx, lines, x, y):
    for i, (s, bold, rgb) in enumerate(lines):
        _text(ctx, s, x, y + 14 + i * 14, 10.5, bold, rgb)


def _contact(rows, columns, out: pathlib.Path, ratio: float):
    cell_h = int(CELL_W * ratio)
    row_h = cell_h + CAPTION_H + PAD
    head_h = 34
    w = GUTTER + len(columns) * (CELL_W + PAD) + PAD
    h = head_h + len(rows) * row_h + PAD
    surf = cairo.ImageSurface(cairo.FORMAT_RGB24, w, h)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(0.97, 0.97, 0.98)
    ctx.paint()
    for j, col in enumerate(columns):
        _text(ctx, col, GUTTER + j * (CELL_W + PAD) + 4, 22, 13, True)
    for i, row in enumerate(rows):
        y = head_h + i * row_h
        _text(ctx, row["name"][:22], PAD, y + 18, 12, True)
        f = row.get("features") or {}
        if f:
            _text(ctx, f"sw {f.get('rel_stroke_width', 0):.2%}", PAD, y + 36, 10)
            _text(ctx, f"roots {f.get('n_roots', '?')} · comp {f.get('n_components', '?')}", PAD, y + 50, 10)
            _text(ctx, f"dom {f.get('dominance', 0):.2f}", PAD, y + 64, 10)
            _text(ctx, f"classes {f.get('n_classes', '?')} · solid {f.get('n_solid', '?')}", PAD, y + 78, 10)
            _text(ctx, f"cycles {f.get('cycle_rank', '?')}", PAD, y + 92, 10)
        for j, col in enumerate(row["cells"]):
            x = GUTTER + j * (CELL_W + PAD)
            _cell(ctx, col.get("surf"), x, y, CELL_W, cell_h)
            _caption(ctx, col["caption"], x + 2, y + cell_h + 2)
    surf.write_to_png(str(out))


def _run(data: bytes, opts: Options, target: int | None) -> dict:
    prep = prepare(data)
    scene = analyze(data, opts)
    t = target or default_target(opts)
    res = render_scene(scene, opts, t)
    # page pt -> crop px, inverted from scene.image (page = crop * L.s + L.o)
    ls = scene.image["s"] / prep.scale
    off = np.array([scene.image["ox"] + prep.x0 * ls, scene.image["oy"] + prep.y0 * ls])
    cov = ink_coverage(plan_from_doc(parse_plan(res.plan)), prep.ink, prep.stroke_width,
                       lambda p: (np.asarray(p, float) - off) / ls)
    closed = sum(1 for s in scene.strokes if s.closed)
    return {
        "answer": res.preview_answer, "puzzle": res.preview_puzzle,
        "objects": len(scene.colors), "strokes": len(scene.strokes), "closed": closed,
        "closed_share": round(closed / max(1, len(scene.strokes)), 3),
        "plain_lines": len(scene.lines), "lifts": res.stats["strokes"],
        "dots": res.stats["dots"], "target": t,
        "dots_min": scene.dots_min, "dots_max": scene.dots_max,
        "features": scene.extra.get("features", {}),
        "strategy": scene.extra.get("strategy", "components"),
        "quality": res.stats.get("quality", {}), "ms": res.stats["ms"], **cov,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--out", default="/tmp/dotdot-compare")
    ap.add_argument("--level", default="school")
    ap.add_argument("--mode", default="all")
    ap.add_argument("--strategies", default="auto,components,classes,subject")
    ap.add_argument("--target", type=int, default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--puzzle", action="store_true", help="also write the dot sheet")
    a = ap.parse_args()

    names = [s.strip() for s in a.strategies.split(",") if s.strip()]
    files = sorted(p for p in pathlib.Path(a.images).iterdir() if p.suffix.lower() in SUFFIXES)
    if a.limit:
        files = files[:a.limit]
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    rows, report = [], []
    for f in files:
        data = f.read_bytes()
        d = out / f.stem
        d.mkdir(parents=True, exist_ok=True)
        (d / "source.png").write_bytes(_thumb_png(data))
        row = {"name": f.stem[:8], "cells": [{"surf": _surface(_thumb_png(data)),
                                             "caption": [("исходник", True, (0.13, 0.13, 0.16))]}]}
        rec = {"image": f.name, "variants": {}}
        for name in names:
            opts = Options(level=a.level, mode=a.mode, strategy=name, debug=True)
            t0 = time.perf_counter()
            try:
                r = _run(data, opts, a.target)
            except Exception as e:
                rec["variants"][name] = {"error": f"{type(e).__name__}: {e}"}
                row["cells"].append({"surf": None, "caption": [
                    (name, True, (0.13, 0.13, 0.16)),
                    (f"{type(e).__name__}", False, (0.75, 0.15, 0.15)),
                    (str(e)[:44], False, (0.75, 0.15, 0.15))]})
                print(f"{f.stem[:8]} {name:11s} FAILED  {type(e).__name__}: {e}")
                continue
            (d / f"{name}-answer.png").write_bytes(r["answer"])
            if a.puzzle:
                (d / f"{name}-puzzle.png").write_bytes(r["puzzle"])
            rec["variants"][name] = {k: v for k, v in r.items() if k not in ("answer", "puzzle")}
            rec["variants"][name]["wall_ms"] = round((time.perf_counter() - t0) * 1000)
            row["features"] = r["features"]
            q = r["quality"]
            title = name if name != "auto" else f"auto → {r['strategy']}"
            row["cells"].append({"surf": _surface(r["answer"]), "caption": [
                (title, True, (0.13, 0.13, 0.16)),
                (f"объектов {r['objects']} · точек {r['dots']} · отрывов {r['lifts']}", False, (0.13, 0.13, 0.16)),
                (f"recall {r['recall']:.2f} · precision {r['precision']:.2f}", False,
                 (0.15, 0.45, 0.2) if r["recall"] >= 0.85 else (0.75, 0.15, 0.15)),
                (f"замкнутых {r['closed']}/{r['strokes']} · наложений {q.get('label_overlaps', '?')}", False, (0.4, 0.4, 0.45))]})
            print(f"{f.stem[:8]} {title:18s} obj={r['objects']} dots={r['dots']} lifts={r['lifts']} "
                  f"closed={r['closed']}/{r['strokes']} recall={r['recall']:.3f} precision={r['precision']:.3f}")
        rows.append(row)
        report.append(rec)

    _contact(rows, ["исходник"] + names, out / f"contact-{a.level}.png", 841.89 / 595.28)
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    lines = ["| картинка | стратегия | объектов | точек | отрывов | замкнутых | recall | precision | наложений |",
             "|---|---|---|---|---|---|---|---|---|"]
    for rec in report:
        for name, v in rec["variants"].items():
            if "error" in v:
                lines.append(f"| {rec['image'][:8]} | {name} | — | — | — | — | — | — | {v['error']} |")
            else:
                lines.append(f"| {rec['image'][:8]} | {name} | {v['objects']} | {v['dots']} | {v['lifts']} | "
                             f"{v['closed']}/{v['strokes']} | {v['recall']:.3f} | {v['precision']:.3f} | "
                             f"{v['quality'].get('label_overlaps', '?')} |")
    (out / "report.md").write_text("\n".join(lines) + "\n")
    print(f"\n{out}/contact-{a.level}.png\n{out}/report.md")


if __name__ == "__main__":
    main()