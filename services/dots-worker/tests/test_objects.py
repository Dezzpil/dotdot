"""Several objects on one sheet: separate contours, own colours, own numbering."""
import json
import pathlib

import cv2
import numpy as np
import pytest

from dotdot import objects
from dotdot.dots import assign_texts
from dotdot.pipeline import Options, generate
from dotdot.plan_io import BadPlanError, parse_plan, plan_from_doc
from dotdot.preprocess import prepare
from dotdot.skeleton import build_graph, merge_degree2, prune_spurs

PAGE = {"w": 595, "h": 842}
SAMPLE = pathlib.Path(__file__).parent.parent / "samples" / "among-us.png"


def _png(draw, w=640, h=480) -> bytes:
    im = np.full((h, w), 255, np.uint8)
    draw(im)
    ok, buf = cv2.imencode(".png", im)
    assert ok
    return buf.tobytes()


def _two_objects(im):
    cv2.circle(im, (170, 240), 120, 0, 8)  # object one: a ring...
    cv2.circle(im, (170, 240), 22, 0, 5)  # ...and a small ring inside its silhouette
    cv2.rectangle(im, (400, 130), (600, 350), 0, 8)  # object two, far away and comparable in size


TWO = _png(_two_objects)
CIRCLE = _png(lambda im: cv2.circle(im, (320, 240), 190, 0, 9))


def _nine_objects(im):
    for k in range(9):
        x, y = 40 + (k % 3) * 200, 40 + (k // 3) * 150
        cv2.rectangle(im, (x, y), (x + 90, y + 90), 0, 7)


def _scene(data):
    prep = prepare(data)
    g = build_graph(prep.ink)
    merge_degree2(g)
    prune_spurs(g, max_len=prep.stroke_width * 1.6 + 4)
    merge_degree2(g)
    return prep, g, objects.detect(prep.ink, g, prep.stroke_width)


def _groups_at(prep, g, obj, x, y, r=30):
    p = np.array([x - prep.x0, y - prep.y0])
    ids = [i for i, q in enumerate(g.nodes) if np.hypot(*(q - p)) < r]
    assert ids, "no skeleton near the probe"
    return {obj.of_node[i] for i in ids}


def _numbers_per_group(plan_json) -> dict[int, int]:
    p = json.loads(plan_json)
    out: dict[int, int] = {}
    for path, gi in zip(p["paths"], p["groups"]):
        out[gi] = out.get(gi, 0) + len(path)
    return out


def test_inner_detail_joins_its_object():
    prep, g, obj = _scene(TWO)
    assert obj.count == 2
    assert _groups_at(prep, g, obj, 170, 240) == _groups_at(prep, g, obj, 170, 120)  # pupil and ring
    assert _groups_at(prep, g, obj, 400, 130) != _groups_at(prep, g, obj, 170, 240)


def test_outline_gives_every_object_its_own_contour():
    res = generate(TWO, Options(mode="outline", level="school", debug=True))
    p = json.loads(res.plan)
    assert res.stats["contours"] == 2
    assert p["colors"] == list(objects.PALETTE[:2])
    counts = _numbers_per_group(res.plan)
    assert len(counts) == 2 and min(counts.values()) >= 3  # the second object is dots, not plain lines
    assert res.stats["quality"]["label_overlaps"] == 0


def test_numbering_restart_inside_each_object():
    doc = parse_plan({"v": 2, "page": PAGE, "dots": [[100, 100], [200, 100], [300, 100], [100, 300], [200, 300]],
                      "paths": [[0, 1, 2], [3, 4]], "groups": [0, 1],
                      "colors": ["#1f5fbf", "#d9480f"], "lines": []})
    plan = plan_from_doc(doc)
    assign_texts(plan, "jumps", "numbers", "school", 1)
    assert [it.text for it in plan.seq] == ["1", "2", "3", "4", "5"]
    assign_texts(plan, "color", "numbers", "school", 1)
    assert [it.text for it in plan.seq] == ["1", "2", "3", "1", "2"]
    assign_texts(plan, "series", "numbers", "school", 1)
    assert [it.text for it in plan.seq] == ["A1", "A2", "A3", "B1", "B2"]


def test_math_answers_stay_under_the_limit():
    loose = generate(TWO, Options(level="adult", labels="math", math_max=999))
    tight = generate(TWO, Options(level="adult", labels="math", math_max=12))
    assert max(_numbers_per_group(loose.plan).values()) > 12
    assert max(_numbers_per_group(tight.plan).values()) <= 12
    assert tight.stats["dots"] < loose.stats["dots"]  # the contour was simplified, not split
    assert tight.stats["contours"] == loose.stats["contours"] == 2


def test_a_contour_of_many_details_still_fits_the_limit():
    res = generate(SAMPLE.read_bytes(), Options(mode="all", level="school", labels="math", math_max=25))
    p = json.loads(res.plan)
    counts = _numbers_per_group(res.plan)
    assert max(counts.values()) <= 25  # even when two dots per stroke would already overflow the cap
    assert min(counts.values()) >= 3 and p["lines"]  # the contour stays numbered, the surplus becomes lines


def test_more_objects_than_colours_are_merged():
    res = generate(_png(_nine_objects), Options(level="school", mode="outline", strategy="components"))
    p = json.loads(res.plan)
    assert 1 < res.stats["contours"] <= objects.MAX_GROUPS
    assert len(p["colors"]) == res.stats["contours"]
    assert max(p["groups"]) < len(p["colors"])


def test_repeated_shapes_share_one_object_and_one_numbering():
    res = generate(_png(_nine_objects), Options(level="school", mode="outline", strategy="classes"))
    p = json.loads(res.plan)
    assert res.stats["contours"] == 1
    assert _numbers_per_group(res.plan) == {0: sum(len(path) for path in p["paths"])}
    # nine squares, nine separate paths: no line may run from one square to the next
    assert len(p["paths"]) == 9
    plan = plan_from_doc(parse_plan(res.plan))
    assign_texts(plan, "color", "numbers", "school", 1)
    assert [it.text for it in plan.seq] == [str(k) for k in range(1, len(plan.seq) + 1)]


@pytest.mark.parametrize("level", ["kid", "school", "adult"])
def test_level_aims_at_its_dot_count(level):
    from dotdot.pipeline import DOT_TARGET

    target = DOT_TARGET[level]
    for data in (CIRCLE, TWO):
        n = generate(data, Options(level=level)).stats["dots"]
        assert target * 0.7 <= n <= target


def test_v1_plan_keeps_one_object_per_line():
    doc = parse_plan({"v": 1, "page": PAGE, "dots": [[100, 100], [200, 100], [300, 300], [400, 300]],
                      "paths": [[0, 1], [2, 3]], "lines": []})
    assert doc.groups == [0, 1]
    assert doc.colors == [objects.INK_HEX] * 2
    plan = plan_from_doc(doc)
    assign_texts(plan, "series", "numbers", "school", 1)
    assert [it.text for it in plan.seq] == ["A1", "A2", "B1", "B2"]


@pytest.mark.parametrize("patch", [
    {"groups": [0]},
    {"groups": [0, 2]},
    {"groups": [0, "1"]},
    {"groups": None},
    {"colors": []},
    {"colors": ["#1f5fbf", "red"]},
    {"colors": ["#1f5fbf"]},
])
def test_rejects_broken_groups_and_colors(patch):
    doc = {"v": 2, "page": PAGE, "dots": [[100, 100], [200, 100], [300, 300], [400, 300]],
           "paths": [[0, 1], [2, 3]], "groups": [0, 1], "colors": ["#1f5fbf", "#d9480f"], "lines": []}
    doc.update(patch)
    with pytest.raises(BadPlanError):
        parse_plan(doc)


@pytest.mark.parametrize("math_max", [9, 1000, "100", True])
def test_rejects_bad_math_max(math_max):
    from dotdot.pipeline import BadOptionsError

    with pytest.raises(BadOptionsError):
        Options(math_max=math_max).validate()