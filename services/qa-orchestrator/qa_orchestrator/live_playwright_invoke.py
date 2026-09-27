"""LIVE / LIVE_DEMO Playwright invocation — single process, safe selection, profile checks."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from qa_orchestrator.live_browser_close import read_session_meta
from qa_orchestrator.suite_commands import _normalize_flow_id

_FLOW_CMD = re.compile(
    r"^npm run test:flow:(positive|negative)\s+--\s+(?P<flow>BF-[A-Z0-9-]+)\s*$"
)
_SANITY_POS = "npm run test:sanity:positive"
_SANITY = "npm run test:sanity"
_REGRESSION = "npm run test:regression"


@dataclass(frozen=True)
class LiveFlowSelection:
    flow_id: str
    polarity: str


def parse_flow_command(cmd: str) -> LiveFlowSelection | None:
    m = _FLOW_CMD.match(cmd.strip())
    if not m:
        return None
    polarity = m.group(1)
    flow_id = _normalize_flow_id(m.group("flow"))
    return LiveFlowSelection(flow_id=flow_id, polarity=polarity)


def commands_are_collapsible_flow_runs(commands: list[str]) -> bool:
    if not commands:
        return False
    return all(parse_flow_command(c) is not None for c in commands)


def should_collapse_live_commands(*, is_live: bool, keep_open: bool, commands: list[str]) -> bool:
    """One Playwright process for all flow commands in a live run (single browser session).

    ``keep_open`` controls post-run browser teardown only — not whether commands are collapsed.
    """
    if not is_live:
        return False
    if len(commands) <= 1:
        return False
    return commands_are_collapsible_flow_runs(commands)


def build_live_selection_payload(
    *,
    run_id: str,
    commands: list[str],
    execution_mode: str,
    flow_ids: list[str],
    params: dict[str, Any],
) -> dict[str, Any]:
    flows: list[dict[str, str]] = []
    for cmd in commands:
        parsed = parse_flow_command(cmd)
        if not parsed:
            continue
        flows.append({"flow_id": parsed.flow_id, "polarity": parsed.polarity})
    return {
        "schema": "live-playwright-selection-v1",
        "run_id": run_id,
        "execution_mode": execution_mode,
        "flow_ids": list(flow_ids),
        "params_keys": sorted(params.keys()),
        "flows": flows,
        "grep_exclude_tags": ["@param-test"],
        "commands_count": len(commands),
    }


def write_live_selection_file(automation_dir: Path, run_id: str, payload: dict[str, Any]) -> Path:
    out_dir = automation_dir / "reports" / "live-selections"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{run_id}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def live_playwright_script_argv(automation_dir: Path, selection_path: Path) -> list[str]:
    script = (automation_dir / "scripts" / "run-live-playwright.mjs").resolve()
    return ["node", str(script), "--selection", str(selection_path)]


def assess_live_profile_before_launch(profile_dir: Path, run_id: str) -> tuple[str | None, dict[str, Any]]:
    """
    Detect an active persistent browser on this profile path.
    Returns (error_message, hints) — error blocks a fresh launchPersistentContext.
    """
    meta = read_session_meta(profile_dir)
    port_file = profile_dir / "DevToolsActivePort"
    hints: dict[str, Any] = {"profile_dir": str(profile_dir)}
    if not meta and not port_file.exists():
        return None, hints

    status = str(meta.get("status") or "")
    meta_run = str(meta.get("run_id") or "")
    keep_open = bool(meta.get("keep_open"))

    if port_file.exists() and status in {"ACTIVE", "STARTING"} and keep_open:
        if meta_run and meta_run != run_id:
            return (
                "LIVE_BROWSER_STALE: An active browser is bound to this profile for another run. "
                "Use Close Browser before starting a new LIVE_DEMO session.",
                {**hints, "stale_run_id": meta_run},
            )
        hints["reuse_strategy"] = "cdp_attach"
        hints["existing_run_id"] = meta_run or run_id
        return None, hints

    if status == "ACTIVE" and keep_open and meta_run and meta_run != run_id:
        return (
            "LIVE_BROWSER_STALE: Profile session metadata indicates another active run. "
            "Use Close Browser before launching a new session.",
            {**hints, "stale_run_id": meta_run},
        )
    return None, hints


def parse_running_test_count(stdout: str) -> int | None:
    m = re.search(r"Running\s+(\d+)\s+tests?", stdout or "")
    if m:
        return int(m.group(1))
    return None


def empty_live_diagnostics(*, run_id: str, commands_count: int) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "playwright_process_count": 0,
        "browser_launch_count": 0,
        "context_launch_count": 0,
        "login_count": 0,
        "page_count": 0,
        "browser_close_count": 0,
        "selected_test_count": 0,
        "commands_count": commands_count,
    }


def merge_session_diagnostics(profile_dir: Path, base: dict[str, Any]) -> dict[str, Any]:
    meta = read_session_meta(profile_dir)
    diag = meta.get("diagnostics")
    if isinstance(diag, dict):
        for key in (
            "browser_launch_count",
            "context_launch_count",
            "login_count",
            "context_attach_count",
            "page_count",
            "browser_close_count",
        ):
            if key in diag:
                base[key] = diag[key]
    return base
