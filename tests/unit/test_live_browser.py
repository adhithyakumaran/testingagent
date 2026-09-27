"""Live interactive browser execution mode tests."""

from __future__ import annotations

import json

import pytest

from qa_orchestrator.live_browser_close import (
    close_signal_present,
    mark_session_closed,
    process_close_signal,
    write_session_meta,
)
from qa_orchestrator.live_browser_config import load_live_browser_config, require_live_environment
from qa_orchestrator.live_browser_events import LiveEventStore, load_events_from_file
from qa_orchestrator.live_browser_redaction import redact_event_payload
from qa_orchestrator.live_browser_registry import LiveBrowserSession, LiveBrowserSessionMeta, close_session, register_session
from qa_orchestrator.live_browser_sse import advance_sse_cursor, events_after_sequence
from qa_orchestrator.p9_metrics import compute_parameter_traceability_rate


def test_ci_mode_defaults_headless(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("QA_RUN_MODE", "CI")
    monkeypatch.delenv("QA_LIVE_BROWSER", raising=False)
    cfg = load_live_browser_config()
    assert cfg.headless is True
    assert cfg.keep_browser_open is False


def test_live_demo_mode_headed_automatic_teardown_by_default(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("QA_RUN_MODE", "LIVE_DEMO")
    monkeypatch.setenv("EA_BASE_URL", "https://uat.example.com/ords/r/tjdcom/ea")
    monkeypatch.delenv("QA_KEEP_BROWSER_OPEN", raising=False)
    cfg = load_live_browser_config()
    assert cfg.is_live is True
    assert cfg.headless is False
    assert cfg.keep_browser_open is False
    assert cfg.action_delay_ms >= 500
    assert cfg.browser_channel == "chrome"


def test_live_demo_keep_open_only_when_explicit(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("QA_RUN_MODE", "LIVE_DEMO")
    monkeypatch.setenv("QA_KEEP_BROWSER_OPEN", "true")
    cfg = load_live_browser_config()
    assert cfg.keep_browser_open is True


def test_live_requires_configured_url(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("QA_RUN_MODE", "LIVE")
    monkeypatch.delenv("EA_BASE_URL", raising=False)
    cfg = load_live_browser_config()
    assert require_live_environment(cfg) == "LIVE_ENV_BLOCKED: EA_BASE_URL is not configured"


def test_redaction_masks_passwords_and_tokens():
    password = redact_event_payload(
        {"action": "FILL", "value_summary": "secret", "target": "input[name=password]"}
    )
    assert password["value_summary"] == "[redacted]"
    username = redact_event_payload(
        {"action": "FILL", "value_summary": "demo_user", "target": "input[name=username]"}
    )
    assert username["value_summary"] == "demo_user"
    sku = redact_event_payload({"action": "FILL", "value_summary": "ABC123", "target": "#P2_ITEM_CODE"})
    assert sku["value_summary"] == "ABC123"
    token = redact_event_payload({"action": "FILL", "value_summary": "abc", "target": "input[name=api_token]"})
    assert token["value_summary"] == "[redacted]"


def test_live_event_store_sequence_starts_at_one(tmp_path, monkeypatch: pytest.MonkeyPatch):
    path = tmp_path / "events.jsonl"
    store = LiveEventStore("run-1", path=path)
    e1 = store.emit(phase="PLAN", action="SELECT", value_summary="BF-PRODUCT-003")
    e2 = store.emit(phase="EXECUTE", action="START", status="OK")
    assert e1.sequence == 1
    assert e2.sequence == 2
    rows = store.list_events()
    assert [r["sequence"] for r in rows] == [1, 2]


def test_load_events_from_file_respects_sequence(tmp_path):
    path = tmp_path / "events.jsonl"
    path.write_text(
        "\n".join(
            [
                json.dumps({"sequence": 1, "phase": "BROWSER", "action": "LAUNCH"}),
                json.dumps({"sequence": 2, "phase": "ACTION", "action": "CLICK"}),
                json.dumps({"sequence": 3, "phase": "ACTION", "action": "FILL"}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    batch = load_events_from_file(path, after_sequence=1)
    assert [row["sequence"] for row in batch] == [2, 3]


def test_sse_cursor_dedupes_duplicate_delivery():
    batch = [
        {"sequence": 1, "phase": "BROWSER", "action": "LAUNCH"},
        {"sequence": 2, "phase": "ACTION", "action": "CLICK", "status": "STARTED"},
        {"sequence": 2, "phase": "ACTION", "action": "CLICK", "status": "STARTED"},
        {"sequence": 3, "phase": "ACTION", "action": "CLICK", "status": "OK"},
    ]
    cursor, delivered = advance_sse_cursor(0, batch)
    assert cursor == 3
    assert [row["sequence"] for row in delivered] == [1, 2, 3]
    cursor2, delivered2 = advance_sse_cursor(cursor, batch)
    assert cursor2 == 3
    assert delivered2 == []


def test_events_after_sequence_ordering():
    rows = events_after_sequence(
        [
            {"sequence": 3, "action": "OK"},
            {"sequence": 1, "action": "STARTED"},
            {"sequence": 2, "action": "FILL"},
        ],
        after_sequence=0,
    )
    assert [r["sequence"] for r in rows] == [1, 2, 3]


def test_close_signal_missing_is_noop(tmp_path):
    profile = tmp_path / "run-a"
    profile.mkdir()
    changed, meta = process_close_signal(profile)
    assert changed is False
    assert meta == {}


def test_close_signal_marks_session_closed_and_consumes(tmp_path):
    profile = tmp_path / "run-b"
    profile.mkdir()
    write_session_meta(profile, {"run_id": "run-b", "status": "ACTIVE", "keep_open": True})
    (profile / "close.signal").write_text("now", encoding="utf-8")
    changed, meta = process_close_signal(profile)
    assert changed is True
    assert meta["status"] == "CLOSED"
    assert not close_signal_present(profile)


def test_repeated_close_is_idempotent(tmp_path):
    profile = tmp_path / "run-c"
    profile.mkdir()
    mark_session_closed(profile, extra={"run_id": "run-c"})
    (profile / "close.signal").write_text("again", encoding="utf-8")
    changed, meta = process_close_signal(profile)
    assert changed is True
    assert meta["status"] == "CLOSED"
    assert not close_signal_present(profile)


def test_registry_close_session():
    register_session(
        LiveBrowserSession(
            meta=LiveBrowserSessionMeta(
                run_id="run-x",
                browser_session_id="live-run-x",
                profile_dir="/tmp/profile",
            )
        )
    )
    assert close_session("run-x") is True


def test_dry_run_not_live(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("QA_RUN_MODE", "DRY_RUN")
    cfg = load_live_browser_config()
    assert cfg.run_mode == "DRY_RUN"


def test_parameter_traceability_rate_empty():
    assert compute_parameter_traceability_rate([]) is None
