"""The real colouring pages, when they are available: DOTDOT_SAMPLES=/path/to/jpegs pytest.

Invariants, not golden pixels. The coverage and label floors are regression floors measured
on the 19-image set at the top of the ladder, not quality targets: a scene with far more
detail than the page can label is simplified, and the rest of the drawing is printed.
"""
import os
import pathlib

import numpy as np
import pytest

from dotdot.metrics import ink_coverage
from dotdot.pipeline import Options, analyze, ladder_targets, render_scene
from dotdot.plan_io import parse_plan, plan_from_doc
from dotdot.preprocess import prepare

SAMPLES = os.environ.get("DOTDOT_SAMPLES")
SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
FILES = sorted(p for p in pathlib.Path(SAMPLES).iterdir() if p.suffix.lower() in SUFFIXES) if SAMPLES else []

pytestmark = pytest.mark.skipif(not FILES, reason="set DOTDOT_SAMPLES to a directory of drawings")


@pytest.mark.parametrize("level", ["school", "adult"])
@pytest.mark.parametrize("f", FILES, ids=[p.stem[:8] for p in FILES])
def test_a_real_drawing_makes_a_sheet(f, level):
    data = f.read_bytes()
    opts = Options(level=level, mode="all", debug=True).validate()
    prep = prepare(data)
    scene = analyze(data, opts)
    assert scene.strokes, "the drawing itself must survive preprocessing"
    assert 0 < scene.dots_min <= scene.dots_max
    assert len(scene.colors) <= 6

    # page pt -> crop px, inverted from scene.image (page = crop * L.s + L.o)
    ls = scene.image["s"] / prep.scale
    off = np.array([scene.image["ox"] + prep.x0 * ls, scene.image["oy"] + prep.y0 * ls])
    target = ladder_targets(scene, opts)[-1]
    res = render_scene(scene, opts, target)
    assert res.stats["dots"] <= target, "the budget is a ceiling, not a wish"
    plan = plan_from_doc(parse_plan(res.plan))
    cov = ink_coverage(plan, prep.ink, prep.stroke_width,
                       lambda p: (np.asarray(p, float) - off) / ls)
    assert cov["recall"] >= 0.80, f"{f.name}: {cov}"
    assert cov["precision"] >= 0.60, f"{f.name}: {cov}"
    q = res.stats["quality"]
    # above ~300 numbers the page runs out of label room: overlaps and ambiguity explode
    assert q["label_overlaps"] <= 2, f"{f.name}: {q}"
    assert q["ambiguous"] <= 0.15 * q["labels"], f"{f.name}: {q}"