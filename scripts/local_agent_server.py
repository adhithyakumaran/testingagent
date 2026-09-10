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
    for env_path in (
        ROOT / ".env",
        ROOT / "apps" / "automation" / "config" / ".env",
    ):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_load_dotenv()

from qa_orchestrator.orchestrator import QaOrchestrator, RunRequest  # noqa: E402


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
        self.boot_ms = int((time.perf_counter() - t0) * 1000)
        self.runs = 0

    def run(
        self,
        goal: str,
        *,
        run_type: str = "adhoc",
        model: str | None = None,
        context_packets: list[dict[str, Any]] | None = None,
        skip_discovery: bool = False,
        skip_execution: bool = False,
    ) -> dict[str, Any]:
        t0 = time.perf_counter()
        result = self.orchestrator.run(
            RunRequest(
                goal=goal,
                run_type=run_type,
                model=model or self.default_model,
                context_packets=context_packets or [],
                skip_discovery=skip_discovery,
                skip_execution=skip_execution,
            )
        )
        self.runs += 1
        payload = self.orchestrator.to_agent_payload(result)
        payload["local"]["elapsed_ms"] = int((time.perf_counter() - t0) * 1000)
        payload["local"]["boot_ms"] = self.boot_ms
        payload["local"]["runs_served"] = self.runs
        payload["local"]["llm_enabled"] = result.metadata.get("llm_enabled", False)
        payload["local"]["llm_provider"] = result.metadata.get("llm_provider", "groq")
        payload["local"]["primary_flows"] = len(self.orchestrator.graph.ready_flow_ids())
        payload["local"]["draft_flows"] = len(self.orchestrator.graph.draft_flow_ids())
        return payload


SERVICE: LocalOrchestratorService | None = None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[qa-orchestrator] " + (fmt % args) + "\n")

    def _json(self, code: int, body: dict[str, Any]) -> None:
        try:
            raw = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(raw)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            return

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {"/health", "/"}:
            assert SERVICE is not None
            orch = SERVICE.orchestrator
            self._json(
                200,
                {
                    "ok": True,
                    "service": "qa-orchestrator",
                    "version": "2.0",
                    "architecture": "classify → suite_select → playwright → report",
                    "boot_ms": SERVICE.boot_ms,
                    "runs_served": SERVICE.runs,
                    "llm_enabled": orch.llm.enabled,
                    "llm_provider": orch.llm.provider,
                    "executor": getattr(orch.executor, "mode", "playwright"),
                    "discovery_root": SERVICE.discovery_root,
                    "primary_ready_flows": len(orch.graph.ready_flow_ids()),
                    "supporting_draft_flows": len(orch.graph.draft_flow_ids()),
                    "note": "Groq intent classification when GROQ_API_KEY set; swap to Claude via LLM_PROVIDER=anthropic",
                },
            )
            return
        self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in {"/run", "/chat"}:
            self._json(404, {"ok": False, "error": "not_found"})
            return
        assert SERVICE is not None
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "invalid_json"})
            return
        goal = str(body.get("goal") or body.get("message") or "").strip()
        if not goal:
            self._json(400, {"ok": False, "error": "goal_required"})
            return
        run_type = str(body.get("run_type") or body.get("type") or "adhoc")
        model = body.get("model")
        context_packets = body.get("context_packets") if isinstance(body.get("context_packets"), list) else []
        skip_discovery = bool(body.get("skip_discovery"))
        skip_execution = bool(body.get("skip_execution"))
        if body.get("headed"):
            os.environ["QA_HEADED"] = "true"
            os.environ["EA_HEADLESS"] = "false"
            os.environ["EA_USE_SYSTEM_CHROME"] = "true"
        try:
            result = SERVICE.run(
                goal,
                run_type=run_type,
                model=model,
                context_packets=context_packets,
                skip_discovery=skip_discovery,
                skip_execution=skip_execution,
            )
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
                    "result": result,
                    "chat": chat_response if path == "/chat" else None,
                },
            )
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"ok": False, "error": f"{type(exc).__name__}:{exc}"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=43124)
    parser.add_argument("--discovery-root", default=str(ROOT / "data" / "discovery-kb"))
    parser.add_argument("--model", default=os.environ.get("LLM_MODEL_REASONING"))
    args = parser.parse_args()
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
            }
        ),
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
