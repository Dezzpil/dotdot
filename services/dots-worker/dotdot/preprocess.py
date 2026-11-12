"""Image loading and cleanup: binarization, frame / watermark removal, cropping."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations

import cv2
import numpy as np
from scipy.ndimage import binary_fill_holes
from skimage.morphology import remove_small_holes

MAX_SIDE = 1600
MAX_PIXELS = 40_000_000  # refuse decompression bombs before decoding
# a filled blob: dense in its bbox, almost no holes, big enough to be worth printing solid
SOLID_FILL = 0.60
SOLID_SOLIDITY = 0.85
SOLID_AREA = 0.0005
SOLID_SIDE = 2.5


class BadImageError(ValueError):
    """Raised when the input cannot be decoded or contains no drawing."""


@dataclass
class CleanReport:
    frame_removed: bool = False
    rules_dropped: int = 0
    text_rows: int = 0
    text_px: int = 0
    specks: int = 0


@dataclass
class Prepared:
    ink: np.ndarray  # bool mask, True = line pixel
    lines_mask: np.ndarray  # ink without the filled areas: this is what gets traced
    stroke_width: float  # estimated line thickness in px
    # how ink pixels relate to the uploaded file: ink = original * scale - (x0, y0)
    scale: float = 1.0
    x0: int = 0
    y0: int = 0
    orig_w: int = 0
    orig_h: int = 0
    report: CleanReport = field(default_factory=CleanReport)
    solids: list[np.ndarray] = field(default_factory=list)  # closed polygons of filled areas, crop px


def _check_size(data: bytes) -> None:
    from PIL import Image, UnidentifiedImageError
    import io
    try:
        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
    except (UnidentifiedImageError, OSError) as e:
        raise BadImageError("cannot decode image") from e
    if w * h > MAX_PIXELS:
        raise BadImageError(f"image too large: {w}x{h}")
    if min(w, h) < 32:
        raise BadImageError(f"image too small: {w}x{h}")


def decode(data: bytes) -> np.ndarray:
    return decode_scaled(data)[0]


def decode_scaled(data: bytes) -> tuple[np.ndarray, float, int, int]:
    """Grayscale image (at most MAX_SIDE), resize factor, original width and height."""
    _check_size(data)
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise BadImageError("cannot decode image")
    if img.ndim == 2:
        gray = img
    elif img.shape[2] == 4:
        # composite transparent images over white
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        rgb = img[:, :, :3].astype(np.float32) * alpha + 255.0 * (1 - alpha)
        gray = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_BGR2GRAY)
    else:
        gray = cv2.cvtColor(img[:, :, :3], cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    k = MAX_SIDE / max(h, w)
    if k < 1:
        gray = cv2.resize(gray, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
    else:
        k = 1.0
    return gray, k, w, h


def binarize(gray: np.ndarray) -> np.ndarray:
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return th > 0


def _width(ink: np.ndarray) -> float:
    if not ink.any():
        return 2.0
    dist = cv2.distanceTransform(ink.astype(np.uint8), cv2.DIST_L2, 5)
    return float(np.percentile(dist[ink], 90) * 2)


def _is_frame(m: np.ndarray, area: int, sw: float) -> bool:
    """A page border hugs its own bbox; a drawing also fills the middle of it."""
    bh, bw = m.shape
    t = max(2, int(sw))
    border = np.ones(m.shape, bool)
    border[t:bh - t, t:bw - t] = False
    near = float((m & border).sum()) / area
    kx, ky = int(bw * 0.12), int(bh * 0.12)
    inner = float(m[ky:bh - ky, kx:bw - kx].sum()) / area
    return near > 0.9 and inner < 0.02


def _text_rows(stats, keep, labels, h: int, w: int, sw: float) -> list[list[int]]:
    """Rows of caption glyphs: small, of similar height, isolated from the drawing."""
    total = h * w
    side = 0.05 * max(h, w)
    cand = [i for i in range(1, len(stats))
            if keep[i] and stats[i][2] <= side and stats[i][3] <= side
            and stats[i][4] <= 0.0008 * total]
    # a caption has a handful of glyphs; thousands of candidates mean hatching, not text
    if len(cand) < 3 or len(cand) > 400:
        return []
    parent = {i: i for i in cand}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in combinations(cand, 2):
        ax, ay, aw, ah, _ = stats[a]
        bx, by, bw, bh, _ = stats[b]
        mh = min(ah, bh)
        if (min(ay + ah, by + bh) - max(ay, by) >= 0.6 * mh
                and max(ax, bx) - min(ax + aw, bx + bw) <= 1.2 * mh):
            parent[find(a)] = find(b)
    rows = defaultdict(list)
    for i in cand:
        rows[find(i)].append(i)
    big = [i for i in range(1, len(stats)) if keep[i] and stats[i][4] > 0.004 * total]
    big_mask = np.isin(labels, big) if big else None
    pad = max(6, int(sw))
    dropped = []
    for members in rows.values():
        if len(members) < 3:
            continue
        hs = [stats[i][3] for i in members]
        if max(hs) > 2.0 * min(hs):
            continue
        x0 = min(stats[i][0] for i in members)
        y0 = min(stats[i][1] for i in members)
        x1 = max(stats[i][0] + stats[i][2] for i in members)
        y1 = max(stats[i][1] + stats[i][3] for i in members)
        area = sum(int(stats[i][4]) for i in members)
        if x1 - x0 < 2 * (y1 - y0):
            continue
        if not (y0 < 0.10 * h or y1 > 0.90 * h or area < 0.0005 * total):
            continue
        if big_mask is not None and big_mask[max(y0 - pad, 0):min(y1 + pad, h),
                                             max(x0 - pad, 0):min(x1 + pad, w)].any():
            continue
        dropped.append(members)
    return dropped


def _clean(ink: np.ndarray, sw: float) -> tuple[np.ndarray, CleanReport]:
    h, w = ink.shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    keep = np.ones(n, bool)
    keep[0] = False
    report = CleanReport()
    frame = None
    thin = max(3.0, sw * 0.6)
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if (bw >= 0.9 * w and bh <= thin) or (bh >= 0.9 * h and bw <= thin):
            keep[i] = False  # a ruler line across the page
            report.rules_dropped += 1
            continue
        if bw >= 0.75 * w and bh >= 0.75 * h and area / (bw * bh) < 0.2:
            if _is_frame(labels[y:y + bh, x:x + bw] == i, int(area), sw):
                keep[i] = False  # a thin rectangle around the page
                report.frame_removed = True
                frame = (x, y, x + bw, y + bh)
    total = h * w
    band = 0.045 * max(h, w)
    for i in range(1, n):
        if not keep[i]:
            continue
        x, y, bw, bh, area = stats[i]
        if area < 0.00003 * total:
            keep[i] = False  # specks
            report.specks += 1
            continue
        if frame is not None and area < 0.004 * total:
            fx0, fy0, fx1, fy1 = frame
            near = min(abs(y - fy0), abs(fy1 - (y + bh)), abs(x - fx0), abs(fx1 - (x + bw)))
            if near < band:
                keep[i] = False  # small marks sitting on the frame: watermarks / captions
    rows = _text_rows(stats, keep, labels, h, w, sw)
    for row in rows:
        for i in row:
            keep[i] = False
            report.text_px += int(stats[i][4])
    report.text_rows = len(rows)
    return keep[labels], report


def _solid_blobs(ink: np.ndarray, sw: float) -> list[np.ndarray]:
    """Filled areas such as pupils: a skeleton would turn them into a dash inside the eye."""
    h, w = ink.shape
    n, lab, stats, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    hits = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area < SOLID_AREA * h * w or min(bw, bh) < SOLID_SIDE * sw:
            continue
        if area / (bw * bh) < SOLID_FILL:
            continue
        m = lab[y:y + bh, x:x + bw] == i
        if area / max(1, int(binary_fill_holes(m).sum())) < SOLID_SOLIDITY:
            continue
        hits.append((x, y, m))
    if not hits or len(hits) == n - 1:
        return []  # a drawing that is nothing but blobs still needs its contours
    out = []
    for x, y, m in hits:
        cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out.append(max(cnts, key=cv2.contourArea).reshape(-1, 2).astype(float) + (x, y))
    return out


def prepare(data: bytes) -> Prepared:
    gray, k, ow, oh = decode_scaled(data)
    ink = binarize(gray)
    ink, report = _clean(ink, _width(ink))
    if ink.sum() < 50:
        raise BadImageError("no drawing found")
    ys, xs = np.nonzero(ink)
    pad = 8
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, ink.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, ink.shape[1])
    ink = ink[y0:y1, x0:x1]
    # close pinholes inside thick lines so the skeleton has no fake loops
    ink = cv2.morphologyEx(ink.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
    sw = _width(ink)
    ink = remove_small_holes(ink, max_size=max(16, int(sw * sw * 0.8)))
    solids = _solid_blobs(ink, max(sw, 1.0))
    lines = ink
    if solids:
        cover = np.zeros(ink.shape, np.uint8)
        cv2.fillPoly(cover, [np.round(p).astype(np.int32) for p in solids], 1)
        lines = ink & (cover == 0)
        sw = _width(lines)  # a thick pupil must not set the line width of the drawing
    return Prepared(ink=ink, lines_mask=lines, stroke_width=max(sw, 1.0), scale=k,
                    x0=int(x0), y0=int(y0), orig_w=ow, orig_h=oh, report=report, solids=solids)
