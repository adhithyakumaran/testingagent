"""Isolated Playwright retry with temporary locator override."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from qa_orchestrator.models import HealingLocatorCandidate
from qa_orchestrator.playwright_runner import PlaywrightRunner, resolve_automation_dir


def run_isolated_retry(
    *,
    automation_dir: Path,
    test_grep: str,
    candidate: HealingLocatorCandidate,
    locator_label: str,
    run_id: str | None = None,
    flow_id: str | None = None,
    timing_wait_ms: int | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    if dry_run:
        return {"ok": True, "dry_run": True, "message": "isolated retry simulated"}

    override: dict[str, list[str]] = {}
    if candidate.css_selectors:
        override[locator_label or "element"] = candidate.css_selectors
    elif candidate.primary:
        css = candidate.css_selectors[0] if candidate.css_selectors else candidate.primary
        override[locator_label or "element"] = [css]

    env = os.environ.copy()
    env["QA_HEALING_LOCATOR_OVERRIDE"] = json.dumps(override)
    env["EA_SKIP_GLOBAL_SETUP"] = "true"
    if run_id:
        env["QA_RUN_ID"] = run_id
    if flow_id:
        env["QA_FLOW_ID"] = flow_id
    try:
        from qa_orchestrator.live_browser_config import apply_live_browser_env, load_live_browser_config

        live_cfg = load_live_browser_config()
        if live_cfg.is_live and run_id:
            env = apply_live_browser_env(live_cfg, env, run_id=run_id)
            env["EA_SKIP_GLOBAL_SETUP"] = "true"
    except ImportError:
        pass
    if timing_wait_ms:
        env["QA_HEALING_TIMING_MS"] = str(timing_wait_ms)

    cmd = ["npx", "playwright", "test", "--grep", test_grep, "--workers=1"]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(automation_dir),
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "message": "isolated retry timeout"}
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-2000:],
        "stderr_tail": (proc.stderr or "")[-2000:],
        "override": override,
    }


def simulate_retry_success(candidate: HealingLocatorCandidate) -> bool:
    return candidate.validated and candidate.confidence >= 0.90
