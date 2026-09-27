"""P10.1 security hardening and canonical runtime tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from qa_orchestrator.legacy_guard import CANONICAL_ORCHESTRATOR, canonical_path_metadata
from qa_orchestrator.production_entrypoint import assert_production_entrypoint
from qa_orchestrator.server_auth import (
    allowed_origin,
    auth_configuration_error,
    cors_headers,
    extract_bearer,
    internal_api_token,
    is_authenticated,
    validate_body_size,
)


class _Headers(dict):
    def get(self, key, default=None):  # type: ignore[override]
        for k, v in self.items():
            if k.lower() == key.lower():
                return v
        return default


def test_warm_server_valid_auth(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SCOUT_ENV", "development")
    monkeypatch.setenv("SCOUT_INTERNAL_API_TOKEN", "secret-token")
    headers = _Headers(Authorization="Bearer secret-token")
    assert is_authenticated(headers) is True


def test_warm_server_missing_auth(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SCOUT_ENV", "development")
    monkeypatch.setenv("SCOUT_INTERNAL_API_TOKEN", "secret-token")
    monkeypatch.setenv("SCOUT_ALLOW_INSECURE_LOCAL", "false")
    assert is_authenticated(_Headers()) is False


def test_warm_server_invalid_auth(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SCOUT_ENV", "development")
    monkeypatch.setenv("SCOUT_INTERNAL_API_TOKEN", "secret-token")
    monkeypatch.setenv("SCOUT_ALLOW_INSECURE_LOCAL", "false")
    headers = _Headers(Authorization="Bearer wrong")
    assert is_authenticated(headers) is False


def test_production_token_missing(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SCOUT_ENV", "production")
    monkeypatch.delenv("SCOUT_INTERNAL_API_TOKEN", raising=False)
    monkeypatch.delenv("SCOUT_API_TOKEN", raising=False)
    assert auth_configuration_error() is not None


def test_production_token_valid(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SCOUT_ENV", "production")
    monkeypatch.setenv("SCOUT_INTERNAL_API_TOKEN", "prod-token")
    assert auth_configuration_error() is None
    assert is_authenticated(_Headers(Authorization="Bearer prod-token")) is True


def test_production_token_invalid(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SCOUT_ENV", "production")
    monkeypatch.setenv("SCOUT_INTERNAL_API_TOKEN", "prod-token")
    assert is_authenticated(_Headers(Authorization="Bearer nope")) is False


def test_development_explicit_insecure_local(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SCOUT_ENV", "development")
    monkeypatch.delenv("SCOUT_INTERNAL_API_TOKEN", raising=False)
    monkeypatch.setenv("SCOUT_ALLOW_INSECURE_LOCAL", "true")
    assert auth_configuration_error() is None
    assert is_authenticated(_Headers()) is True


def test_cors_no_wildcard_in_production(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SCOUT_ENV", "production")
    monkeypatch.setenv("SCOUT_ALLOWED_ORIGIN", "http://127.0.0.1:43123")
    headers = cors_headers("http://evil.example")
    assert headers.get("Access-Control-Allow-Origin") != "*"
    assert "Access-Control-Allow-Origin" not in headers or headers["Access-Control-Allow-Origin"] != "*"


def test_cors_approved_origin_production(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SCOUT_ENV", "production")
    monkeypatch.setenv("SCOUT_ALLOWED_ORIGIN", "http://127.0.0.1:43123")
    headers = cors_headers("http://127.0.0.1:43123")
    assert headers.get("Access-Control-Allow-Origin") == "http://127.0.0.1:43123"


def test_extract_bearer():
    assert extract_bearer("Bearer abc") == "abc"
    assert extract_bearer("abc") == "abc"


def test_body_size_limit():
    assert validate_body_size(1024) is True
    assert validate_body_size(10_000_000) is False


def test_canonical_runtime_selection():
    meta = canonical_path_metadata()
    assert meta["orchestrator_path"] == CANONICAL_ORCHESTRATOR
    assert meta["legacy_runtime_canonical"] == "false"
    assert "local_agent_server" in meta["warm_server_entry"]


def test_legacy_runtime_blocked_from_production_dockerfile():
    repo = Path(__file__).resolve().parents[2]
    docker = (repo / "infra" / "deploy" / "Dockerfile").read_text(encoding="utf-8")
    assert_production_entrypoint(repo, docker)
    assert "local_agent_server.py" in docker
    entry = docker.split("ENTRYPOINT")[-1]
    assert "base_agent.api" not in entry


def test_live_demo_config_regression(monkeypatch: pytest.MonkeyPatch):
    from qa_orchestrator.live_browser_config import apply_run_mode_to_environ, load_live_browser_config

    apply_run_mode_to_environ("LIVE_DEMO")
    cfg = load_live_browser_config()
    assert cfg.run_mode == "LIVE_DEMO"
    assert cfg.is_live is True
    assert cfg.headless is False
    assert cfg.keep_browser_open is False


def test_console_api_auth_core_production_fail_closed():
    text = Path(__file__).resolve().parents[2] / "apps" / "console" / "lib" / "api-auth-core.ts"
    raw = text.read_text(encoding="utf-8")
    assert "SCOUT_API_TOKEN required in production" in raw
    assert "allowInsecureLocal" in raw


def test_credentials_route_masks_passwords():
    route = Path(__file__).resolve().parents[2] / "apps" / "console" / "app" / "api" / "credentials" / "route.ts"
    raw = route.read_text(encoding="utf-8")
    assert "PASSWORD" in raw and "********" in raw


def test_run_routes_require_access_helpers():
    stream = Path(__file__).resolve().parents[2] / "apps" / "console" / "app" / "api" / "runs" / "[id]" / "stream" / "route.ts"
    assert "requireRunAccess" in stream.read_text(encoding="utf-8")


def test_agent_runner_uses_internal_token():
    runner = Path(__file__).resolve().parents[2] / "apps" / "console" / "lib" / "agent-runner.ts"
    raw = runner.read_text(encoding="utf-8")
    assert "internalAgentHeaders" in raw


def test_allowed_origin_default(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SCOUT_ALLOWED_ORIGIN", raising=False)
    assert allowed_origin() == "http://127.0.0.1:43123"
