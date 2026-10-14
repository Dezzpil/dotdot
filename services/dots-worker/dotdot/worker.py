"""BullMQ consumer: python -m dotdot.worker

Job data (written by the API):
    {"id": "<job id>", "input": "<id>/input.png", "options": {...}}
Return value (read by the API):
    {"files": {"pdf": "<id>/dotdot.pdf", "puzzle": "<id>/puzzle.png", "answer": "<id>/answer.png"},
     "stats": {...}}
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

import cv2
from bullmq import UnrecoverableError, Worker

from .pipeline import BadOptionsError, Options, generate
from .preprocess import BadImageError

log = logging.getLogger("dotdot.worker")

QUEUE = os.environ.get("QUEUE_NAME", "dots")
PREFIX = os.environ.get("QUEUE_PREFIX", "dotdot")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
STORAGE_DIR = pathlib.Path(os.environ.get("STORAGE_DIR", "/data"))
CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "1"))
JOB_TIMEOUT = float(os.environ.get("JOB_TIMEOUT_SEC", "60"))


def _safe_path(rel: str) -> pathlib.Path:
    p = (STORAGE_DIR / rel).resolve()
    if STORAGE_DIR.resolve() not in p.parents:
        raise UnrecoverableError("BAD_INPUT: path outside storage")
    return p


def _write(path: pathlib.Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)  # atomic: the API never sees half-written files


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
    await job.updateProgress(10)
    raw = await asyncio.to_thread(src.read_bytes)
    try:
        res = await asyncio.wait_for(asyncio.to_thread(generate, raw, opts), JOB_TIMEOUT)
    except BadImageError as e:
        raise UnrecoverableError(f"BAD_IMAGE: {e}")
    except asyncio.TimeoutError:
        raise UnrecoverableError("TIMEOUT: drawing is too complex")
    await job.updateProgress(90)
    out = _safe_path(job_id)
    out.mkdir(parents=True, exist_ok=True)
    files = {"pdf": "dotdot.pdf", "puzzle": "puzzle.png", "answer": "answer.png"}
    blobs = {"pdf": res.pdf, "puzzle": res.preview_puzzle, "answer": res.preview_answer}
    for k, name in files.items():
        await asyncio.to_thread(_write, out / name, blobs[k])
    await job.updateProgress(100)
    log.info("job %s done in %.0f ms: %s dots", job_id, (time.perf_counter() - t0) * 1000, res.stats["dots"])
    return {"files": {k: f"{job_id}/{v}" for k, v in files.items()}, "stats": res.stats}


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cv2.setNumThreads(1)  # one job = one core; scale with replicas, not threads
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    worker = Worker(QUEUE, process, {
        "connection": REDIS_URL,
        "prefix": PREFIX,
        "concurrency": CONCURRENCY,
        "lockDuration": 30000,
        "name": os.environ.get("HOSTNAME", "worker"),
    })
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
