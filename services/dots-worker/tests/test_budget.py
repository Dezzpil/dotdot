"""The dot budget is shared between strokes: main shapes get dots, the rest is printed."""
import numpy as np
import pytest

from dotdot import render
from dotdot.dots import DOT_FLOOR, allocate, build_plan, simplify
from dotdot.pipeline import (LEVELS, LEVEL_RANGE, Options, analyze, default_target, ladder_targets,
                             render_scene)
from dotdot.strokes import Stroke
from test_objects import CIRCLE, SAMPLE

CURVE = Stroke(np.array([[float(x), 100 + 40 * np.sin(x / 30.0)] for x in range(50, 500, 5)]), False)
STRAIGHT = Stroke(np.array([[float(x), 300.0] for x in range(50, 501, 5)]), False)


def _school(level="school"):
    opts = Options(level=level, mode="all").validate()
    eps0, cap, _, _, dmin, maxseg, _ = LEVELS[level]
    return opts, eps0, cap, dmin, maxseg


def _able(strokes, eps0, dmin):
    """Strokes that can hold the floor at the level's tolerance: the rest is printed anyway."""
    return [s for s in strokes if len(simplify(s, eps0, dmin)) >= DOT_FLOOR]


def test_the_longest_strokes_get_the_budget():
    opts, eps0, _, dmin, maxseg = _school()
    scene = analyze(SAMPLE.read_bytes(), opts)
    table = allocate(list(scene.strokes), default_target(opts), eps0, dmin, maxseg)
    able = _able(scene.strokes, eps0, dmin)
    kept = [s for s in able if id(s) in table]
    dropped = [s for s in able if id(s) not in table]
    assert kept and dropped, "the sample is too detailed for one school budget"
    assert min(s.length for s in kept) >= max(s.length for s in dropped)


def test_a_big_budget_dots_the_whole_drawing():
    opts, eps0, _, dmin, maxseg = _school()
    scene = analyze(SAMPLE.read_bytes(), opts)
    table = allocate(list(scene.strokes), scene.dots_max, eps0, dmin, maxseg)
    assert {id(s) for s in _able(scene.strokes, eps0, dmin)} <= set(table)


def test_every_admitted_stroke_really_holds_the_floor():
    """The floor counts real dots, not the promised share: minimum spacing may break a promise."""
    opts, eps0, _, dmin, maxseg = _school()
    scene = analyze(SAMPLE.read_bytes(), opts)
    for budget in (default_target(opts), scene.dots_max):
        table = allocate(list(scene.strokes), budget, eps0, dmin, maxseg)
        assert table
        for s in scene.strokes:
            if id(s) in table:
                eps, seg = table[id(s)]
                assert len(simplify(s, eps, dmin, seg)) >= DOT_FLOOR


def test_bends_win_the_budget_over_a_straight_run():
    _, eps0, _, dmin, maxseg = _school()
    table = allocate([STRAIGHT, CURVE], 30, eps0, dmin, maxseg)
    assert id(CURVE) in table and id(STRAIGHT) not in table


def test_quotas_print_the_straight_run_as_a_line():
    _, eps0, _, dmin, maxseg = _school()
    plan = build_plan([STRAIGHT, CURVE], [], eps0, 30, dmin, maxseg, quota=True)
    assert len(plan.paths) == 1 and len(plan.lines) == 1


def test_without_quotas_a_straight_run_still_gets_dots():
    """outline mode is untouched: long arcs are broken into dots even without bends."""
    _, eps0, _, dmin, maxseg = _school()
    plan = build_plan([STRAIGHT], [], eps0, 30, dmin, maxseg)
    assert len(plan.dots) >= DOT_FLOOR and not plan.lines


def test_a_drawing_with_no_bends_at_all_still_gets_a_puzzle():
    _, eps0, _, dmin, maxseg = _school()
    plan = build_plan([STRAIGHT], [], eps0, 30, dmin, maxseg, quota=True)
    assert len(plan.dots) >= DOT_FLOOR


@pytest.mark.parametrize("level", ["kid", "school", "adult"])
def test_the_ladder_climbs_to_the_whole_drawing(level):
    opts, _, _, _, _ = _school(level)
    scene = analyze(SAMPLE.read_bytes(), opts)
    targets = ladder_targets(scene, opts)
    top = min(scene.dots_max, LEVEL_RANGE[level][1])
    # the last step may be dropped when it would repeat the previous sheet
    assert top / 1.05 <= targets[-1] <= top
    assert targets == sorted(set(targets))
    assert all(b >= a * 1.05 for a, b in zip(targets, targets[1:]))
    assert all(scene.dots_min <= t <= scene.dots_max for t in targets)


def test_a_simple_drawing_gets_fewer_variants():
    opts = Options(level="kid").validate()
    assert len(ladder_targets(analyze(CIRCLE, opts), opts)) < 5


@pytest.mark.parametrize("level", ["kid", "school", "adult"])
def test_the_level_ceiling_holds_and_the_budget_is_never_exceeded(level):
    opts, _, cap, _, _ = _school(level)
    scene = analyze(SAMPLE.read_bytes(), opts)
    assert scene.dots_max <= cap
    for t in ladder_targets(scene, opts):
        assert render_scene(scene, opts, t).stats["dots"] <= t


def test_the_puzzle_says_that_part_of_the_drawing_is_printed(monkeypatch):
    seen = []
    monkeypatch.setattr(render, "_header", lambda ctx, L, title, hint, note="": seen.append(note))
    opts, _, _, _, _ = _school()
    render_scene(analyze(SAMPLE.read_bytes(), opts), opts, default_target(opts))
    note = render.TEXTS[opts.lang]["note_printed"]
    assert note and render.TEXTS["en"]["note_printed"]
    assert seen[0::2] == [note, note]  # puzzle pages
    assert seen[1::2] == ["", ""]  # the answer key needs no warning