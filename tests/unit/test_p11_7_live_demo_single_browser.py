"""P11.7 — LIVE_DEMO single browser / single Playwright process lifecycle."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from qa_orchestrator.live_playwright_invoke import (
    assess_live_profile_before_launch,
    build_live_selection_payload,
    commands_are_collapsible_flow_runs,
    parse_flow_command,
    parse_running_test_count,
    should_collapse_live_commands,
)
from qa_orchestrator.playwright_runner import PlaywrightRunner, classify_playwright_output
from qa_orchestrator.suite_commands import build_flow_command, build_positive_flow_commands

REPO = Path(__file__).resolve().parents[2]
AUTOMATION = REPO / "apps" / "automation"
RUN_FLOW = AUTOMATION / "scripts" / "run-flow.mjs"
RUN_FLOW_GREP = AUTOMATION / "scripts" / "run-flow-grep.mjs"
RUN_LIVE = AUTOMATION / "scripts" / "run-live-playwright.mjs"


def test_sku_positive_grep_excludes_param_harness():
    text = RUN_FLOW_GREP.read_text(encoding="utf-8")
    assert "@param-test" in text
    assert "excludeParamHarness" in text or "(?!.*@param-test)" in text or "EXCLUDE_PARAM_HARNESS" in text


def test_parse_flow_command():
    sel = parse_flow_command("npm run test:flow:positive -- BF-PRODUCT-003")
    assert sel is not None
    assert sel.flow_id == "BF-PRODUCT-003"
    assert sel.polarity == "positive"


def test_should_collapse_multi_flow_live_commands():
    cmds = build_positive_flow_commands(["BF-HOME-010-01", "BF-PRODUCT-004"])
    assert commands_are_collapsible_flow_runs(cmds)
    assert should_collapse_live_commands(is_live=True, keep_open=True, commands=cmds)


def test_should_collapse_multi_flow_live_without_keep_open():
    cmds = build_positive_flow_commands(["BF-PRODUCT-003", "BF-PRODUCT-004"])
    assert should_collapse_live_commands(is_live=True, keep_open=False, commands=cmds)


def test_single_sku_command_not_collapsed_but_one_process():
    cmd = build_flow_command("BF-PRODUCT-003", polarity="positive")
    assert not should_collapse_live_commands(is_live=True, keep_open=True, commands=[cmd])


def test_live_selection_payload_schema():
    payload = build_live_selection_payload(
        run_id="run_test",
        commands=[build_flow_command("BF-PRODUCT-003")],
        execution_mode="adhoc_parameterized",
        flow_ids=["BF-PRODUCT-003"],
        params={"sku": "552811DUDABA00"},
    )
    assert payload["schema"] == "live-playwright-selection-v1"
    assert payload["grep_exclude_tags"] == ["@param-test"]
    assert payload["commands_count"] == 1


def test_parse_running_test_count():
    assert parse_running_test_count("Running 1 test using 1 worker\n") == 1
    assert parse_running_test_count("Running 2 tests using 1 worker\n") == 2


def test_stale_profile_blocks_mismatched_run(tmp_path: Path):
    profile = tmp_path / "profile"
    profile.mkdir(parents=True, exist_ok=True)
    (profile / "DevToolsActivePort").write_text("9222\n", encoding="utf-8")
    (profile / "session.json").write_text(
        json.dumps({"status": "ACTIVE", "keep_open": True, "run_id": "run_old"}),
        encoding="utf-8",
    )
    err, _ = assess_live_profile_before_launch(profile, "run_new")
    assert err is not None
    assert "LIVE_BROWSER_STALE" in err


def test_same_run_profile_allows_cdp_reuse_hint(tmp_path: Path):
    profile = tmp_path / "profile-reuse"
    profile.mkdir(parents=True, exist_ok=True)
    (profile / "DevToolsActivePort").write_text("9222\n", encoding="utf-8")
    (profile / "session.json").write_text(
        json.dumps({"status": "ACTIVE", "keep_open": True, "run_id": "run_same"}),
        encoding="utf-8",
    )
    err, hints = assess_live_profile_before_launch(profile, "run_same")
    assert err is None
    assert hints.get("reuse_strategy") == "cdp_attach"


def test_classify_setup_timeout_vs_teardown():
    setup_out = 'Fixture "liveContext" timeout of 30000ms exceeded during setup.\n'
    status, warnings = classify_playwright_output("", setup_out, 1)
    assert status in {"FAIL", "UNKNOWN"}
    assert "live_context_fixture_setup_timeout" in warnings
    assert "live_context_fixture_teardown_timeout" not in warnings

    teardown_out = 'Fixture "liveContext" timeout of 120000ms exceeded during teardown.\n'
    status2, warnings2 = classify_playwright_output("1 passed\n", teardown_out, 1)
    assert "live_context_fixture_teardown_timeout" in warnings2
    assert "live_context_fixture_setup_timeout" not in warnings2


def test_classify_pass_without_teardown_timeout():
    stdout = "Running 1 test using 1 worker\n  1 passed (10s)\n"
    status, warnings = classify_playwright_output(stdout, "", 0)
    assert status == "PASS"
    assert "live_context_fixture_teardown_timeout" not in warnings


def test_run_live_playwright_script_exists():
    assert RUN_LIVE.exists()


def test_dry_run_ci_unchanged_multi_command():
    from qa_orchestrator.models import SuiteSelectionPlan
    from qa_orchestrator.playwright_runner import PlaywrightRunnerConfig

    runner = PlaywrightRunner(PlaywrightRunnerConfig(dry_run=True))
    cmds = build_positive_flow_commands(["BF-A", "BF-B"])  # noqa: invalid ids — use real
    cmds = [
        "npm run test:flow:positive -- BF-PRODUCT-003",
        "npm run test:flow:positive -- BF-PRODUCT-004",
    ]
    result = runner.run_selection(
        SuiteSelectionPlan(commands=cmds, flow_ids=["BF-PRODUCT-003", "BF-PRODUCT-004"])
    )
    assert result.ok
    assert len(result.observations) == 2


def test_live_diagnostics_expected_shape():
    from qa_orchestrator.live_playwright_invoke import empty_live_diagnostics

    diag = empty_live_diagnostics(run_id="run_x", commands_count=2)
    diag.update(
        {
            "playwright_process_count": 1,
            "browser_launch_count": 1,
            "context_launch_count": 1,
            "login_count": 1,
            "page_count": 1,
            "browser_close_count": 1,
            "selected_test_count": 2,
        }
    )
    for key in (
        "run_id",
        "playwright_process_count",
        "browser_launch_count",
        "context_launch_count",
        "login_count",
        "page_count",
        "browser_close_count",
        "selected_test_count",
        "commands_count",
    ):
        assert key in diag


def test_live_demo_applies_automatic_teardown_env(monkeypatch: pytest.MonkeyPatch):
    from qa_orchestrator.live_browser_config import apply_live_browser_env, load_live_browser_config

    monkeypatch.setenv("QA_RUN_MODE", "LIVE_DEMO")
    monkeypatch.setenv("EA_BASE_URL", "https://uat.example.com/ords/r/tjdcom/ea")
    monkeypatch.delenv("QA_KEEP_BROWSER_OPEN", raising=False)
    cfg = load_live_browser_config()
    env = apply_live_browser_env(cfg, {}, run_id="run-env-1")
    assert env["QA_KEEP_BROWSER_OPEN"] == "false"


def test_live_multi_flow_run_uses_single_collapsed_subprocess(monkeypatch):
    import subprocess

    from qa_orchestrator.models import SuiteSelectionPlan
    from qa_orchestrator.playwright_runner import PlaywrightRunner, PlaywrightRunnerConfig

    calls: list[list[str] | str] = []

    def fake_run(cmd, **kwargs):  # noqa: ANN001
        calls.append(cmd)
        class _Proc:
            returncode = 0
            stdout = "Running 2 tests using 1 worker\n  2 passed\n"
            stderr = ""

        return _Proc()

    monkeypatch.setenv("QA_RUN_MODE", "LIVE_DEMO")
    monkeypatch.setenv("EA_BASE_URL", "https://uat.example.com/ords/r/tjdcom/ea")
    monkeypatch.setenv("QA_RUN_ID", "run-collapse-1")
    monkeypatch.setattr(subprocess, "run", fake_run)

    runner = PlaywrightRunner(
        PlaywrightRunnerConfig(automation_dir=AUTOMATION, dry_run=False),
    )
    runner.set_run_context(run_id="run-collapse-1", flow_ids=["BF-PRODUCT-003", "BF-PRODUCT-004"])
    cmds = [
        "npm run test:flow:positive -- BF-PRODUCT-003",
        "npm run test:flow:positive -- BF-PRODUCT-004",
    ]
    result = runner.run_selection(
        SuiteSelectionPlan(commands=cmds, flow_ids=["BF-PRODUCT-003", "BF-PRODUCT-004"])
    )
    assert result.ok
    assert len(calls) == 1
    argv = calls[0]
    assert isinstance(argv, list)
    assert any("run-live-playwright.mjs" in part for part in argv)
    meta = result.observations[0].meta or {}
    diag = meta.get("live_diagnostics") or {}
    assert diag.get("commands_collapsed") is True
    assert diag.get("playwright_process_count") == 1


def test_failed_flow_does_not_imply_extra_subprocess_when_collapsed(monkeypatch):
    import subprocess

    from qa_orchestrator.models import SuiteSelectionPlan
    from qa_orchestrator.playwright_runner import PlaywrightRunner, PlaywrightRunnerConfig

    calls: list[list[str] | str] = []

    def fake_run(cmd, **kwargs):  # noqa: ANN001
        calls.append(cmd)

        class _Proc:
            returncode = 1
            stdout = "Running 2 tests using 1 worker\n  1 failed\n  1 passed\n"
            stderr = ""

        return _Proc()

    monkeypatch.setenv("QA_RUN_MODE", "LIVE")
    monkeypatch.setenv("QA_KEEP_BROWSER_OPEN", "false")
    monkeypatch.setenv("EA_BASE_URL", "https://uat.example.com/ords/r/tjdcom/ea")
    monkeypatch.setenv("QA_RUN_ID", "run-fail-1")
    monkeypatch.setattr(subprocess, "run", fake_run)

    runner = PlaywrightRunner(PlaywrightRunnerConfig(automation_dir=AUTOMATION, dry_run=False))
    runner.set_run_context(run_id="run-fail-1", flow_ids=["BF-PRODUCT-003", "BF-PRODUCT-004"])
    cmds = [
        "npm run test:flow:positive -- BF-PRODUCT-003",
        "npm run test:flow:positive -- BF-PRODUCT-004",
    ]
    result = runner.run_selection(
        SuiteSelectionPlan(commands=cmds, flow_ids=["BF-PRODUCT-003", "BF-PRODUCT-004"])
    )
    assert not result.ok
    assert len(calls) == 1
