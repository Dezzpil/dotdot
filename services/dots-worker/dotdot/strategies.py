"""How the drawing is split into objects. One object = one colour = one numbering.

`components` keeps every separate thing apart, `classes` folds repeated decoration into
one object per kind, `subject` treats the whole drawing as a single object. `choose` picks
one from the measured features; the user can always override it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

from . import objects
from .features import Features
from .skeleton import Graph


@dataclass(frozen=True)
class Strategy:
    name: str
    group: Callable[[np.ndarray, Graph, float], objects.Objects]


STRATEGIES = {s.name: s for s in (
    Strategy("components", objects.detect),
    Strategy("classes", objects.detect_classes),
    Strategy("subject", objects.detect_single),
)}
NAMES = tuple(STRATEGIES)


def scores(f: Features) -> dict[str, float]:
    return {
        # one silhouette holding almost all the ink: splitting it would invent objects
        "subject": f.dominance if f.n_roots <= 2 else 0.0,
        "classes": round(0.6 + 0.2 * min(f.n_classes, 2) / 2, 4),
        "components": 0.5,
    }


def choose(f: Features) -> tuple[str, dict[str, float]]:
    s = scores(f)
    return max(s, key=lambda k: s[k]), s


def resolve(name: str, f: Features) -> tuple[Strategy, dict[str, float]]:
    auto, s = choose(f)
    return STRATEGIES[name if name in STRATEGIES else auto], s