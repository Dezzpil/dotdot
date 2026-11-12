"""Filled areas print as ink: no dots, no numbers, no labels on top."""
import json

import cv2
import numpy as np
import pytest

from dotdot.pipeline import Options, generate, render_edited
from dotdot.plan_io import MAX_SOLIDS, BadPlanError, parse_plan, plan_from_doc, plan_to_json
from dotdot.preprocess import prepare


def _png(draw) -> bytes:
    im = np.full((480, 640), 255, np.uint8)
    draw(im)
    ok, buf = cv2.imencode(".png", im)
    assert ok
    return buf.tobytes()


def _ring(im):
    cv2.circle(im, (320, 240), 150, 0, 9)


PUPIL = _png(lambda im: (_ring(im), cv2.circle(im, (320, 240), 30, 0, -1)))
RING = _png(_ring)


def test_a_filled_disk_becomes_one_polygon():
    prep = prepare(PUPIL)
    assert len(prep.solids) == 1
    assert len(prep.solids[0]) >= 3
    assert not prep.lines_mask[240 - prep.y0, 320 - prep.x0]  # the pupil left the traced mask
    assert prep.ink[240 - prep.y0, 320 - prep.x0]  # but it is still part of the drawing


def test_a_ring_is_not_a_solid():
    assert prepare(RING).solids == []


def test_solids_cost_no_dots_and_take_no_labels():
    with_pupil = generate(PUPIL, Options(level="school", debug=True))
    without = generate(RING, Options(level="school"))
    p = json.loads(with_pupil.plan)
    assert len(p["solids"]) == 1
    assert with_pupil.stats["dots"] == without.stats["dots"]
    assert with_pupil.stats["quality"]["label_on_line"] == 0
    poly = np.array(p["solids"][0], np.float32)
    assert all(cv2.pointPolygonTest(poly, (float(x), float(y)), False) < 0 for x, y in p["dots"])


def test_the_key_is_absent_when_there_is_nothing_to_fill():
    assert "solids" not in json.loads(generate(RING, Options(level="school")).plan)
    assert parse_plan(generate(RING, Options(level="school")).plan).solids == []


def test_solids_survive_a_round_trip():
    res = generate(PUPIL, Options(level="school"))
    doc = parse_plan(res.plan)
    assert len(doc.solids) == 1
    again = json.loads(plan_to_json(plan_from_doc(doc), doc.page_w, doc.page_h, doc.image, doc.dot_r))
    assert again["solids"] == json.loads(res.plan)["solids"]


def test_an_edited_sheet_keeps_its_filled_areas():
    res = generate(PUPIL, Options(level="school"))
    edited = render_edited(res.plan, Options(level="school"))
    assert json.loads(edited.plan)["solids"] == json.loads(res.plan)["solids"]


def test_too_many_solids_are_refused():
    doc = json.loads(generate(PUPIL, Options(level="school")).plan)
    doc["solids"] = [doc["solids"][0]] * (MAX_SOLIDS + 1)
    with pytest.raises(BadPlanError):
        parse_plan(doc)


def test_a_solid_outside_the_page_is_refused():
    doc = json.loads(generate(PUPIL, Options(level="school")).plan)
    doc["solids"][0][0] = [doc["page"]["w"] + 50, 10.0]
    with pytest.raises(BadPlanError):
        parse_plan(doc)


def test_a_two_point_solid_is_refused():
    doc = json.loads(generate(PUPIL, Options(level="school")).plan)
    doc["solids"] = [doc["solids"][0][:2]]
    with pytest.raises(BadPlanError):
        parse_plan(doc)