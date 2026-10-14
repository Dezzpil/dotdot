"""Image loading and cleanup: binarization, frame / watermark removal, cropping."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from skimage.morphology import remove_small_holes

MAX_SIDE = 1600
MAX_PIXELS = 40_000_000  # refuse decompression bombs before decoding


class BadImageError(ValueError):
    """Raised when the input cannot be decoded or contains no drawing."""


@dataclass
class Prepared:
    ink: np.ndarray  # bool mask, True = line pixel
    stroke_width: float  # estimated line thickness in px


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
    return gray


def binarize(gray: np.ndarray) -> np.ndarray:
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return th > 0


def _remove_frame_and_watermark(ink: np.ndarray) -> np.ndarray:
    h, w = ink.shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    keep = np.ones(n, bool)
    keep[0] = False
    frame = None
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if bw >= 0.75 * w and bh >= 0.75 * h and area / (bw * bh) < 0.2:
            keep[i] = False  # a thin rectangle around the page
            frame = (x, y, x + bw, y + bh)
    total = h * w
    band = 0.045 * max(h, w)
    for i in range(1, n):
        if not keep[i]:
            continue
        x, y, bw, bh, area = stats[i]
        if area < 0.00003 * total:
            keep[i] = False  # specks
            continue
        if frame is not None and area < 0.004 * total:
            fx0, fy0, fx1, fy1 = frame
            near = min(abs(y - fy0), abs(fy1 - (y + bh)), abs(x - fx0), abs(fx1 - (x + bw)))
            if near < band:
                keep[i] = False  # small marks sitting on the frame: watermarks / captions
    return keep[labels]


def prepare(data: bytes) -> Prepared:
    gray = decode(data)
    ink = binarize(gray)
    ink = _remove_frame_and_watermark(ink)
    if ink.sum() < 50:
        raise BadImageError("no drawing found")
    ys, xs = np.nonzero(ink)
    pad = 8
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, ink.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, ink.shape[1])
    ink = ink[y0:y1, x0:x1]
    # close pinholes inside thick lines so the skeleton has no fake loops
    ink = cv2.morphologyEx(ink.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
    dist = cv2.distanceTransform(ink.astype(np.uint8), cv2.DIST_L2, 5)
    sw = float(np.percentile(dist[ink], 90) * 2) if ink.any() else 2.0
    ink = remove_small_holes(ink, max_size=max(16, int(sw * sw * 0.8)))
    return Prepared(ink=ink, stroke_width=max(sw, 1.0))
