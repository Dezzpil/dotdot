"""Cleanup must remove page furniture, never the drawing itself."""
import cv2
import numpy as np

from dotdot.preprocess import prepare

W, H = 640, 480


def _png(*draws) -> bytes:
    im = np.full((H, W), 255, np.uint8)
    for d in draws:
        d(im)
    ok, buf = cv2.imencode(".png", im)
    assert ok
    return buf.tobytes()


def _star(im):
    """Sparse enough to look like a frame to a bbox-and-fill test, but it is the subject."""
    pts = []
    for k in range(10):
        r = 230 if k % 2 == 0 else 95
        a = np.pi / 2 + k * np.pi / 5
        pts.append([320 + r * np.cos(a) * 1.13, 240 - r * np.sin(a) * 0.87])
    cv2.polylines(im, [np.array(pts, np.int32)], True, 0, 8)


def _frame(im):
    cv2.rectangle(im, (10, 10), (630, 470), 0, 3)


def _sun_body(im):
    cv2.circle(im, (320, 240), 90, 0, 7)


def _rays(im):
    for k in range(8):
        a = k * np.pi / 4
        p = (int(320 + 110 * np.cos(a)), int(240 + 110 * np.sin(a)))
        q = (int(320 + 136 * np.cos(a)), int(240 + 136 * np.sin(a)))
        cv2.line(im, p, q, 0, 4)


def _count(mask) -> int:
    return cv2.connectedComponents(mask.astype(np.uint8), connectivity=8)[0] - 1


def test_frame_goes_and_the_character_stays():
    alone = prepare(_png(_star))
    both = prepare(_png(_star, _frame))
    assert both.report.frame_removed
    assert not alone.report.frame_removed
    assert both.ink.sum() == alone.ink.sum()


def test_full_width_rule_goes():
    def rule(im):
        cv2.line(im, (0, 60), (W - 1, 60), 0, 2)

    def body(im):
        cv2.circle(im, (320, 300), 120, 0, 8)

    alone = prepare(_png(body))
    both = prepare(_png(body, rule))
    assert both.report.rules_dropped == 1
    assert both.ink.sum() == alone.ink.sum()


def test_caption_row_goes():
    def caption(im):
        for k in range(5):
            x = 200 + k * 30
            cv2.rectangle(im, (x, 440), (x + 11, 458), 0, -1)

    alone = prepare(_png(_sun_body))
    both = prepare(_png(_sun_body, caption))
    assert both.report.text_rows == 1
    assert both.report.text_px > 0
    assert both.ink.sum() == alone.ink.sum()


def test_sun_rays_stay():
    prep = prepare(_png(_sun_body, _rays))
    assert prep.report.specks == 0
    assert prep.report.text_rows == 0
    assert _count(prep.ink) == 9  # the sun and all eight rays


def test_small_rings_stay():
    def rings(im):
        for p in ((120, 90), (520, 110), (140, 400), (500, 390)):
            cv2.circle(im, p, 10, 0, 3)

    def body(im):
        cv2.circle(im, (320, 240), 110, 0, 8)

    prep = prepare(_png(body, rings))
    assert prep.report.specks == 0
    assert prep.report.text_rows == 0
    assert _count(prep.ink) == 5