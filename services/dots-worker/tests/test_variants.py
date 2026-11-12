"""One analysis, a ladder of dot counts: scene.json and the variant targets."""
import json
from dataclasses import replace

import pytest

from dotdot.pipeline import (LEVEL_RANGE, Options, analyze, default_target, generate, ladder_targets,
                             render_scene)
from dotdot.scene import BadSceneError, scene_from_json, scene_to_json
from test_objects import CIRCLE, SAMPLE, TWO


def _numbers_per_group(plan_json) -> dict[int, int]:
    p = json.loads(plan_json)
    out: dict[int, int] = {}
    for path, gi in zip(p["paths"], p["groups"]):
        out[gi] = out.get(gi, 0) + len(path)
    return out


@pytest.mark.parametrize("level", ["kid", "school", "adult"])
def test_ladder_stays_inside_the_level_and_the_scene(level):
    opts = Options(level=level).validate()
    scene = analyze(SAMPLE.read_bytes(), opts)
    targets = ladder_targets(scene, opts)
    lo, hi = LEVEL_RANGE[level]
    assert 1 <= len(targets) <= 5
    assert targets == sorted(set(targets))
    assert all(scene.dots_min <= t <= scene.dots_max and lo <= t <= hi for t in targets)


def test_a_simple_drawing_gets_fewer_variants():
    opts = Options(level="kid").validate()
    scene = analyze(CIRCLE, opts)
    assert len(ladder_targets(scene, opts)) < 5


def test_the_top_of_the_ladder_does_not_repeat_itself():
    """148 and 150 dots come out as the same sheet, so the last step is dropped."""
    opts = Options(level="school").validate()
    scene = replace(analyze(SAMPLE.read_bytes(), opts), dots_min=32, dots_max=150)
    assert ladder_targets(scene, opts) == [60, 81, 109, 148]


def test_own_number_centres_three_variants():
    opts = Options(level="school", target=100).validate()
    scene = analyze(SAMPLE.read_bytes(), opts)
    targets = ladder_targets(scene, opts)
    assert len(targets) == 3 and targets[1] == 100
    assert targets[0] < 100 < targets[2]


def test_math_ladder_and_every_variant_respect_the_answer_limit():
    opts = Options(level="school", labels="math", math_max=25).validate()
    scene = analyze(SAMPLE.read_bytes(), opts)
    contours = len(scene.colors)
    assert scene.dots_max <= 25 * contours
    targets = ladder_targets(scene, opts)
    assert targets and max(targets) <= 25 * contours
    for t in targets:
        res = render_scene(scene, opts, t)
        assert max(_numbers_per_group(res.plan).values()) <= 25


def test_scene_round_trip_and_a_variant_without_analysis():
    opts = Options(level="school").validate()
    scene = analyze(TWO, opts)
    back = scene_from_json(scene_to_json(scene))
    assert (back.dots_min, back.dots_max) == (scene.dots_min, scene.dots_max)
    assert len(back.strokes) == len(scene.strokes) and back.colors == scene.colors
    res = render_scene(back, opts, default_target(opts))
    assert res.stats["dots"] == generate(TWO, opts).stats["dots"]


def test_a_variant_hits_its_target():
    opts = Options(level="school").validate()
    scene = analyze(SAMPLE.read_bytes(), opts)
    dots = render_scene(scene, opts, 40).stats["dots"]
    assert 40 * 0.7 <= dots <= 40


@pytest.mark.parametrize("raw", [b"not json", {"v": 9}, {"v": 1, "page": {"w": 595, "h": 842}}])
def test_broken_scene_is_rejected(raw):
    with pytest.raises(BadSceneError):
        scene_from_json(raw)