"""Execute approved Playwright suites from the orchestrator."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from qa_orchestrator.models import (
    ExecutionPlan,
    ExecutionResult,
    StepObservation,
    SuiteSelectionPlan,
)
from qa_orchestrator.param_validator import params_to_env, validate_run_params
from qa_orchestrator.suite_commands import build_flow_command, build_sanity_command

try:
    from qa_orchestrator.live_browser_config import (
        apply_live_browser_env,
        load_live_browser_config,
        require_live_environment,
    )
    from qa_orchestrator.live_browser_events import get_event_store
    from qa_orchestrator.live_browser_registry import LiveBrowserSession, LiveBrowserSessionMeta, register_session
    from qa_orchestrator.live_playwright_invoke import (
        assess_live_profile_before_launch,
        build_live_selection_payload,
        empty_live_diagnostics,
        live_playwright_script_argv,
        merge_session_diagnostics,
        parse_running_test_count,
        should_collapse_live_commands,
        write_live_selection_file,
    )
except ImportError:  # pragma: no cover
    load_live_browser_config = None  # type: ignore


def classify_playwright_output(stdout: str, stderr: str, returncode: int) -> tuple[str, list[str]]:
    """Separate Playwright test outcome from infrastructure warnings (e.g. LIVE_DEMO teardown)."""
    combined = (stdout or "") + (stderr or "")
    warnings: list[str] = []
    passed_m = re.search(r"(\d+)\s+passed", combined)
    failed_m = re.search(r"(\d+)\s+failed", combined)
    passed = int(passed_m.group(1)) if passed_m else 0
    failed = int(failed_m.group(1)) if failed_m else 0
    teardown_timeout = "exceeded during teardown" in combined and 'Fixture "liveContext" timeout' in combined
    setup_timeout = "exceeded during setup" in combined and 'Fixture "liveContext" timeout' in combined
    if setup_timeout:
        warnings.append("live_context_fixture_setup_timeout")
    elif teardown_timeout:
        warnings.append("live_context_fixture_teardown_timeout")
    elif 'Fixture "liveContext" timeout' in combined:
        warnings.append("live_context_fixture_timeout")
    if "error was not a part of any test" in combined:
        warnings.append("playwright_out_of_test_error")
    if passed > 0 and failed == 0 and (teardown_timeout or setup_timeout or returncode != 0):
        return "PASS_WITH_WARNING", warnings
    if passed > 0 and failed == 0:
        return "PASS", warnings
    if failed > 0:
        return "FAIL", warnings
    if returncode == 0:
        return "PASS", warnings
    return "UNKNOWN", warnings


_PARAM_TRACE_RE = re.compile(r"^PARAM_TRACE:([a-z_]+)=(.*)$", re.MULTILINE)
_PRODUCT_SEARCH_TRACE_RE = re.compile(r"^PRODUCT_SEARCH_TRACE:([^=\n]+)(?:=(.*))?$", re.MULTILINE)


def parse_param_trace_output(stdout: str, stderr: str) -> dict[str, str]:
    combined = (stdout or "") + (stderr or "")
    trace: dict[str, str] = {}
    for match in _PARAM_TRACE_RE.finditer(combined):
        trace[match.group(1)] = match.group(2).strip()
    for match in _PRODUCT_SEARCH_TRACE_RE.finditer(combined):
        key = match.group(1).strip()
        val = (match.group(2) or "true").strip()
        trace[f"product_search_{key}"] = val
    return trace


def seed_param_trace_from_params(params: dict[str, Any]) -> dict[str, str]:
    try:
        validated = validate_run_params(params)
    except ValueError:
        return {}
    sku = validated.get("sku")
    if not sku:
        return {}
    return {
        "request_sku": sku,
        "validated_sku": sku,
        "suite_parameter": sku,
    }


@dataclass
class PlaywrightRunnerConfig:
    automation_dir: Path = field(default_factory=lambda: Path("automation"))
    suite: str = "sanity"
    flow_id: str | None = None
    timeout_s: float = 3600.0
    dry_run: bool = False


class PlaywrightRunner:
    """Deterministic suite runner — no LLM at execution time."""

    def __init__(self, config: PlaywrightRunnerConfig | None = None) -> None:
        env_dry = os.environ.get("QA_RUNNER", "playwright").lower() in {"dry_run", "dry-run", "mock"}
        self.config = config or PlaywrightRunnerConfig(
            automation_dir=resolve_automation_dir(),
            suite=os.environ.get("QA_SUITE", "sanity"),
            flow_id=os.environ.get("QA_FLOW_ID"),
            dry_run=env_dry,
        )
        self._run_id: str | None = os.environ.get("QA_RUN_ID")
        self._flow_ids: list[str] = []

    def set_run_context(self, *, run_id: str | None = None, flow_ids: list[str] | None = None) -> None:
        if run_id:
            self._run_id = run_id
        if flow_ids:
            self._flow_ids = list(flow_ids)

    @property
    def mode(self) -> str:
        return "playwright_dry_run" if self.config.dry_run else "playwright"

    def run_plan(self, plan: ExecutionPlan) -> ExecutionResult:
        return self.run_suite(suite=self._suite_from_plan(plan), flow_id=self._flow_from_plan(plan))

    def run_selection(self, selection: SuiteSelectionPlan) -> ExecutionResult:
        if self.config.dry_run:
            return self._dry_run(selection)
        live_cfg = load_live_browser_config() if load_live_browser_config else None
        if live_cfg and live_cfg.is_live and os.environ.get("QA_RUNNER", "").lower() in {"dry_run", "dry-run", "mock"}:
            return ExecutionResult(
                ok=False,
                mode="live_browser_blocked",
                error="LIVE mode cannot silently fall back to dry_run",
                observations=[
                    StepObservation(
                        step_index=0,
                        action="live_browser",
                        ok=False,
                        message="LIVE mode cannot silently fall back to dry_run",
                    )
                ],
            )
        if live_cfg and live_cfg.is_live:
            blocked = require_live_environment(live_cfg)
            if blocked:
                return ExecutionResult(
                    ok=False,
                    mode="live_browser_blocked",
                    error=blocked,
                    observations=[
                        StepObservation(
                            step_index=0,
                            action="live_browser",
                            ok=False,
                            message=blocked,
                        )
                    ],
                )
            if self._run_id:
                get_event_store(self._run_id).emit(
                    phase="PLAN",
                    action="LIVE_MODE",
                    value_summary=live_cfg.run_mode,
                    status="OK",
                )
        t0 = time.perf_counter()
        observations: list[StepObservation] = []
        overall_ok = True
        error_parts: list[str] = []
        commands = list(selection.commands or ["npm run test:sanity"])
        live_diagnostics: dict[str, Any] | None = None

        collapse = (
            live_cfg
            and live_cfg.is_live
            and should_collapse_live_commands(
                is_live=True,
                keep_open=live_cfg.keep_browser_open,
                commands=commands,
            )
        )
        if collapse and self._run_id:
            obs, live_diagnostics = self._run_live_collapsed(
                selection,
                commands=commands,
                live_cfg=live_cfg,
                step_index=0,
            )
            observations.append(obs)
            if not obs.ok:
                overall_ok = False
                error_parts.append(obs.message or "live collapsed run failed")
        else:
            process_count = 0
            for i, cmd in enumerate(commands):
                obs = self._run_command(
                    cmd,
                    step_index=i,
                    params=selection.params,
                    flow_ids=selection.flow_ids,
                    live_cfg=live_cfg,
                )
                observations.append(obs)
                if obs.meta and obs.meta.get("playwright_subprocess"):
                    process_count += 1
                if not obs.ok:
                    overall_ok = False
                    error_parts.append(obs.message or f"command failed: {cmd}")
            if live_cfg and live_cfg.is_live and self._run_id:
                live_diagnostics = empty_live_diagnostics(
                    run_id=self._run_id,
                    commands_count=len(commands),
                )
                live_diagnostics["playwright_process_count"] = max(process_count, len(commands) if process_count else 0)
                if observations:
                    last_meta = observations[-1].meta or {}
                    if last_meta.get("live_diagnostics"):
                        live_diagnostics.update(last_meta["live_diagnostics"])

        result = ExecutionResult(
            ok=overall_ok,
            mode=self.mode,
            observations=observations,
            error="; ".join(error_parts) if error_parts else None,
            elapsed_ms=int((time.perf_counter() - t0) * 1000),
        )
        if live_diagnostics and observations:
            first_meta = dict(observations[0].meta or {})
            first_meta["live_diagnostics"] = live_diagnostics
            o0 = observations[0]
            observations[0] = StepObservation(
                step_index=o0.step_index,
                action=o0.action,
                ok=o0.ok,
                message=o0.message,
                screenshot_path=o0.screenshot_path,
                url=o0.url,
                meta=first_meta,
            )
        return result

    def _run_live_collapsed(
        self,
        selection: SuiteSelectionPlan,
        *,
        commands: list[str],
        live_cfg: Any,
        step_index: int,
    ) -> tuple[StepObservation, dict[str, Any]]:
        assert self._run_id
        diagnostics = empty_live_diagnostics(run_id=self._run_id, commands_count=len(commands))
        diagnostics["playwright_process_count"] = 1
        diagnostics["commands_collapsed"] = True
        diagnostics["collapsed_commands"] = list(commands)

        prep = self._prepare_live_subprocess_env(selection.params, flow_ids=selection.flow_ids, live_cfg=live_cfg)
        if isinstance(prep, StepObservation):
            diagnostics["playwright_process_count"] = 0
            return prep, diagnostics

        env, profile_path = prep
        stale_err, _hints = assess_live_profile_before_launch(profile_path, self._run_id)
        if stale_err:
            return (
                StepObservation(
                    step_index=step_index,
                    action="live_browser",
                    ok=False,
                    message=stale_err,
                    meta={"live_diagnostics": diagnostics},
                ),
                diagnostics,
            )

        cwd = self.config.automation_dir.resolve()
        payload = build_live_selection_payload(
            run_id=self._run_id,
            commands=commands,
            execution_mode=selection.execution_mode or "",
            flow_ids=selection.flow_ids,
            params=selection.params,
        )
        selection_path = write_live_selection_file(cwd, self._run_id, payload)
        env["QA_LIVE_SELECTION_PATH"] = str(selection_path)
        argv = live_playwright_script_argv(cwd, selection_path)
        resolved = _resolve_command_argv(argv, env)
        obs = self._execute_playwright_subprocess(
            resolved,
            cwd=cwd,
            env=env,
            step_index=step_index,
            cmd_label=f"live:collapsed:{len(commands)}",
            params=selection.params,
            live_cfg=live_cfg,
        )
        test_count = parse_running_test_count(str((obs.meta or {}).get("stdout_tail", "")))
        if test_count is not None:
            diagnostics["selected_test_count"] = test_count
        diagnostics = merge_session_diagnostics(profile_path, diagnostics)
        diagnostics["playwright_process_count"] = 1
        meta = {**(obs.meta or {}), "live_diagnostics": diagnostics, "playwright_subprocess": True}
        return (
            StepObservation(
                step_index=obs.step_index,
                action=obs.action,
                ok=obs.ok,
                message=obs.message,
                screenshot_path=obs.screenshot_path,
                url=obs.url,
                meta=meta,
            ),
            diagnostics,
        )

    def _prepare_live_subprocess_env(
        self,
        params: dict[str, Any],
        *,
        flow_ids: list[str] | None,
        live_cfg: Any,
    ) -> tuple[dict[str, str], Path] | StepObservation:
        assert self._run_id
        cwd = self.config.automation_dir.resolve()
        if not cwd.exists():
            return StepObservation(
                step_index=0,
                action="playwright_suite",
                ok=False,
                message=f"missing automation dir: {cwd}",
            )
        env = _enrich_path(os.environ.copy())
        env["QA_RUN_ID"] = self._run_id
        active_flows = flow_ids or self._flow_ids
        if active_flows:
            env["QA_FLOW_ID"] = active_flows[0]
        try:
            validated = validate_run_params(params)
        except ValueError as exc:
            return StepObservation(
                step_index=0,
                action="playwright_suite",
                ok=False,
                message=f"invalid params: {exc}",
            )
        env.update(params_to_env(validated))
        env = apply_live_browser_env(live_cfg, env, run_id=self._run_id)
        env["EA_SKIP_GLOBAL_SETUP"] = "true"
        profile_path = Path(env["QA_LIVE_PROFILE_DIR"])
        register_session(
            LiveBrowserSession(
                meta=LiveBrowserSessionMeta(
                    run_id=self._run_id,
                    browser_session_id=f"live-{self._run_id}",
                    profile_dir=str(profile_path),
                    channel=live_cfg.browser_channel,
                    headless=live_cfg.headless,
                    keep_open=live_cfg.keep_browser_open,
                    status="STARTING",
                )
            )
        )
        from qa_orchestrator.fs_atomic import atomic_write_json

        atomic_write_json(
            profile_path / "session.json",
            {
                "run_id": self._run_id,
                "browser_session_id": f"live-{self._run_id}",
                "profile_dir": str(profile_path),
                "status": "STARTING",
                "channel": live_cfg.browser_channel,
                "headless": live_cfg.headless,
                "keep_open": live_cfg.keep_browser_open,
            },
        )
        get_event_store(self._run_id).emit(
            phase="EXECUTE",
            action="START",
            flow_id=env.get("QA_FLOW_ID", ""),
            value_summary=f"channel={live_cfg.browser_channel} headless={live_cfg.headless}",
        )
        return env, profile_path

    def _execute_playwright_subprocess(
        self,
        resolved: list[str] | str,
        *,
        cwd: Path,
        env: dict[str, str],
        step_index: int,
        cmd_label: str,
        params: dict[str, Any],
        live_cfg: Any | None,
    ) -> StepObservation:
        if isinstance(resolved, str) and resolved.startswith("ERROR:"):
            return StepObservation(
                step_index=step_index,
                action="playwright_suite",
                ok=False,
                message=resolved,
            )
        use_shell = isinstance(resolved, str)
        try:
            proc = subprocess.run(
                resolved,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=self.config.timeout_s,
                check=False,
                env=env,
                shell=use_shell,
            )
            ok = proc.returncode == 0
            meta: dict[str, Any] = {
                "command": cmd_label,
                "resolved": resolved if isinstance(resolved, str) else " ".join(resolved),
                "cwd": str(cwd),
                "automation_dir": str(self.config.automation_dir),
                "stdout_tail": proc.stdout[-8000:],
                "stderr_tail": proc.stderr[-4000:],
                "params": params,
                "playwright_subprocess": True,
            }
            exec_status, infra_warnings = classify_playwright_output(
                proc.stdout or "", proc.stderr or "", proc.returncode
            )
            meta["execution_status"] = exec_status
            meta["infrastructure_warnings"] = infra_warnings
            param_trace = seed_param_trace_from_params(params)
            param_trace.update(parse_param_trace_output(proc.stdout or "", proc.stderr or ""))
            if param_trace:
                meta["param_trace"] = param_trace
            if exec_status == "PASS_WITH_WARNING":
                ok = True
            if live_cfg and live_cfg.is_live and self._run_id:
                combined = (proc.stderr or "") + (proc.stdout or "")
                if "LIVE_BROWSER_STALE" in combined:
                    ok = False
                    meta["browser_status"] = "LIVE_BROWSER_STALE"
                elif "BROWSER_UNAVAILABLE" in combined:
                    ok = False
                    meta["browser_status"] = "BROWSER_UNAVAILABLE"
                elif "BROWSER_DISCONNECTED" in combined:
                    ok = False
                    meta["browser_status"] = "BROWSER_DISCONNECTED"
                else:
                    meta["browser_status"] = "LIVE"
                if live_cfg.keep_browser_open:
                    meta["browser_keep_open"] = True
                    get_event_store(self._run_id).emit(
                        phase="COMPLETE",
                        action="KEEP_OPEN",
                        status="OK" if ok else "FAIL",
                        value_summary="Browser remains open for inspection.",
                    )
                profile_path = Path(env.get("QA_LIVE_PROFILE_DIR", ""))
                if profile_path.is_dir() and self._run_id:
                    diag = empty_live_diagnostics(run_id=self._run_id, commands_count=1)
                    diag["playwright_process_count"] = 1
                    test_count = parse_running_test_count(proc.stdout or "")
                    if test_count is not None:
                        diag["selected_test_count"] = test_count
                    diag = merge_session_diagnostics(profile_path, diag)
                    meta["live_diagnostics"] = diag
            report_path = cwd / "reports" / "results.json"
            if report_path.exists():
                try:
                    data = json.loads(report_path.read_text(encoding="utf-8"))
                    meta["playwright_report"] = {
                        "stats": data.get("stats"),
                        "suites": len(data.get("suites", [])),
                    }
                    from qa_orchestrator.gt_eval import executed_test_case_ids_from_playwright_report

                    stats = data.get("stats") or {}
                    expected = stats.get("expected")
                    tc_ids = executed_test_case_ids_from_playwright_report(data)
                    if tc_ids:
                        meta["executed_test_case_ids"] = tc_ids
                    elif isinstance(expected, int) and expected == 0:
                        meta["executed_test_case_ids"] = []
                except json.JSONDecodeError:
                    pass
            evidence = collect_evidence(cwd, run_id=self._run_id)
            if evidence:
                meta["evidence"] = evidence
            screenshot = evidence[0]["path"] if evidence else None
            return StepObservation(
                step_index=step_index,
                action="playwright_suite",
                ok=ok,
                message=cmd_label if ok else (proc.stderr.strip() or f"exit {proc.returncode}"),
                screenshot_path=screenshot,
                meta=meta,
            )
        except subprocess.TimeoutExpired:
            return StepObservation(
                step_index=step_index,
                action="playwright_suite",
                ok=False,
                message="playwright.timeout",
            )
        except Exception as exc:  # noqa: BLE001
            return StepObservation(
                step_index=step_index,
                action="playwright_suite",
                ok=False,
                message=f"playwright:{type(exc).__name__}:{exc}",
            )

    def run_suite(self, *, suite: str | None = None, flow_id: str | None = None) -> ExecutionResult:
        suite = suite or self.config.suite
        flow_id = flow_id or self.config.flow_id
        if flow_id:
            cmd = build_flow_command(flow_id, polarity="positive")
        elif suite == "sanity":
            cmd = build_sanity_command(positive_only=True)
        elif suite == "regression":
            cmd = "npm run test:regression"
        else:
            cmd = build_flow_command(suite, polarity="positive")
        selection = SuiteSelectionPlan(commands=[cmd], flow_ids=[flow_id] if flow_id else [], suite_ids=[suite])
        return self.run_selection(selection)

    def _run_command(
        self,
        cmd: str,
        *,
        step_index: int,
        params: dict[str, Any],
        flow_ids: list[str] | None = None,
        live_cfg: Any | None = None,
    ) -> StepObservation:
        cwd = self.config.automation_dir.resolve()
        if not cwd.exists():
            return StepObservation(
                step_index=step_index,
                action="playwright_suite",
                ok=False,
                message=f"missing automation dir: {cwd}",
            )
        if not (cwd / "node_modules").exists():
            return StepObservation(
                step_index=step_index,
                action="playwright_suite",
                ok=False,
                message=(
                    "automation dependencies missing — run: cd automation && npm ci && "
                    "npx playwright install chromium"
                ),
            )

        env = _enrich_path(os.environ.copy())
        if self._run_id:
            env["QA_RUN_ID"] = self._run_id
        active_flows = flow_ids or self._flow_ids
        if active_flows:
            env["QA_FLOW_ID"] = active_flows[0]
        try:
            validated = validate_run_params(params)
        except ValueError as exc:
            return StepObservation(
                step_index=step_index,
                action="playwright_suite",
                ok=False,
                message=f"invalid params: {exc}",
            )
        env.update(params_to_env(validated))

        if live_cfg is None:
            live_cfg = load_live_browser_config() if load_live_browser_config else None
        if live_cfg and live_cfg.is_live:
            if not self._run_id:
                return StepObservation(
                    step_index=step_index,
                    action="live_browser",
                    ok=False,
                    message="live mode requires QA_RUN_ID",
                )
            prep = self._prepare_live_subprocess_env(params, flow_ids=flow_ids, live_cfg=live_cfg)
            if isinstance(prep, StepObservation):
                return StepObservation(
                    step_index=prep.step_index,
                    action=prep.action,
                    ok=prep.ok,
                    message=prep.message,
                    meta=prep.meta,
                )
            env, profile_path = prep
            stale_err, _hints = assess_live_profile_before_launch(profile_path, self._run_id)
            if stale_err:
                return StepObservation(
                    step_index=step_index,
                    action="live_browser",
                    ok=False,
                    message=stale_err,
                )

        resolved = _resolve_command(cmd, env)
        return self._execute_playwright_subprocess(
            resolved,
            cwd=cwd,
            env=env,
            step_index=step_index,
            cmd_label=cmd,
            params=params,
            live_cfg=live_cfg,
        )

    def _dry_run(self, selection: SuiteSelectionPlan) -> ExecutionResult:
        observations = [
            StepObservation(
                step_index=i,
                action="playwright_suite_dry_run",
                ok=True,
                message=cmd,
                meta={"dry_run": True, "flow_ids": selection.flow_ids, "params": selection.params},
            )
            for i, cmd in enumerate(selection.commands or ["npm run test:sanity"])
        ]
        return ExecutionResult(ok=True, mode=self.mode, observations=observations)

    def _suite_from_plan(self, plan: ExecutionPlan) -> str:
        rt = (plan.run_type or "").lower()
        if "sanity" in rt or "morning" in plan.goal.lower():
            return "sanity"
        if "regression" in rt:
            return "regression"
        return self.config.suite

    def _flow_from_plan(self, plan: ExecutionPlan) -> str | None:
        for ref in plan.kb_refs or []:
            if ref.startswith("BF-"):
                return ref
        return self.config.flow_id


def _resolve_command(cmd: str, env: dict[str, str] | None = None) -> list[str] | str:
    """Resolve npm on Windows (npm.cmd) and return argv or shell string."""
    search_env = _enrich_path(env or os.environ.copy())
    parts = cmd.split()
    if not parts or parts[0] != "npm":
        return parts
    npm = shutil.which("npm", path=search_env.get("PATH")) or shutil.which("npm.cmd", path=search_env.get("PATH"))
    if not npm:
        npm = _find_npm_windows()
    if not npm:
        return (
            "ERROR: npm not found on PATH — install Node.js LTS from https://nodejs.org, "
            "restart VS Code, then run: cd automation && npm ci"
        )
    if sys.platform == "win32":
        return subprocess.list2cmdline([npm, *parts[1:]])
    parts[0] = npm
    return parts


def _resolve_command_argv(argv: list[str], env: dict[str, str] | None = None) -> list[str] | str:
    """Resolve node/npm argv for subprocess (Windows-safe)."""
    if not argv:
        return argv
    search_env = _enrich_path(env or os.environ.copy())
    exe = argv[0]
    if exe == "node":
        node = shutil.which("node", path=search_env.get("PATH")) or shutil.which("node.exe", path=search_env.get("PATH"))
        if not node:
            return "ERROR: node not found on PATH"
        rest = argv[1:]
        if sys.platform == "win32":
            return subprocess.list2cmdline([node, *rest])
        return [node, *rest]
    if exe == "npm" or exe.startswith("npm"):
        return _resolve_command(" ".join(argv), env)
    return argv


def _enrich_path(env: dict[str, str]) -> dict[str, str]:
    if sys.platform != "win32":
        return env
    extras: list[str] = []
    for key in ("ProgramFiles", "ProgramFiles(x86)"):
        base = os.environ.get(key)
        if base:
            node_dir = Path(base) / "nodejs"
            if node_dir.is_dir():
                extras.append(str(node_dir))
    appdata = os.environ.get("APPDATA")
    if appdata:
        npm_dir = Path(appdata) / "npm"
        if npm_dir.is_dir():
            extras.append(str(npm_dir))
    if extras:
        env["PATH"] = os.pathsep.join(extras) + os.pathsep + env.get("PATH", "")
    return env


def _find_npm_windows() -> str | None:
    if sys.platform != "win32":
        return None
    env = _enrich_path(os.environ.copy())
    return shutil.which("npm.cmd", path=env.get("PATH")) or shutil.which("npm", path=env.get("PATH"))


def resolve_automation_dir() -> Path:
    """Absolute automation path — avoids wrong cwd when server started from another folder."""
    raw = os.environ.get("QA_AUTOMATION_DIR")
    if raw:
        return Path(raw)
    here = Path(__file__).resolve()
    for parent in here.parents:
        for sub in ("apps/automation", "automation"):
            candidate = parent / sub
            if (candidate / "package.json").exists():
                return candidate
    return Path("apps/automation")


def collect_evidence(
    automation_dir: Path,
    *,
    run_id: str | None = None,
    limit: int = 24,
) -> list[dict[str, Any]]:
    """Collect evidence artifacts scoped to a single run_id."""
    evidence_root = automation_dir / "reports" / "evidence"
    items: list[dict[str, Any]] = []
    if not evidence_root.exists():
        return items

    if run_id:
        scan_root = evidence_root / run_id
        if not scan_root.exists():
            return items
        pngs = sorted(scan_root.rglob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)
    else:
        pngs = sorted(evidence_root.rglob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)

    for png in pngs[:limit]:
        rel = str(png.relative_to(automation_dir)).replace("\\", "/")
        meta = png.with_suffix(".json")
        entry: dict[str, Any] = {
            "type": "screenshot",
            "path": rel,
            "label": png.parent.name,
        }
        dom = png.with_suffix(".html")
        if dom.exists():
            entry["dom_path"] = str(dom.relative_to(automation_dir)).replace("\\", "/")
        if meta.exists():
            try:
                meta_data = json.loads(meta.read_text(encoding="utf-8"))
                entry["meta"] = meta_data
                if run_id and meta_data.get("runId") and meta_data.get("runId") != run_id:
                    continue
            except json.JSONDecodeError:
                pass
        items.append(entry)
    return items

