# ==============================================================
# SpriteForge Backend — jobs.py
# In-memory job store with single ThreadPoolExecutor worker
# US-16 / Architecture ADR-07 / US-25 SSE Streaming
# ==============================================================
from __future__ import annotations

import datetime
import logging
import queue
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)

STAGE_PROGRESS: dict[str, tuple[int, float]] = {
    "queued": (5, 10.0),
    "generating": (30, 6.0),
    "removing_background": (65, 3.0),
    "processing": (80, 1.5),
    "exporting": (95, 0.5),
    "done": (100, 0.0),
}


@dataclass
class Job:
    job_id: str
    status: str = "queued"           # queued | running | done | failed
    stage: str = "queued"
    progress: int = 5
    estimated_remaining_seconds: float = 10.0
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    duration_ms: int | None = None
    metadata: dict[str, Any] | None = None
    preview_url: str | None = None
    error: dict[str, str] | None = None

    def to_dict(self) -> dict[str, Any]:
        created_str = datetime.datetime.fromtimestamp(
            self.created_at, tz=datetime.timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        d: dict[str, Any] = {
            "job_id": self.job_id,
            "status": self.status,
            "stage": self.stage,
            "progress": self.progress,
            "eta_seconds": self.estimated_remaining_seconds,
            "estimated_remaining_seconds": self.estimated_remaining_seconds,
            "created_at": created_str,
        }
        if self.status == "done":
            d["duration_ms"] = self.duration_ms
            d["metadata"] = self.metadata
            d["preview_url"] = self.preview_url
        elif self.status == "failed":
            d["error"] = self.error
        return d


class JobStore:
    """Thread-safe in-memory job registry with SSE pub/sub and TTL cleanup."""

    def __init__(
        self,
        workers: int = 1,
        max_queued: int = 5,
        ttl_minutes: int = 60,
    ) -> None:
        self._jobs: dict[str, Job] = {}
        self._listeners: dict[str, set[queue.Queue]] = {}
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
            p, eta = STAGE_PROGRESS.get("queued", (5, 10.0))
            self._jobs[job_id] = Job(
                job_id=job_id,
                status="queued",
                stage="queued",
                progress=p,
                estimated_remaining_seconds=eta,
            )

        self._executor.submit(self._run, job_id, task)
        return job_id

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def subscribe(self, job_id: str) -> queue.Queue | None:
        """Register an SSE listener for job events. Returns a Queue or None if job not found."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            q: queue.Queue = queue.Queue(maxsize=100)
            # Seed queue with current state snapshot
            q.put(job.to_dict())
            if job.status not in ("done", "failed"):
                self._listeners.setdefault(job_id, set()).add(q)
            return q

    def unsubscribe(self, job_id: str, q: queue.Queue) -> None:
        """Unregister an SSE listener queue to prevent memory leaks (AC 25.5)."""
        with self._lock:
            listeners = self._listeners.get(job_id)
            if listeners:
                listeners.discard(q)
                if not listeners:
                    self._listeners.pop(job_id, None)

    def _broadcast(self, job: Job) -> None:
        """Broadcast updated job state to all active subscriber queues."""
        listeners = self._listeners.get(job.job_id)
        if listeners:
            event_data = job.to_dict()
            for q in list(listeners):
                try:
                    q.put_nowait(event_data)
                except queue.Full:
                    pass
            if job.status in ("done", "failed"):
                self._listeners.pop(job.job_id, None)

    def update_stage(
        self,
        job_id: str,
        stage: str,
        progress: int | None = None,
        eta_seconds: float | None = None,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "running"
                job.stage = stage
                default_p, default_eta = STAGE_PROGRESS.get(
                    stage, (job.progress, job.estimated_remaining_seconds)
                )
                job.progress = progress if progress is not None else default_p
                job.estimated_remaining_seconds = (
                    eta_seconds if eta_seconds is not None else default_eta
                )
                self._broadcast(job)

    def complete(self, job_id: str, metadata: dict, preview_url: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "done"
                job.stage = "done"
                job.progress = 100
                job.estimated_remaining_seconds = 0.0
                job.metadata = metadata
                job.preview_url = preview_url
                job.finished_at = time.time()
                job.duration_ms = int((job.finished_at - job.created_at) * 1000)
                self._broadcast(job)

    def fail(self, job_id: str, stage: str, code: str, message: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "failed"
                job.stage = stage
                job.error = {"code": code, "message": message}
                job.finished_at = time.time()
                job.estimated_remaining_seconds = 0.0
                self._broadcast(job)

    def queued_count(self) -> int:
        with self._lock:
            return sum(
                1 for j in self._jobs.values() if j.status in ("queued", "running")
            )

    def shutdown(self) -> None:
        self._stop_event.set()
        self._executor.shutdown(wait=False)
        with self._lock:
            self._listeners.clear()

    # ── private ───────────────────────────────────────────────

    def _run(self, job_id: str, task: Callable[[str], None]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = "running"
                self._broadcast(job)
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
                    self._listeners.pop(jid, None)
            if expired:
                log.debug("TTL cleanup: removed %d expired jobs", len(expired))
