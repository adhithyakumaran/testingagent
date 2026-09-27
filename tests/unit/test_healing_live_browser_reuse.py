"""Healing retries must inherit live browser profile (CDP reuse), not spawn a fresh browser."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from qa_orchestrator.healing_runner import run_isolated_retry
from qa_orchestrator.models import HealingLocatorCandidate


def test_isolated_retry_applies_live_profile_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    captured: dict[str, str] = {}

    def fake_run(cmd, **kwargs):  # noqa: ANN001
        captured.update(kwargs.get("env") or {})
        class _Proc:
            returncode = 0
            stdout = ""
            stderr = ""

        return _Proc()

    monkeypatch.setenv("QA_RUN_MODE", "LIVE_DEMO")
    monkeypatch.setenv("EA_BASE_URL", "https://uat.example.com/ords/r/tjdcom/ea")
    monkeypatch.setattr("subprocess.run", fake_run)

    automation = tmp_path / "automation"
    automation.mkdir()
    (automation / "node_modules").mkdir()

    candidate = HealingLocatorCandidate(
        primary="#x",
        css_selectors=["#x"],
        confidence=0.95,
        validated=True,
        source="test",
    )
    run_isolated_retry(
        automation_dir=automation,
        test_grep="@BF-PRODUCT-003",
        candidate=candidate,
        locator_label="sku",
        run_id="run-heal-1",
        flow_id="BF-PRODUCT-003",
    )
    assert captured.get("QA_LIVE_BROWSER") == "true"
    assert captured.get("QA_RUN_ID") == "run-heal-1"
    assert "QA_LIVE_PROFILE_DIR" in captured
    assert "run-heal-1" in captured["QA_LIVE_PROFILE_DIR"]
