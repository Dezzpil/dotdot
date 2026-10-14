import pathlib

import pytest

from dotdot.pipeline import Options, generate
from dotdot.preprocess import BadImageError

SAMPLE = pathlib.Path(__file__).parent.parent / "samples" / "among-us.png"


@pytest.mark.parametrize("mode", ["auto", "all", "outline"])
@pytest.mark.parametrize("numbering", ["jumps", "series"])
@pytest.mark.parametrize("level", ["kid", "school", "adult"])
@pytest.mark.parametrize("labels", ["numbers", "math"])
def test_generate_all_options(mode, numbering, level, labels):
    res = generate(SAMPLE.read_bytes(), Options(mode=mode, numbering=numbering, level=level, labels=labels))
    assert res.pdf.startswith(b"%PDF")
    assert res.preview_puzzle.startswith(b"\x89PNG")
    assert 10 < res.stats["dots"] <= 320


def test_levels_scale_dot_count():
    data = SAMPLE.read_bytes()
    n = [generate(data, Options(level=l)).stats["dots"] for l in ("kid", "school", "adult")]
    assert n[0] < n[1] < n[2]


def test_rejects_garbage():
    with pytest.raises(BadImageError):
        generate(b"not an image", Options())


@pytest.mark.parametrize("level", ["kid", "school", "adult"])
@pytest.mark.parametrize("labels", ["numbers", "math"])
@pytest.mark.parametrize("mode", ["all", "outline"])
def test_layout_quality(level, labels, mode):
    q = generate(SAMPLE.read_bytes(), Options(level=level, labels=labels, mode=mode, debug=True)).stats["quality"]
    assert q["label_overlaps"] == 0
    assert q["label_on_dot"] == 0
    assert q["ambiguous"] <= 2
    assert q["label_on_line"] == 0


def test_fewer_pen_lifts():
    data = SAMPLE.read_bytes()
    strokes = {l: generate(data, Options(level=l, mode="all")).stats["strokes"] for l in ("kid", "school", "adult")}
    assert strokes["kid"] <= 11 and strokes["school"] <= 17 and strokes["adult"] <= 21
    assert generate(data, Options(mode="outline")).stats["strokes"] == 1


def test_default_mode_depends_on_level():
    data = SAMPLE.read_bytes()
    assert generate(data, Options(level="kid")).stats["options"]["mode"] == "outline"
    assert generate(data, Options(level="school")).stats["options"]["mode"] == "all"
    assert generate(data, Options(level="adult")).stats["options"]["mode"] == "all"


@pytest.mark.parametrize("level", ["kid", "school", "adult"])
def test_dot_one_is_at_the_top(level):
    """Dot 1 must be (one of) the top-most dots of the puzzle."""
    from dotdot import pipeline as pl
    captured = {}
    orig = pl.assign_texts

    def spy(plan, *a, **k):
        captured["plan"] = plan
        return orig(plan, *a, **k)

    pl.assign_texts = spy
    try:
        generate(SAMPLE.read_bytes(), Options(level=level))
    finally:
        pl.assign_texts = orig
    plan = captured["plan"]
    ys = sorted(d.xy[1] for d in plan.dots)
    first = plan.dots[plan.seq[0].dot].xy[1]
    assert first <= ys[min(2, len(ys) - 1)] + 1e-6
