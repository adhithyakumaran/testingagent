"""Warm server async /run accept + /agent/{id}/result polling."""

from __future__ import annotations

import json
import socket
import subprocess
import time
import urllib.error
import urllib.request

import pytest

from tests.canonical_subprocess_env import REPO_ROOT, canonical_subprocess_env
from tests.unit.test_p10_3_warm_server_http import _free_port, _http


@pytest.fixture
def warm_server_async():
    port = _free_port()
    env = canonical_subprocess_env(
        SCOUT_ENV="development",
        SCOUT_INTERNAL_API_TOKEN="p10-test-internal",
        SCOUT_ALLOW_INSECURE_LOCAL="false",
        QA_AGENT_JOURNAL_DIR=str(REPO_ROOT / "reports" / "agent"),
    )
    proc = subprocess.Popen(
        ["python3", str(REPO_ROOT / "scripts" / "local_agent_server.py"), "--host", "127.0.0.1", "--port", str(port)],
        cwd=str(REPO_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 45
    while time.time() < deadline:
        if proc.poll() is not None:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise RuntimeError(f"warm server exited early: {stderr}")
        try:
            code, _ = _http("GET", f"{base}/health")
            if code == 200:
                break
        except urllib.error.URLError:
            pass
        time.sleep(0.25)
    else:
        proc.kill()
        raise TimeoutError("warm server /health never became ready")

    yield base, env
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def _auth_headers(env: dict[str, str]) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {env['SCOUT_INTERNAL_API_TOKEN']}",
    }


def _poll_result(base: str, run_id: str, headers: dict[str, str], timeout_s: float = 90) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        code, body = _http("GET", f"{base}/agent/{run_id}/result", headers=headers)
        data = json.loads(body)
        if code == 200 and data.get("status") == "completed":
            return data
        if code == 202 or data.get("status") == "running":
            time.sleep(0.5)
            continue
        if data.get("status") == "failed":
            pytest.fail(f"run failed: {data}")
        time.sleep(0.5)
    pytest.fail("timed out waiting for orchestrator result")


def test_run_returns_202_then_result_has_execution_payload(warm_server_async):
    base, env = warm_server_async
    run_id = "run_async_http_test"
    payload = json.dumps(
        {
            "goal": "Check login",
            "run_type": "adhoc",
            "skip_execution": True,
            "run_id": run_id,
        }
    ).encode("utf-8")
    code, body = _http("POST", f"{base}/run", headers=_auth_headers(env), body=payload)
    assert code == 202, body[:500]
    data = json.loads(body)
    assert data.get("accepted") is True
    assert data.get("run_id") == run_id

    result_body = _poll_result(base, run_id, _auth_headers(env))
    result = result_body["result"]
    assert result["local"]["suite_plan"] is not None
    assert "execution" in result["local"]


def test_duplicate_post_same_run_id_does_not_require_second_execution(warm_server_async):
    base, env = warm_server_async
    run_id = "run_async_idempotent"
    body_bytes = json.dumps(
        {"goal": "Check login", "run_type": "adhoc", "skip_execution": True, "run_id": run_id}
    ).encode("utf-8")
    headers = _auth_headers(env)
    code1, _ = _http("POST", f"{base}/run", headers=headers, body=body_bytes)
    assert code1 == 202
    _poll_result(base, run_id, headers)
    code2, body2 = _http("POST", f"{base}/run", headers=headers, body=body_bytes)
    assert code2 == 200, body2[:300]
    replay = json.loads(body2)
    assert replay.get("result") is not None
