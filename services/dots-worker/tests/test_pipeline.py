import pathlib

import pytest

from dotdot.pipeline import Options, generate
from dotdot.preprocess import BadImageError

SAMPLE = pathlib.Path(__file__).parent.parent / "samples" / "among-us.png"


@pytest.mark.parametrize("mode", ["all", "outline"])
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
def test_layout_quality(level, labels):
    q = generate(SAMPLE.read_bytes(), Options(level=level, labels=labels, debug=True)).stats["quality"]
    assert q["label_overlaps"] == 0
    assert q["label_on_dot"] == 0
    assert q["ambiguous"] <= 2
    assert q["label_on_line"] == 0


def test_fewer_pen_lifts():
    data = SAMPLE.read_bytes()
    strokes = {l: generate(data, Options(level=l)).stats["strokes"] for l in ("kid", "school", "adult")}
    assert strokes["kid"] <= 10 and strokes["school"] <= 16 and strokes["adult"] <= 20
    assert generate(data, Options(mode="outline")).stats["strokes"] == 1
