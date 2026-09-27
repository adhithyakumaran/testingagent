"""Async warm run registry — accept, persist, idempotent recovery."""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from qa_orchestrator.warm_run_registry import WarmRunRegistry


def test_accept_returns_immediately_and_persists_result(tmp_path: Path) -> None:
    registry = WarmRunRegistry(journal_dir=tmp_path)
    run_id = "run_test_accept"
    started = threading.Event()
    release = threading.Event()

    def worker() -> dict:
        started.set()
        release.wait(timeout=5)
        return {"conclusion": "PASS", "local": {"execution": {"observations": []}}}

    token, job = registry.accept(run_id, worker)
    assert token == "started"
    assert job.status == "running"
    assert started.wait(timeout=2)

    pending = registry.get_job(run_id)
    assert pending is not None
    assert pending.status == "running"

    release.set()
    deadline = time.time() + 5
    while time.time() < deadline:
        done = registry.get_job(run_id)
        if done and done.status == "completed":
            break
        time.sleep(0.05)
    else:
        pytest.fail("job did not complete")

    assert done.payload is not None
    assert done.payload["conclusion"] == "PASS"
    disk = registry._load_disk_result(run_id)
    assert disk is not None
    assert disk["local"]["execution"] == {"observations": []}


def test_duplicate_accept_does_not_start_second_worker(tmp_path: Path) -> None:
    registry = WarmRunRegistry(journal_dir=tmp_path)
    run_id = "run_dup"
    barrier = threading.Barrier(2, timeout=3)

    def worker() -> dict:
        barrier.wait(timeout=3)
        return {"conclusion": "PASS", "local": {}}

    registry.accept(run_id, worker)
    registry.accept(run_id, worker)
    assert registry.start_count(run_id) == 1
