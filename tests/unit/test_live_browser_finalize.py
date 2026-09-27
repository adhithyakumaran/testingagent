"""Automatic live browser teardown after agent run persistence."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from qa_orchestrator.live_browser_finalize import finalize_live_browser_after_agent_run


def test_finalize_marks_session_closed_when_not_keep_open(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    profile = tmp_path / "profiles" / "run-auto-1"
    profile.mkdir(parents=True)
    (profile / "session.json").write_text(
        json.dumps(
            {
                "status": "ACTIVE",
                "keep_open": False,
                "diagnostics": {"browser_close_count": 1},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("QA_RUN_MODE", "LIVE_DEMO")
    monkeypatch.setenv("EA_BASE_URL", "https://uat.example.com/ords/r/tjdcom/ea")
    monkeypatch.setenv("QA_AUTOMATION_DIR", str(tmp_path / "automation"))
    (tmp_path / "automation" / "reports").mkdir(parents=True)

    def fake_run_profile_dir(run_id: str) -> str:
        return str(profile)

    monkeypatch.setattr(
        "qa_orchestrator.live_browser_finalize.run_profile_dir",
        fake_run_profile_dir,
    )

    meta = finalize_live_browser_after_agent_run("run-auto-1", keep_browser_open=False)
    assert meta.get("status") == "CLOSED"
    assert meta.get("finalized_by") == "orchestrator"
    on_disk = json.loads((profile / "session.json").read_text(encoding="utf-8"))
    assert on_disk["status"] == "CLOSED"


def test_finalize_skips_when_keep_open_inspection_mode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    profile = tmp_path / "profiles" / "run-keep-1"
    profile.mkdir(parents=True)
    (profile / "session.json").write_text(
        json.dumps({"status": "ACTIVE", "keep_open": True}),
        encoding="utf-8",
    )
    monkeypatch.setenv("QA_RUN_MODE", "LIVE_DEMO")
    monkeypatch.setenv("QA_KEEP_BROWSER_OPEN", "true")
    monkeypatch.setenv("EA_BASE_URL", "https://uat.example.com/ords/r/tjdcom/ea")
    monkeypatch.setenv("QA_AUTOMATION_DIR", str(tmp_path / "automation"))
    (tmp_path / "automation" / "reports").mkdir(parents=True)

    monkeypatch.setattr(
        "qa_orchestrator.live_browser_finalize.run_profile_dir",
        lambda run_id: str(profile),
    )

    meta = finalize_live_browser_after_agent_run("run-keep-1")
    assert meta.get("status") == "ACTIVE"
