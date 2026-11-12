"""The coverage metric itself: it must reward a faithful answer and punish a shifted one."""
import cv2
import numpy as np

from dotdot.dots import Dot, Plan, number_paths
from dotdot.metrics import ink_coverage
from dotdot.objects import INK_HEX

CENTRE, R, SW = 100.0, 60.0, 3.0


def _ink() -> np.ndarray:
    m = np.zeros((200, 200), np.uint8)
    cv2.circle(m, (int(CENTRE), int(CENTRE)), int(R), 1, int(SW))
    return m > 0


def _plan(shift=0.0) -> Plan:
    a = np.linspace(0, 2 * np.pi, 180, endpoint=False)
    xy = np.stack([CENTRE + shift + R * np.cos(a), CENTRE + R * np.sin(a)], axis=1)
    dots = [Dot(p) for p in xy]
    seq, paths = number_paths(dots, [list(range(len(xy)))], [0])
    return Plan(dots, seq, paths, [], [0], [INK_HEX])


def _cov(plan):
    return ink_coverage(plan, _ink(), SW, lambda p: np.asarray(p, float))


def test_a_faithful_answer_covers_the_drawing():
    cov = _cov(_plan())
    assert cov["recall"] > 0.9
    assert cov["precision"] > 0.9


def test_a_shifted_answer_does_not():
    cov = _cov(_plan(shift=30.0))
    assert cov["recall"] < 0.3
    assert cov["precision"] < 0.3


def test_filled_areas_count_towards_coverage():
    m = np.zeros((200, 200), np.uint8)
    cv2.circle(m, (100, 100), 20, 1, -1)
    ink = m > 0
    poly = np.array([[100 + 20 * np.cos(t), 100 + 20 * np.sin(t)]
                     for t in np.linspace(0, 2 * np.pi, 60, endpoint=False)])
    plan = _plan()
    plan.solids = [poly]
    cov = ink_coverage(plan, ink, SW, lambda p: np.asarray(p, float))
    assert cov["recall"] > 0.9