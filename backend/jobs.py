# ==============================================================
# SpriteForge Backend — jobs.py
# In-memory job store with single ThreadPoolExecutor worker
# US-16 / Architecture ADR-07
# ==============================================================
from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)


@dataclass
class Job:
    job_id: str
    status: str = "queued"           # queued | running | done | failed
    stage: str = "queued"
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    duration_ms: int | None = None
    metadata: dict[str, Any] | None = None
    preview_url: str | None = None
    error: dict[str, str] | None = None


class JobStore:
    """Thread-safe in-memory job registry with TTL cleanup."""

    def __init__(
        self,
        workers: int = 1,
        max_queued: int = 5,
        ttl_minutes: int = 60,
    ) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=workers)
        self._max_queued = max_queued
        self._ttl_seconds = ttl_minutes * 60
        # Start background TTL cleanup thread
        self._stop_event = threading.Event()
        self._cleaner = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleaner.start()

    # ── public interface ──────────────────────────────────────

    def enqueue(self, task: Callable[[str], None]) -> str | None:
        """Submit *task(job_id)* for background execution.
        Returns job_id, or None if queue is full (→ 429).
        """
        with self._lock:
            queued = sum(
                1 for j in self._jobs.values() if j.status in ("queued", "running")
            )
            if queued >= self._max_queued:
                return None
            job_id = uuid.uuid4().hex
            self._jobs[job_id] = Job(job_id=job_id)

        self._executor.submit(self._run, job_id, task)
        return job_id

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update_stage(self, job_id: str, stage: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "running"
                job.stage = stage

    def complete(self, job_id: str, metadata: dict, preview_url: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "done"
                job.stage = "done"
                job.metadata = metadata
                job.preview_url = preview_url
                job.finished_at = time.time()
                job.duration_ms = int((job.finished_at - job.created_at) * 1000)

    def fail(self, job_id: str, stage: str, code: str, message: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "failed"
                job.stage = stage
                job.error = {"code": code, "message": message}
                job.finished_at = time.time()

    def queued_count(self) -> int:
        with self._lock:
            return sum(
                1 for j in self._jobs.values() if j.status in ("queued", "running")
            )

    def shutdown(self) -> None:
        self._stop_event.set()
        self._executor.shutdown(wait=False)

    # ── private ───────────────────────────────────────────────

    def _run(self, job_id: str, task: Callable[[str], None]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "running"
        try:
            task(job_id)
        except Exception as exc:  # noqa: BLE001
            log.exception("Unhandled exception in job %s", job_id, extra={"job_id": job_id})
            self.fail(job_id, "unknown", "internal_error", str(exc))

    def _cleanup_loop(self) -> None:
        while not self._stop_event.wait(timeout=60):
            cutoff = time.time() - self._ttl_seconds
            with self._lock:
                expired = [
                    jid
                    for jid, j in self._jobs.items()
                    if j.finished_at and j.finished_at < cutoff
                ]
                for jid in expired:
                    del self._jobs[jid]
            if expired:
                log.debug("TTL cleanup: removed %d expired jobs", len(expired))
