"""Which parts of the drawing become one object, one colour, one numbering."""
import pathlib

import cv2
import numpy as np

from dotdot import objects
from dotdot.preprocess import prepare
from dotdot.skeleton import build_graph, merge_degree2, prune_spurs

SAMPLE = pathlib.Path(__file__).parent.parent / "samples" / "among-us.png"
W, H = 900, 700


def _png(draw) -> bytes:
    im = np.full((H, W), 255, np.uint8)
    draw(im)
    ok, buf = cv2.imencode(".png", im)
    assert ok
    return buf.tobytes()


def _pumpkin(im):
    """A subject, four identical leaves near it and four identical stars far away."""
    cv2.circle(im, (450, 350), 180, 0, 9)
    for k, rad in enumerate((226, 229, 233, 262)):
        a = np.pi / 4 + k * np.pi / 2
        p = (int(450 + rad * np.cos(a)), int(350 + rad * np.sin(a)))
        cv2.ellipse(im, p, (30, 25), 0, 0, 360, 0, 6)
    for p in ((60, 60), (840, 60), (60, 640), (840, 640)):
        x, y = p
        cv2.polylines(im, [np.array([[x, y - 18], [x + 18, y], [x, y + 18], [x - 18, y]], np.int32)],
                      True, 0, 5)


def _balloon(im):
    """A subject and four comparable clouds far from it: a scene, not decoration."""
    cv2.circle(im, (450, 350), 150, 0, 9)
    for p in ((120, 110), (780, 110), (120, 590), (780, 590)):
        cv2.ellipse(im, p, (55, 35), 0, 0, 360, 0, 7)


def _scene(data):
    prep = prepare(data)
    g = build_graph(prep.ink)
    merge_degree2(g)
    prune_spurs(g, max_len=prep.stroke_width * 1.6 + 4)
    merge_degree2(g)
    return prep, g


def _group_at(prep, obj, x, y):
    """Which object owns the ink at this point. Probes lie on a shape's outline."""
    px, py = int(round(x - prep.x0)), int(round(y - prep.y0))
    hits = {k for k, m in enumerate(obj.masks) if m[py, px]}
    assert len(hits) == 1, f"expected one object at {(x, y)}, got {hits}"
    return hits


def test_repeated_decoration_becomes_one_object_per_kind():
    prep, g = _scene(_png(_pumpkin))
    obj = objects.detect_classes(prep.ink, g, prep.stroke_width)
    assert obj.count == 3  # the subject, the leaves, the stars
    leaves = set()
    for k, rad in enumerate((226, 229, 233, 262)):
        a = np.pi / 4 + k * np.pi / 2
        leaves |= _group_at(prep, obj, 450 + rad * np.cos(a) + 30, 350 + rad * np.sin(a))
    assert len(leaves) == 1


def test_components_splits_identical_leaves_inconsistently():
    prep, g = _scene(_png(_pumpkin))
    obj = objects.detect(prep.ink, g, prep.stroke_width)
    assert obj.count >= 6
    groups = set()
    for k, rad in enumerate((226, 229, 233, 262)):
        a = np.pi / 4 + k * np.pi / 2
        groups |= _group_at(prep, obj, 450 + rad * np.cos(a) + 30, 350 + rad * np.sin(a))
    assert len(groups) > 1  # four identical leaves, more than one colour


def test_comparable_objects_far_apart_are_not_folded():
    prep, g = _scene(_png(_balloon))
    c = objects._components(prep.ink, prep.stroke_width)
    assert objects._collapsed(c, objects._classes(c)) == []
    obj = objects.detect_classes(prep.ink, g, prep.stroke_width)
    assert obj.count == 5
    clouds = [_group_at(prep, obj, x + 55, y) for x, y in ((120, 110), (780, 110), (120, 590), (780, 590))]
    assert len({frozenset(s) for s in clouds}) == 4


def test_subject_puts_everything_in_one_numbering():
    prep, g = _scene(_png(_pumpkin))
    obj = objects.detect_single(prep.ink, g, prep.stroke_width)
    assert obj.count == 1
    assert set(obj.of_node.values()) == {0}


def test_components_is_unchanged_on_the_reference_sample():
    prep, g = _scene(SAMPLE.read_bytes())
    base = objects.detect(prep.ink, g, prep.stroke_width)
    same = objects.detect_classes(prep.ink, g, prep.stroke_width)
    assert base.count == same.count
    assert all(np.array_equal(a, b) for a, b in zip(base.masks, same.masks))
    assert base.of_edge == same.of_edge