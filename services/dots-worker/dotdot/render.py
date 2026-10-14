"""Cairo rendering of the puzzle and answer pages (PDF + PNG previews)."""
from __future__ import annotations

import io

import cairo
import numpy as np

from .dots import Plan
from .labels import Placed

FONT = "DejaVu Sans"
INK = (0.13, 0.13, 0.16)
MUTED = (0.45, 0.45, 0.5)
ACCENT = (0.98, 0.45, 0.25)  # warm orange, matches the Dottie mascot

TEXTS = {
    "ru": {
        "title": "Соедини точки по порядку!",
        "answer": "Ответ — так должно получиться",
        "hint_numbers": "Веди линию от 1 к 2, потом к 3 и дальше, пока не появится картинка.",
        "hint_math": "Реши пример у точки — ответ подскажет её номер. Соединяй точки по порядку.",
        "hint_series": "Каждая буква — отдельная линия: A1 → A2 → …, затем B1 → B2 → …",
        "legend_jump": "кружок вокруг точки — начни здесь новую линию (оторви карандаш)",
        "legend_series": "кружок — первая точка линии",
        "footer": "dotdot · сделано с радостью",
        "stats": "точек: {n}",
    },
    "en": {
        "title": "Connect the dots in order!",
        "answer": "Answer key — here is what you should get",
        "hint_numbers": "Draw a line from 1 to 2, then to 3 and so on until the picture appears.",
        "hint_math": "Solve the example next to each dot to find its number, then connect in order.",
        "hint_series": "Each letter is a separate line: A1 → A2 → …, then B1 → B2 → …",
        "legend_jump": "ring around a dot — start a new line here (lift your pencil)",
        "legend_series": "ring — the first dot of a line",
        "footer": "dotdot · made with joy",
        "stats": "dots: {n}",
    },
}


class Layout:
    def __init__(self, img_w: int, img_h: int):
        landscape = img_w > img_h * 1.15
        self.w, self.h = (841.89, 595.28) if landscape else (595.28, 841.89)
        self.margin, self.header, self.footer = 34.0, 62.0, 34.0
        aw = self.w - 2 * self.margin
        ah = self.h - self.header - self.footer - self.margin
        self.s = min(aw / img_w, ah / img_h)
        dw, dh = img_w * self.s, img_h * self.s
        self.ox = (self.w - dw) / 2
        self.oy = self.margin + self.header - 8 + (ah - dh) / 2
        # area where labels may go
        self.bounds = (self.margin - 10, self.margin + self.header - 18,
                       self.w - self.margin + 10, self.h - self.footer - 4)

    def to_page(self, pts: np.ndarray) -> np.ndarray:
        return pts * self.s + np.array([self.ox, self.oy])


def _font(ctx: cairo.Context, size: float, bold: bool = False):
    ctx.select_font_face(FONT, cairo.FONT_SLANT_NORMAL,
                         cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
    ctx.set_font_size(size)


def _centered(ctx, text, x, y):
    te = ctx.text_extents(text)
    ctx.move_to(x - te.x_advance / 2, y)
    ctx.show_text(text)


def _mascot(ctx, x, y, r):
    """Dottie: a friendly dot with eyes and a smile."""
    ctx.set_source_rgb(*ACCENT)
    ctx.arc(x, y, r, 0, 2 * np.pi)
    ctx.fill()
    ctx.set_source_rgb(1, 1, 1)
    for dx in (-0.33, 0.33):
        ctx.arc(x + dx * r, y - 0.15 * r, 0.16 * r, 0, 2 * np.pi)
        ctx.fill()
    ctx.set_line_width(max(0.6, r * 0.12))
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.arc(x, y + 0.05 * r, 0.42 * r, 0.25 * np.pi, 0.75 * np.pi)
    ctx.stroke()


def _header(ctx, L: Layout, title: str, hint: str):
    _mascot(ctx, L.margin + 9, L.margin + 6, 9)
    ctx.set_source_rgb(*INK)
    _font(ctx, 17, True)
    _centered(ctx, title, L.w / 2, L.margin + 12)
    ctx.set_source_rgb(*MUTED)
    _font(ctx, 9)
    _centered(ctx, hint, L.w / 2, L.margin + 28)


def _footer(ctx, L: Layout, left: str, right: str, ring: bool):
    y = L.h - L.margin + 10
    _font(ctx, 7.5)
    ctx.set_source_rgb(*MUTED)
    x = L.margin
    if ring:
        ctx.set_source_rgb(*INK)
        ctx.arc(x + 3, y - 2.6, 1.8, 0, 2 * np.pi)
        ctx.fill()
        ctx.set_line_width(0.7)
        ctx.arc(x + 3, y - 2.6, 3.8, 0, 2 * np.pi)
        ctx.stroke()
        x += 10
        ctx.set_source_rgb(*MUTED)
    ctx.move_to(x, y)
    ctx.show_text(left)
    te = ctx.text_extents(right)
    ctx.move_to(L.w - L.margin - te.x_advance, y)
    ctx.show_text(right)


def _lines(ctx, plan: Plan, width: float):
    ctx.set_source_rgb(*INK)
    ctx.set_line_width(width)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    for line in plan.lines:
        ctx.move_to(*line[0])
        for p in line[1:]:
            ctx.line_to(*p)
        ctx.stroke()


def draw_puzzle(ctx, L: Layout, plan: Plan, placed: list[Placed], opts, font_size, dot_r):
    t = TEXTS[opts.lang]
    hint = t["hint_series"] if opts.numbering == "series" else (
        t["hint_math"] if opts.labels == "math" else t["hint_numbers"])
    _header(ctx, L, t["title"], hint)
    _lines(ctx, plan, 1.3)
    starts = {plan.seq[p[0]].dot for p in plan.paths}
    multi = len(plan.paths) > 1
    ctx.set_source_rgb(*INK)
    for i, d in enumerate(plan.dots):
        ctx.arc(d.xy[0], d.xy[1], dot_r, 0, 2 * np.pi)
        ctx.fill()
        if multi and i in starts:
            ctx.set_line_width(0.7)
            ctx.arc(d.xy[0], d.xy[1], dot_r + 2.0, 0, 2 * np.pi)
            ctx.stroke()
    _font(ctx, font_size)
    for p in placed:
        ctx.move_to(p.x, p.y)
        ctx.show_text(p.text)
    legend = (t["legend_series"] if opts.numbering == "series" else t["legend_jump"]) if multi else t["stats"].format(n=len(plan.dots))
    _footer(ctx, L, legend, t["footer"], ring=multi)


def draw_answer(ctx, L: Layout, plan: Plan, opts, dot_r):
    t = TEXTS[opts.lang]
    _header(ctx, L, t["answer"], "")
    _lines(ctx, plan, 1.3)
    ctx.set_source_rgb(*ACCENT)
    ctx.set_line_width(1.5)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    for path in plan.paths:
        xy = [plan.dots[plan.seq[i].dot].xy for i in path]
        ctx.move_to(*xy[0])
        for p in xy[1:]:
            ctx.line_to(*p)
        ctx.stroke()
    ctx.set_source_rgb(*INK)
    for d in plan.dots:
        ctx.arc(d.xy[0], d.xy[1], dot_r * 0.8, 0, 2 * np.pi)
        ctx.fill()
    _footer(ctx, L, t["stats"].format(n=len(plan.dots)), t["footer"], ring=False)


def render_pdf(L: Layout, plan, placed, opts, font_size, dot_r) -> bytes:
    buf = io.BytesIO()
    surf = cairo.PDFSurface(buf, L.w, L.h)
    surf.set_metadata(cairo.PDF_METADATA_TITLE, "DotDot")
    surf.set_metadata(cairo.PDF_METADATA_CREATOR, "DotDot")
    ctx = cairo.Context(surf)
    draw_puzzle(ctx, L, plan, placed, opts, font_size, dot_r)
    ctx.show_page()
    draw_answer(ctx, L, plan, opts, dot_r)
    ctx.show_page()
    surf.finish()
    return buf.getvalue()


def render_png(L: Layout, plan, placed, opts, font_size, dot_r, page: str = "puzzle", zoom: float = 2.0) -> bytes:
    surf = cairo.ImageSurface(cairo.FORMAT_RGB24, int(L.w * zoom), int(L.h * zoom))
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(1, 1, 1)
    ctx.paint()
    ctx.scale(zoom, zoom)
    if page == "puzzle":
        draw_puzzle(ctx, L, plan, placed, opts, font_size, dot_r)
    else:
        draw_answer(ctx, L, plan, opts, dot_r)
    buf = io.BytesIO()
    surf.write_to_png(buf)
    return buf.getvalue()
