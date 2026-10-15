"""The editor round trip: plan.json -> (user edits) -> render_edited."""
import copy
import json
import pathlib

import pytest

from dotdot.pipeline import Options, generate, render_edited
from dotdot.plan_io import BadPlanError, parse_plan

SAMPLE = pathlib.Path(__file__).parent.parent / "samples" / "among-us.png"


@pytest.fixture(scope="module")
def school():
    return generate(SAMPLE.read_bytes(), Options(level="school"))


def test_plan_json_describes_the_sheet(school):
    p = json.loads(school.plan)
    assert p["v"] == 1 and p["page"]["w"] > 0
    assert len(p["dots"]) == school.stats["dots"]
    assert len(p["paths"]) == school.stats["strokes"]
    assert sum(len(x) for x in p["paths"]) == school.stats["numbers"]
    assert {"s", "ox", "oy", "w", "h"} <= set(p["image"])
    assert len(school.plan) < 200_000


def test_unchanged_plan_renders_the_same_sheet(school):
    res = render_edited(school.plan, Options(level="school"))
    assert res.pdf.startswith(b"%PDF")
    assert res.stats["dots"] == school.stats["dots"]
    assert res.stats["strokes"] == school.stats["strokes"]
    assert res.stats["edited"] is True
    assert res.plan == school.plan  # stable: editing an edit does not drift


def test_moved_deleted_and_added_dots(school):
    p = json.loads(school.plan)
    p["dots"][0][0] += 15  # move
    path = p["paths"][0]
    victim = path[2]
    for q in p["paths"]:  # delete everywhere
        q[:] = [i for i in q if i != victim]
    a, b = p["dots"][path[0]], p["dots"][path[1]]
    p["dots"].append([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])  # add in the middle of a segment
    path.insert(1, len(p["dots"]) - 1)
    res = render_edited(json.dumps(p), Options(level="school", debug=True))
    out = json.loads(res.plan)
    assert res.stats["dots"] == school.stats["dots"]  # one removed, one added
    assert out["dots"][out["paths"][0][0]][0] == pytest.approx(p["dots"][path[0]][0])
    assert res.stats["quality"]["label_overlaps"] == 0


def test_unused_dots_and_repeats_are_cleaned():
    doc = parse_plan({"v": 1, "page": {"w": 595, "h": 842}, "dots": [[100, 100], [200, 100], [300, 300], [50, 50]],
                      "paths": [[0, 0, 1, 2, 2], [3]], "lines": []})
    assert doc.paths == [[0, 1, 2]]
    assert len(doc.dots) == 3


@pytest.mark.parametrize("bad", [
    {"v": 2},
    {"v": 1, "page": {"w": 595, "h": 842}, "dots": [[1e6, 1]], "paths": [[0, 0]]},
    {"v": 1, "page": {"w": 595, "h": 842}, "dots": [[10, 10]], "paths": [[0, 5]]},
    {"v": 1, "page": {"w": 595, "h": 842}, "dots": [[10, 10], [20, 20]], "paths": [[0]]},
    {"v": 1, "page": {"w": 595, "h": 842}, "dots": [["a", 1]], "paths": []},
    {"v": 1, "page": {"w": 595, "h": 842}, "dots": [[10, 10]] * 2000, "paths": [[0, 1]]},
])
def test_rejects_broken_plans(bad):
    with pytest.raises(BadPlanError):
        parse_plan(bad)


def test_other_options_apply_to_an_edited_plan(school):
    res = render_edited(school.plan, Options(level="school", numbering="series", labels="math", lang="en"))
    assert res.stats["options"]["numbering"] == "series"
    assert res.pdf.startswith(b"%PDF")


def test_image_mapping_puts_the_drawing_under_the_dots():
    """Dots sit on ink of the uploaded file when mapped back through plan.image."""
    import cv2
    import numpy as np

    data = SAMPLE.read_bytes()
    p = json.loads(generate(data, Options(level="school")).plan)
    gray = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    im = p["image"]
    assert (im["w"], im["h"]) == (gray.shape[1], gray.shape[0])
    ink = cv2.dilate((gray < 128).astype(np.uint8), np.ones((9, 9), np.uint8))
    hits = 0
    for x, y in p["dots"]:
        u, v = int((x - im["ox"]) / im["s"]), int((y - im["oy"]) / im["s"])
        hits += bool(0 <= v < ink.shape[0] and 0 <= u < ink.shape[1] and ink[v, u])
    assert hits / len(p["dots"]) > 0.95
