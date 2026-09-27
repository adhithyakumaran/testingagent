#!/usr/bin/env python3
"""Local warm QA Orchestrator HTTP server — intent classify + Playwright execution.

  PYTHONPATH=services/agent-runtime:services/qa-orchestrator:. python3 scripts/local_agent_server.py --port 43124

POST /run   {"goal":"morning sanity check","run_type":"sanity"}
POST /chat  same body — chat-friendly alias with structured enterprise output
GET  /health
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
for entry in (
    ROOT / "services" / "agent-runtime",
    ROOT / "services" / "qa-orchestrator",
    ROOT,
):
    entry_str = str(entry)
    if entry_str not in sys.path:
        sys.path.insert(0, entry_str)
legacy_src = ROOT / "src"
if legacy_src.is_dir() and str(legacy_src) not in sys.path:
    sys.path.insert(0, str(legacy_src))


def _load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv()

from qa_orchestrator.legacy_guard import assert_canonical_agent_path, canonical_path_metadata  # noqa: E402
from qa_orchestrator.orchestrator import QaOrchestrator, RunRequest  # noqa: E402
from qa_orchestrator.warm_run_registry import WarmRunRegistry  # noqa: E402
from qa_orchestrator.server_auth import (  # noqa: E402
    acquire_concurrency,
    allowed_origin,
    auth_configuration_error,
    bind_host_default,
    cors_headers,
    is_authenticated,
    log_auth_rejection,
    release_concurrency,
    security_log,
    validate_body_size,
)


class LocalOrchestratorService:
    def __init__(
        self,
        discovery_root: str,
        *,
        default_model: str | None = None,
    ) -> None:
        self.discovery_root = discovery_root
        self.default_model = default_model
        t0 = time.perf_counter()
        self.orchestrator = QaOrchestrator(discovery_root=discovery_root, model=default_model)
        journal_dir = os.environ.get(
            "QA_AGENT_JOURNAL_DIR",
            str(ROOT / "reports" / "agent"),
        )
        self.run_registry = WarmRunRegistry(journal_dir=journal_dir)
        self.boot_ms = int((time.perf_counter() - t0) * 1000)
        self.runs = 0

    def run(
        self,
        goal: str,
        *,
        run_type: str = "adhoc",
        model: str | None = None,
        run_id: str | None = None,
        context_packets: list[dict[str, Any]] | None = None,
        skip_discovery: bool = False,
        skip_execution: bool = False,
        execution_mode: str = "CI",
        allow_skip_execution: bool = False,
        run_request: RunRequest | None = None,
    ) -> dict[str, Any]:
        assert_canonical_agent_path("local_agent_server")
        t0 = time.perf_counter()
        req = run_request or RunRequest(
            goal=goal,
            run_type=run_type,
            model=model or self.default_model,
            run_id=run_id,
            context_packets=context_packets or [],
            skip_discovery=skip_discovery,
            skip_execution=skip_execution,
            execution_mode=execution_mode,
            allow_skip_execution=allow_skip_execution,
        )
        from qa_orchestrator.live_browser_config import apply_run_mode_to_environ

        apply_run_mode_to_environ(req.execution_mode)
        from qa_orchestrator.run_request_parse import log_run_request_accepted

        log_run_request_accepted(
            run_id=req.run_id,
            execution_mode=req.execution_mode,
            skip_execution=req.skip_execution,
            run_type=req.run_type,
            goal=req.goal,
            stream=sys.stderr,
        )
        result = self.orchestrator.run(req)
        self.runs += 1
        payload = self.orchestrator.to_agent_payload(result)
        payload["local"]["elapsed_ms"] = int((time.perf_counter() - t0) * 1000)
        payload["local"]["boot_ms"] = self.boot_ms
        payload["local"]["runs_served"] = self.runs
        payload["local"]["llm_enabled"] = result.metadata.get("llm_enabled", False)
        payload["local"]["llm_provider"] = result.metadata.get("llm_provider", "groq")
        payload["local"]["primary_flows"] = len(self.orchestrator.graph.ready_flow_ids())
        payload["local"]["draft_flows"] = len(self.orchestrator.graph.draft_flow_ids())
        payload["local"]["canonical"] = canonical_path_metadata()
        payload["local"]["request_acceptance"] = {
            "execution_mode": req.execution_mode,
            "skip_execution": req.skip_execution,
            "run_type": req.run_type,
            "run_id": req.run_id,
        }
        if payload.get("decision_diagnostics"):
            from qa_orchestrator.decision_diagnostics import log_decision_block

            log_decision_block(payload["decision_diagnostics"], stream=sys.stderr)
        return payload

    def accept_run_async(self, req: RunRequest) -> dict[str, Any]:
        """Accept run_id immediately; orchestration continues on a background thread."""
        run_id = self.run_registry.ensure_run_id(req.run_id)
        req.run_id = run_id

        def worker() -> dict[str, Any]:
            return self.run(
                req.goal,
                run_request=req,
            )

        token, job = self.run_registry.accept(run_id, worker)
        if job.status == "completed" and job.payload:
            return {
                "ok": True,
                "accepted": False,
                "run_id": run_id,
                "status": "completed",
                "result": job.payload,
            }
        if job.status == "failed":
            return {
                "ok": False,
                "accepted": False,
                "run_id": run_id,
                "status": "failed",
                "error": job.error or "orchestrator_failed",
            }
        return {
            "ok": True,
            "accepted": token == "started",
            "run_id": run_id,
            "status": "running",
        }

    def get_run_result(self, run_id: str) -> dict[str, Any]:
        job = self.run_registry.get_job(run_id)
        if job is None:
            raise FileNotFoundError(f"no warm run job for run_id={run_id}")
        if job.status == "running":
            return {
                "ok": True,
                "run_id": run_id,
                "status": "running",
                "started_at": job.started_at,
            }
        if job.status == "failed":
            return {
                "ok": False,
                "run_id": run_id,
                "status": "failed",
                "error": job.error or "orchestrator_failed",
            }
        return {
            "ok": True,
            "run_id": run_id,
            "status": "completed",
            "result": job.payload,
        }

    def get_agent(self, run_id: str) -> dict[str, Any]:
        snapshot = self.orchestrator.get_agent_state(run_id)
        state = snapshot.state
        return {
            "ok": True,
            "run_id": run_id,
            "status": state.status,
            "final_result": state.final_result,
            "reason_code": state.reason_code,
            "decision_diagnostics": state.decision_diagnostics or state.metadata.get("decision_diagnostics"),
            "summary": state.summary,
            "checkpoint": snapshot.checkpoint,
            "approval_pause_kind": snapshot.approval_pause_kind,
            "approval_reason": snapshot.approval_reason or state.reason_code or "",
            "pending_action": snapshot.pending_action,
            "resume_token": snapshot.resume_token,
            "last_applied_resume_token": snapshot.last_applied_resume_token,
            "resumable": state.status == "WAITING_FOR_APPROVAL",
            "journal_summary": [entry.model_dump() for entry in state.decision_journal[-10:]],
            "state_path": str(
                __import__("qa_orchestrator.agent_state_store", fromlist=["state_path"]).state_path(
                    self.orchestrator.agent_loop.config.journal_dir,
                    run_id,
                )
            ),
        }

    def resume_agent(self, run_id: str, *, resume_token: str | None = None, reason: str = "approval granted") -> dict[str, Any]:
        result = self.orchestrator.resume_agent(run_id, resume_token=resume_token, resume_reason=reason)
        orch_result = self.orchestrator.agent_loop.to_orchestrator_result(result)
        orch_result.metadata.update(result.orchestrator_metadata)
        payload = self.orchestrator.to_agent_payload(orch_result)
        payload["agent"]["decision_journal"] = [entry.model_dump() for entry in result.state.decision_journal]
        return payload


SERVICE: LocalOrchestratorService | None = None


class Handler(BaseHTTPRequestHandler):
    server_version = "ScoutQAOrchestrator/2.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[qa-orchestrator] " + (fmt % args) + "\n")

    def _origin(self) -> str | None:
        return self.headers.get("Origin") or self.headers.get("origin")

    def _send_cors(self) -> None:
        for key, value in cors_headers(self._origin()).items():
            self.send_header(key, value)

    def _json(self, code: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self._send_cors()
        self.end_headers()
        self.wfile.write(raw)

    def _require_auth(self, path: str) -> bool:
        config_err = auth_configuration_error()
        if config_err:
            self._json(503, {"ok": False, "error": "misconfigured", "detail": config_err})
            return False
        if is_authenticated(self.headers):
            return True
        log_auth_rejection(path, "invalid_or_missing_internal_token")
        self._json(401, {"ok": False, "error": "unauthorized", "detail": "Valid internal service token required"})
        return False

    def do_OPTIONS(self) -> None:  # noqa: N802
        origin = self._origin()
        headers = cors_headers(origin)
        if not headers and origin and origin != allowed_origin():
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        parts = [p for p in path.split("/") if p]
        if len(parts) >= 2 and parts[0] == "agent":
            if not self._require_auth(path):
                return
            run_id = parts[1]
            assert SERVICE is not None
            if len(parts) == 3 and parts[2] == "result":
                try:
                    body = SERVICE.get_run_result(run_id)
                    code = 200 if body.get("status") != "running" else 202
                    self._json(code, body)
                except FileNotFoundError as exc:
                    self._json(404, {"ok": False, "error": str(exc)})
                except Exception as exc:  # noqa: BLE001
                    self._json(500, {"ok": False, "error": f"{type(exc).__name__}:{exc}"})
                return
            if len(parts) == 2:
                try:
                    self._json(200, SERVICE.get_agent(run_id))
                except Exception as exc:  # noqa: BLE001
                    self._json(404, {"ok": False, "error": f"{type(exc).__name__}:{exc}"})
                return
        if path in {"/health", "/"}:
            assert SERVICE is not None
            orch = SERVICE.orchestrator
            self._json(
                200,
                {
                    "ok": True,
                    "service": "qa-orchestrator",
                    "version": "2.0",
                    "architecture": "classify → plan → agent_loop → playwright → report",
                    "boot_ms": SERVICE.boot_ms,
                    "runs_served": SERVICE.runs,
                    "llm_enabled": orch.llm.enabled,
                    "llm_provider": orch.llm.provider,
                    "executor": getattr(orch.executor, "mode", "playwright"),
                    "discovery_root": SERVICE.discovery_root,
                    "primary_ready_flows": len(orch.graph.ready_flow_ids()),
                    "supporting_draft_flows": len(orch.graph.draft_flow_ids()),
                    "canonical_runtime": "qa_orchestrator.ControlledAgentLoop",
                },
            )
            return
        self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if not acquire_concurrency():
            self._json(429, {"ok": False, "error": "too_many_requests"})
            return
        try:
            self._handle_post(path)
        finally:
            release_concurrency()

    def _handle_post(self, path: str) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        if not validate_body_size(length):
            self._json(413, {"ok": False, "error": "payload_too_large"})
            return
        if path.startswith("/agent/") and path.endswith("/resume"):
            if not self._require_auth(path):
                return
            run_id = path.split("/")[2]
            assert SERVICE is not None
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self._json(400, {"ok": False, "error": "invalid_json"})
                return
            try:
                payload = SERVICE.resume_agent(
                    run_id,
                    resume_token=body.get("resume_token"),
                    reason=str(body.get("reason") or "approval granted"),
                )
                self._json(200, {"ok": True, "result": payload})
            except Exception as exc:  # noqa: BLE001
                self._json(400, {"ok": False, "error": f"{type(exc).__name__}:{exc}"})
            return
        if path not in {"/run", "/chat"}:
            self._json(404, {"ok": False, "error": "not_found"})
            return
        if not self._require_auth(path):
            return
        assert SERVICE is not None
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "invalid_json"})
            return
        from qa_orchestrator.run_request_parse import build_run_request_from_body

        parsed = build_run_request_from_body(body)
        if parsed.request is None:
            self._json(
                parsed.http_status,
                {
                    "ok": False,
                    "error": parsed.error_code or "invalid_request",
                    "reason_code": parsed.error_code,
                    "message": parsed.error_message,
                },
            )
            return
        req = parsed.request
        if req.run_id:
            security_log("run_accepted", run_id=str(req.run_id), path=path)
        try:
            accepted = SERVICE.accept_run_async(req)
            if accepted.get("status") == "completed" and accepted.get("result"):
                result = accepted["result"]
                chat_response = {
                    "message": result.get("summary", ""),
                    "conclusion": result.get("conclusion"),
                    "execution_mode": result.get("local", {}).get("execution_mode"),
                    "report_markdown": result.get("local", {}).get("report_markdown"),
                    "suite_plan": result.get("local", {}).get("suite_plan"),
                }
                self._json(
                    200,
                    {
                        "ok": True,
                        "run_id": accepted.get("run_id"),
                        "result": result,
                        "chat": chat_response if path == "/chat" else None,
                    },
                )
                return
            if accepted.get("status") == "failed":
                self._json(
                    500,
                    {
                        "ok": False,
                        "run_id": accepted.get("run_id"),
                        "error": accepted.get("error") or "orchestrator_failed",
                    },
                )
                return
            self._json(
                202,
                {
                    "ok": True,
                    "accepted": True,
                    "run_id": accepted.get("run_id"),
                    "status": "running",
                },
            )
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"ok": False, "error": f"{type(exc).__name__}:{exc}"})


def main() -> None:
    parser = argparse.ArgumentParser()
    default_host = bind_host_default()
    parser.add_argument("--host", default=default_host)
    parser.add_argument("--port", type=int, default=43124)
    parser.add_argument("--discovery-root", default=str(ROOT / "data" / "discovery-kb"))
    parser.add_argument("--model", default=os.environ.get("LLM_MODEL_REASONING"))
    args = parser.parse_args()
    assert_bind = __import__("qa_orchestrator.server_auth", fromlist=["assert_bind_host"]).assert_bind_host
    assert_bind(args.host)
    config_err = auth_configuration_error()
    if config_err:
        print(json.dumps({"fatal": config_err}), file=sys.stderr)
        raise SystemExit(1)
    os.environ.setdefault("LLM_ENABLED", "true")
    os.environ.setdefault("QA_RUNNER", "playwright")
    os.environ.setdefault("QA_AUTOMATION_DIR", str(ROOT / "apps" / "automation"))
    global SERVICE
    SERVICE = LocalOrchestratorService(args.discovery_root, default_model=args.model)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        json.dumps(
            {
                "listening": f"http://{args.host}:{args.port}",
                "boot_ms": SERVICE.boot_ms,
                "llm_enabled": SERVICE.orchestrator.llm.enabled,
                "executor": getattr(SERVICE.orchestrator.executor, "mode", "playwright"),
                "discovery_root": args.discovery_root,
                "ready_flows": len(SERVICE.orchestrator.graph.ready_flow_ids()),
                "canonical_runtime": "qa_orchestrator.ControlledAgentLoop",
                "bind_host": args.host,
                "cors_origin": allowed_origin(),
            }
        ),
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
