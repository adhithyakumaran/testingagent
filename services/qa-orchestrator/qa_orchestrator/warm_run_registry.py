"""Track async warm-server runs and persist orchestrator payloads for client recovery."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal
from uuid import uuid4

from qa_orchestrator.fs_atomic import atomic_write_json

RunJobStatus = Literal["running", "completed", "failed"]


@dataclass
class WarmRunJob:
    run_id: str
    status: RunJobStatus = "running"
    payload: dict[str, Any] | None = None
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None


def orchestrator_result_path(base_dir: str | Path, run_id: str) -> Path:
    return Path(base_dir) / run_id / "orchestrator_result.json"


class WarmRunRegistry:
    def __init__(self, *, journal_dir: str | Path = "reports/agent") -> None:
        self.journal_dir = Path(journal_dir)
        self._jobs: dict[str, WarmRunJob] = {}
        self._lock = threading.Lock()
        self._start_counts: dict[str, int] = {}

    def ensure_run_id(self, run_id: str | None) -> str:
        return run_id or f"agent-{uuid4().hex[:12]}"

    def start_count(self, run_id: str) -> int:
        with self._lock:
            return self._start_counts.get(run_id, 0)

    def accept(
        self,
        run_id: str,
        worker: Callable[[], dict[str, Any]],
        *,
        on_error: Callable[[Exception], str] | None = None,
    ) -> tuple[str, WarmRunJob]:
        """Register run_id and start worker at most once. Returns (status_token, job)."""
        with self._lock:
            existing = self._jobs.get(run_id)
            if existing:
                return "existing", existing
            disk = self._load_disk_result(run_id)
            if disk is not None:
                job = WarmRunJob(
                    run_id=run_id,
                    status="completed",
                    payload=disk,
                    finished_at=time.time(),
                )
                self._jobs[run_id] = job
                return "existing", job
            job = WarmRunJob(run_id=run_id, status="running")
            self._jobs[run_id] = job
            self._start_counts[run_id] = self._start_counts.get(run_id, 0) + 1

        def _run() -> None:
            try:
                payload = worker()
                self._finish(run_id, payload=payload)
            except Exception as exc:  # noqa: BLE001
                message = on_error(exc) if on_error else f"{type(exc).__name__}:{exc}"
                self._finish(run_id, error=message)

        threading.Thread(target=_run, name=f"warm-run-{run_id}", daemon=True).start()
        return "started", job

    def get_job(self, run_id: str) -> WarmRunJob | None:
        with self._lock:
            job = self._jobs.get(run_id)
            if job:
                return job
        disk = self._load_disk_result(run_id)
        if disk is None:
            return None
        job = WarmRunJob(
            run_id=run_id,
            status="completed",
            payload=disk,
            finished_at=time.time(),
        )
        with self._lock:
            self._jobs[run_id] = job
        return job

    def _finish(self, run_id: str, *, payload: dict[str, Any] | None = None, error: str | None = None) -> None:
        with self._lock:
            job = self._jobs.get(run_id)
            if job is None:
                job = WarmRunJob(run_id=run_id)
                self._jobs[run_id] = job
            job.finished_at = time.time()
            if error:
                job.status = "failed"
                job.error = error
            else:
                job.status = "completed"
                job.payload = payload
        if payload is not None:
            path = orchestrator_result_path(self.journal_dir, run_id)
            atomic_write_json(
                path,
                {
                    "run_id": run_id,
                    "status": "completed",
                    "result": payload,
                    "finished_at": job.finished_at,
                },
            )

    def _load_disk_result(self, run_id: str) -> dict[str, Any] | None:
        path = orchestrator_result_path(self.journal_dir, run_id)
        if not path.exists():
            return None
        try:
            import json

            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        result = data.get("result")
        return result if isinstance(result, dict) else None
