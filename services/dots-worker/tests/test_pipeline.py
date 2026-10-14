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
