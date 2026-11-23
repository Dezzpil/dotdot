"""BullMQ consumer: python -m dotdot.worker

Job data (written by the API):
    {"id": "<job id>", "input": "<id>/input.png", "options": {...}}                     # new drawing
    {"id": "<job id>", "kind": "edit", "input": "<id>/edit.json", "options": {...}}     # edited dots
Analyze jobs (kind "analyze") write <id>/scene.json and enqueue the dot-count variants
themselves; variant jobs (kind "variant") read the scene and render without image analysis.
Return value (read by the API):
    {"files": {"pdf": "<id>/dotdot.pdf", "puzzle": "<id>/puzzle.png", "answer": "<id>/answer.png",
               "plan": "<id>/plan.json"},
     "stats": {...}}
Analyze jobs return {"files": {"scene": ...}, "stats": {...}, "variants": [{"id", "target"}]}.
Errors are raised as "CODE: message" so the API can show a friendly text.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import pathlib
import signal
import time
import uuid
from dataclasses import asdict

import cv2
from bullmq import Queue, UnrecoverableError, Worker

from .pipeline import (BadOptionsError, Options, analyze, default_target, generate, ladder_targets,
                       render_edited, render_scene)
from .plan_io import BadPlanError
from .preprocess import BadImageError
from .scene import BadSceneError, scene_from_json, scene_to_json

log = logging.getLogger("dotdot.worker")

QUEUE = os.environ.get("QUEUE_NAME", "dots")
PREFIX = os.environ.get("QUEUE_PREFIX", "dotdot")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
STORAGE_DIR = pathlib.Path(os.environ.get("STORAGE_DIR", "/data"))
CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "1"))
JOB_TIMEOUT = float(os.environ.get("JOB_TIMEOUT_SEC", "60"))
JOB_ATTEMPTS = int(os.environ.get("JOB_ATTEMPTS", "2"))
RESULT_TTL = int(os.environ.get("RESULT_TTL_SEC", str(24 * 3600)))


def redis_url(url: str) -> str:
    """Give the socket more time than BullMQ's blocking wait for new jobs.

    redis-py 8 defaults to socket_timeout=5 s, exactly BullMQ's 5 s BZPOPMIN wait: the client
    drops the connection right when Redis answers "nothing yet", then reconnects with backoff.
    New jobs waited up to ~10 s and a running job could stall on its next Redis call.
    """
    if "socket_timeout=" in url:
        return url
    return url + ("&" if "?" in url else "?") + "socket_timeout=30"


def _safe_path(rel: str) -> pathlib.Path:
    p = (STORAGE_DIR / rel).resolve()
    if STORAGE_DIR.resolve() not in p.parents:
        raise UnrecoverableError("BAD_INPUT: path outside storage")
    return p


def _write(path: pathlib.Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)  # atomic: the API never sees half-written files


async def enqueue_variants(set_id: str, data: dict, opts: Options, targets: list[int]) -> list[dict]:
    """The analyze job owns its variants: one analysis, no duplicate work per dot count."""
    queue = Queue(QUEUE, {"connection": redis_url(REDIS_URL), "prefix": PREFIX})
    variants = []
    try:
        for target in targets:
            vid = str(uuid.uuid4())
            await queue.add("variant", {
                "id": vid, "kind": "variant", "input": f"{set_id}/scene.json",
                "source": data.get("source") or data["input"], "parent": set_id,
                "options": {**asdict(opts), "target": target},
            }, {"jobId": vid, "attempts": JOB_ATTEMPTS,
                "backoff": {"type": "exponential", "delay": 2000},
                "removeOnComplete": {"age": RESULT_TTL}, "removeOnFail": {"age": RESULT_TTL}})
            variants.append({"id": vid, "target": target})
    finally:
        await queue.close()
    return variants


async def process(job, token):
    t0 = time.perf_counter()
    data = job.data if isinstance(job.data, dict) else json.loads(job.data)
    job_id = data["id"]
    src = _safe_path(data["input"])
    if not src.exists():
        raise UnrecoverableError("INPUT_MISSING: uploaded file not found")
    try:
        opts = Options.from_dict(data.get("options", {}))
        opts.validate()
    except (BadOptionsError, TypeError) as e:
        raise UnrecoverableError(f"BAD_OPTIONS: {e}")
    kind = data.get("kind")
    log.debug("job %s: start (%s)", job_id, kind or "generate")
    await job.updateProgress(10)
    log.debug("job %s: progress 10 saved", job_id)
    raw = await asyncio.to_thread(src.read_bytes)
    try:
        if kind == "analyze":
            res = await asyncio.wait_for(asyncio.to_thread(analyze, raw, opts), JOB_TIMEOUT)
        elif kind == "variant":
            scene = await asyncio.to_thread(scene_from_json, raw)
            run = lambda: render_scene(scene, opts, opts.target or default_target(opts))  # noqa: E731
            res = await asyncio.wait_for(asyncio.to_thread(run), JOB_TIMEOUT)
        else:
            run = render_edited if kind == "edit" else generate
            res = await asyncio.wait_for(asyncio.to_thread(run, raw, opts), JOB_TIMEOUT)
    except BadImageError as e:
        raise UnrecoverableError(f"BAD_IMAGE: {e}")
    except BadPlanError as e:
        raise UnrecoverableError(f"BAD_PLAN: {e}")
    except BadSceneError as e:
        raise UnrecoverableError(f"BAD_SCENE: {e}")
    except asyncio.TimeoutError:
        raise UnrecoverableError("TIMEOUT: drawing is too complex")
    log.debug("job %s: generated", job_id)
    await job.updateProgress(90)
    log.debug("job %s: progress 90 saved", job_id)
    out = _safe_path(job_id)
    out.mkdir(parents=True, exist_ok=True)
    if kind == "analyze":
        await asyncio.to_thread(_write, out / "scene.json", scene_to_json(res))
        targets = ladder_targets(res, opts)
        variants = await enqueue_variants(job_id, data, opts, targets)
        await job.updateProgress(100)
        log.info("job %s analyzed in %.0f ms: %d contours, dots %d..%d, %d variants",
                 job_id, (time.perf_counter() - t0) * 1000, len(res.colors),
                 res.dots_min, res.dots_max, len(variants))
        return {"files": {"scene": f"{job_id}/scene.json"},
                "stats": {"contours": len(res.colors), "dots_min": res.dots_min, "dots_max": res.dots_max,
                          "targets": targets, "ms": round((time.perf_counter() - t0) * 1000),
                          "strategy": res.extra.get("strategy"), "features": res.extra.get("features"),
                          "options": asdict(opts)},
                "variants": variants}
    files = {"pdf": "dotdot.pdf", "puzzle": "puzzle.png", "answer": "answer.png", "plan": "plan.json"}
    blobs = {"pdf": res.pdf, "puzzle": res.preview_puzzle, "answer": res.preview_answer, "plan": res.plan}
    for k, name in files.items():
        await asyncio.to_thread(_write, out / name, blobs[k])
    await job.updateProgress(100)
    log.info("job %s done in %.0f ms: %s dots", job_id, (time.perf_counter() - t0) * 1000, res.stats["dots"])
    return {"files": {k: f"{job_id}/{v}" for k, v in files.items()}, "stats": res.stats}


def on_failed(job, err):
    """BullMQ stays silent about failures: without this a broken job just never shows in the log."""
    log.error("job %s (%s) failed on attempt %s/%s: %s: %s",
              job.id, job.name, job.attemptsMade, job.attempts, type(err).__name__, err)


def on_error(err, job=None):
    """Errors of the fetch loop itself: the worker keeps running, so log them loudly."""
    log.error("worker error%s: %s: %s", f" in job {job.id}" if job is not None else "", type(err).__name__, err)


def on_stalled(job_id):
    log.warning("job %s lost its lock (worker restarted while running it?): it goes back to the queue", job_id)


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cv2.setNumThreads(1)  # one job = one core; scale with replicas, not threads
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    worker = Worker(QUEUE, process, {
        "connection": redis_url(REDIS_URL),
        "prefix": PREFIX,
        "concurrency": CONCURRENCY,
        "lockDuration": 30000,
        "name": os.environ.get("HOSTNAME", "worker"),
    })
    worker.on("failed", on_failed)
    worker.on("error", on_error)
    worker.on("stalled", on_stalled)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    log.info("worker started: queue=%s prefix=%s concurrency=%s", QUEUE, PREFIX, CONCURRENCY)
    await stop.wait()
    log.info("shutting down: finishing the current job")
    await worker.close()


if __name__ == "__main__":
    asyncio.run(main())
