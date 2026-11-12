"""The measurements the strategy choice is made from."""
import json

import cv2
import numpy as np
import pytest

from dotdot import features, strategies
from dotdot.preprocess import prepare
from dotdot.skeleton import build_graph, merge_degree2, prune_spurs


def _png(draw, w=640, h=480) -> bytes:
    im = np.full((h, w), 255, np.uint8)
    draw(im)
    ok, buf = cv2.imencode(".png", im)
    assert ok
    return buf.tobytes()


def _ring(im, xy, r=110, t=9):
    cv2.circle(im, xy, r, 0, t)


ONE = _png(lambda im: _ring(im, (320, 240), 150))
TWO = _png(lambda im: (_ring(im, (160, 240)), _ring(im, (480, 240))))
PUPIL = _png(lambda im: (_ring(im, (320, 240), 150), cv2.circle(im, (320, 240), 30, 0, -1)))


def _features(data):
    prep = prepare(data)
    g = build_graph(prep.ink)
    merge_degree2(g)
    prune_spurs(g, max_len=prep.stroke_width * 1.6 + 4)
    merge_degree2(g)
    return features.with_graph(features.from_prepared(prep), g)


def test_one_object_holds_all_the_ink():
    f = _features(ONE)
    assert f.n_roots == 1
    assert f.dominance == pytest.approx(1.0)
    assert strategies.choose(f)[0] == "subject"


def test_two_equal_objects_split_the_ink():
    f = _features(TWO)
    assert f.n_roots == 2
    assert f.dominance == pytest.approx(0.5, abs=0.02)
    assert strategies.choose(f)[0] != "subject" or f.dominance < 0.6


def test_a_pupil_does_not_become_an_object_of_its_own():
    f = _features(PUPIL)
    assert f.n_components == 1  # the pupil left the traced mask altogether
    assert f.n_roots == 1
    assert f.n_solid == 1
    assert f.solid_share > 0


@pytest.mark.parametrize("n", [1, 2, 3])
def test_cycle_rank_counts_enclosed_regions(n):
    spots = [(120, 120), (320, 240), (520, 360)][:n]
    f = _features(_png(lambda im: [_ring(im, p, 60, 8) for p in spots]))
    assert f.cycle_rank == n


def test_many_objects_never_choose_subject():
    f = _features(_png(lambda im: [_ring(im, p, 60, 8) for p in ((120, 120), (320, 240), (520, 360))]))
    assert f.n_roots == 3
    name, scores = strategies.choose(f)
    assert scores["subject"] == 0.0
    assert name in ("classes", "components")


def test_features_survive_json():
    f = _features(PUPIL)
    assert json.loads(json.dumps(f.as_json())) == f.as_json()


def test_resolve_honours_the_override():
    f = _features(ONE)
    assert strategies.resolve("components", f)[0].name == "components"
    assert strategies.resolve("auto", f)[0].name == "subject"