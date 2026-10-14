"""Skeletonize the line mask and turn it into a graph of polyline edges."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
from skimage.morphology import skeletonize

OFFSETS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


@dataclass(eq=False)
class Edge:
    u: int
    v: int
    pts: np.ndarray  # (N, 2) float, x/y, from node u to node v

    @property
    def length(self) -> float:
        d = np.diff(self.pts, axis=0)
        return float(np.hypot(d[:, 0], d[:, 1]).sum())


@dataclass(eq=False)
class Graph:
    nodes: list[np.ndarray] = field(default_factory=list)  # node centroids (x, y)
    edges: dict[int, Edge] = field(default_factory=dict)

    def degree(self) -> dict[int, int]:
        deg: dict[int, int] = defaultdict(int)
        for e in self.edges.values():
            deg[e.u] += 1
            deg[e.v] += 1
        return deg

    def incident(self) -> dict[int, list[int]]:
        inc: dict[int, list[int]] = defaultdict(list)
        for k, e in self.edges.items():
            inc[e.u].append(k)
            if e.v != e.u:
                inc[e.v].append(k)
        return inc


def _pixel_neighbors(skel: np.ndarray):
    ys, xs = np.nonzero(skel)
    idx = np.full((skel.shape[0] + 2, skel.shape[1] + 2), -1, np.int64)
    idx[ys + 1, xs + 1] = np.arange(len(ys))
    nbrs: list[list[int]] = [[] for _ in range(len(ys))]
    for dy, dx in OFFSETS:
        nb = idx[ys + 1 + dy, xs + 1 + dx]
        ok = nb >= 0
        if dy and dx:
            # drop a diagonal link when a 4-connected path exists: avoids fake junctions
            ok &= ~((idx[ys + 1 + dy, xs + 1] >= 0) | (idx[ys + 1, xs + 1 + dx] >= 0))
        for i in np.nonzero(ok)[0]:
            nbrs[i].append(int(nb[i]))
    return ys, xs, nbrs


def build_graph(ink: np.ndarray) -> Graph:
    skel = skeletonize(ink)
    ys, xs, nbrs = _pixel_neighbors(skel)
    n = len(ys)
    is_node = np.array([len(a) != 2 for a in nbrs], bool)
    node_of = np.full(n, -1, np.int64)
    g = Graph()

    # cluster adjacent node pixels into a single node
    for i in range(n):
        if not is_node[i] or node_of[i] >= 0:
            continue
        nid = len(g.nodes)
        stack, members = [i], []
        node_of[i] = nid
        while stack:
            p = stack.pop()
            members.append(p)
            for q in nbrs[p]:
                if is_node[q] and node_of[q] < 0:
                    node_of[q] = nid
                    stack.append(q)
        g.nodes.append(np.array([xs[members].mean(), ys[members].mean()]))

    visited = np.zeros(n, bool)

    def add_edge(u: int, v: int, path: list[int]):
        pts = [g.nodes[u]] + [np.array([xs[p], ys[p]], float) for p in path] + [g.nodes[v]]
        g.edges[len(g.edges)] = Edge(u, v, np.array(pts))

    for i in range(n):
        if not is_node[i]:
            continue
        for q in nbrs[i]:
            if is_node[q] or visited[q]:
                if is_node[q] and node_of[q] != node_of[i] and i < q:
                    add_edge(int(node_of[i]), int(node_of[q]), [])
                continue
            prev, cur, path = i, q, []
            while not is_node[cur]:
                visited[cur] = True
                path.append(cur)
                nxt = [k for k in nbrs[cur] if k != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                if visited[cur] and not is_node[cur]:
                    break
            add_edge(int(node_of[i]), int(node_of[cur]) if is_node[cur] else int(node_of[i]), path)

    # isolated closed loops without any node pixel
    for i in range(n):
        if visited[i] or is_node[i]:
            continue
        nid = len(g.nodes)
        g.nodes.append(np.array([xs[i], ys[i]], float))
        prev, cur, path = -1, i, []
        while not visited[cur]:
            visited[cur] = True
            path.append(cur)
            nxt = [k for k in nbrs[cur] if k != prev and not visited[k]]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
        add_edge(nid, nid, path[1:])
    return g


def prune_spurs(g: Graph, max_len: float, rounds: int = 3) -> None:
    """Remove short dangling branches that skeletonization grows at line ends and corners."""
    for _ in range(rounds):
        deg = g.degree()
        drop = [k for k, e in g.edges.items()
                if e.u != e.v and e.length < max_len
                and ((deg[e.u] == 1 and deg[e.v] >= 3) or (deg[e.v] == 1 and deg[e.u] >= 3))]
        if not drop:
            break
        for k in drop:
            del g.edges[k]
        merge_degree2(g)
    # drop tiny isolated bits
    deg = g.degree()
    for k in [k for k, e in g.edges.items() if deg[e.u] == 1 and deg[e.v] == 1 and e.length < max_len]:
        del g.edges[k]


def merge_degree2(g: Graph) -> None:
    """Join chains of edges through nodes of degree 2 into single edges."""
    changed = True
    while changed:
        changed = False
        inc = g.incident()
        deg = g.degree()
        for nid, ks in inc.items():
            if deg[nid] != 2 or len(ks) != 2:
                continue
            a, b = (g.edges[k] for k in ks)
            pa = a.pts if a.v == nid else a.pts[::-1]
            pb = b.pts if b.u == nid else b.pts[::-1]
            ua = a.u if a.v == nid else a.v
            vb = b.v if b.u == nid else b.u
            del g.edges[ks[0]], g.edges[ks[1]]
            g.edges[max(g.edges, default=-1) + 1] = Edge(ua, vb, np.vstack([pa, pb[1:]]))
            changed = True
            break
