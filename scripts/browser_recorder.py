#!/usr/bin/env python3
"""ScoutAI Browser Recorder — real-time suite-authoring capture (locators, DOM, metadata)."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from repo_paths import discovery_root
except ImportError:
    discovery_root = lambda: ROOT / "data" / "discovery-kb"  # type: ignore[misc,assignment]


INTERACTION_INIT_SCRIPT = """
(() => {
  if (window.__scoutRecorderInstalled) return;
  window.__scoutRecorderInstalled = true;

  const pick = (el, name) => (el && el.getAttribute ? el.getAttribute(name) : null) || '';

  const collectElement = (el) => {
    if (!el || el.nodeType !== 1) return { tag: 'unknown', attributes: {}, locators: {}, text: '' };
    const tag = (el.tagName || 'node').toLowerCase();
    const attrs = {};
    for (const name of ['id', 'name', 'type', 'role', 'aria-label', 'data-testid', 'placeholder', 'href', 'title', 'class']) {
      const v = pick(el, name);
      if (v) attrs[name] = String(v).slice(0, 200);
    }
    const text = (el.innerText || el.textContent || '').trim().slice(0, 120);
    const locators = {};
    if (el.id) {
      locators.id = '#' + el.id;
      if (el.id.startsWith('P')) locators.apexItem = '#' + el.id;
    }
    if (pick(el, 'name')) locators.name = `[name="${pick(el, 'name')}"]`;
    if (pick(el, 'data-testid')) locators.testId = `[data-testid="${pick(el, 'data-testid')}"]`;
    if (pick(el, 'role')) locators.role = `[role="${pick(el, 'role')}"]`;
    if (pick(el, 'aria-label')) locators.ariaLabel = `[aria-label="${pick(el, 'aria-label')}"]`;
    if (text) locators.text = `${tag}:has-text("${text.slice(0, 40).replace(/"/g, "'")}")`;
    if (pick(el, 'placeholder')) locators.placeholder = `[placeholder="${pick(el, 'placeholder')}"]`;
    const classList = Array.from(el.classList || []).slice(0, 10);
    if (classList.length) locators.class = tag + '.' + classList.slice(0, 3).join('.');
    return {
      tag,
      attributes: attrs,
      text,
      classList,
      locators,
      outerHTML: (el.outerHTML || '').slice(0, 1200),
    };
  };

  const emit = (action, el, extra) => {
    const element = collectElement(el);
    const payload = { action, element, selector: element.locators.id || element.locators.name || element.tag, ...extra };
    if (action === 'click' && window._scoutRecordClick) window._scoutRecordClick(payload);
    else if (window._scoutRecordInput) window._scoutRecordInput(payload);
  };

  document.addEventListener('click', (e) => emit('click', e.target, {}), true);
  document.addEventListener('input', (e) => emit('input', e.target, { valueLength: (e.target.value || '').length }), true);
  document.addEventListener('change', (e) => emit('change', e.target, {}), true);
})();
"""


def _session_dir(session_id: str) -> Path:
    base = discovery_root() / "recordings" / "sessions"
    d = base / session_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _stop_flag(session_id: str) -> Path:
    return _session_dir(session_id) / "stop.flag"


def _load_config(session_id: str) -> dict[str, Any]:
    cfg_path = _session_dir(session_id) / "config.json"
    if cfg_path.exists():
        return json.loads(cfg_path.read_text(encoding="utf-8"))
    return {
        "console": False,
        "network": False,
        "interactions": True,
        "dom_snapshots": True,
        "video": False,
        "session_replay": False,
    }


def _save_config(session_id: str, cfg: dict[str, Any]) -> None:
    (_session_dir(session_id) / "config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def _write_status(session_id: str, payload: dict[str, Any]) -> None:
    (_session_dir(session_id) / "status.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _append_event(session_id: str, event: dict[str, Any]) -> None:
    path = _session_dir(session_id) / "events.jsonl"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def cmd_status(session_id: str) -> dict[str, Any]:
    status_path = _session_dir(session_id) / "status.json"
    if status_path.exists():
        return json.loads(status_path.read_text(encoding="utf-8"))
    return {"session_id": session_id, "status": "idle", "events": 0}


def cmd_configure(session_id: str, cfg: dict[str, Any]) -> dict[str, Any]:
    merged = {**_load_config(session_id), **cfg}
    _save_config(session_id, merged)
    return merged


def cmd_events(session_id: str, *, offset: int = 0) -> dict[str, Any]:
    path = _session_dir(session_id) / "events.jsonl"
    if not path.exists():
        return {"events": [], "offset": offset, "total": 0}
    lines = path.read_text(encoding="utf-8").splitlines()
    slice_lines = lines[offset:]
    events = [json.loads(line) for line in slice_lines if line.strip()]
    return {"events": events, "offset": offset + len(events), "total": len(lines)}


def cmd_stop(session_id: str) -> dict[str, Any]:
    sdir = _session_dir(session_id)
    _stop_flag(session_id).write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    status = cmd_status(session_id)
    if status.get("status") == "recording":
        status["stop_requested_at"] = datetime.now(timezone.utc).isoformat()
        _write_status(session_id, status)
    return {"ok": True, "session_id": session_id, "status": "stop_requested", "dir": str(sdir.relative_to(ROOT))}


def _should_stop(session_id: str) -> bool:
    return _stop_flag(session_id).exists()


def _run_session(session_id: str, *, url: str | None = None, max_seconds: int = 3600) -> dict[str, Any]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        return {"ok": False, "error": f"playwright not installed: {exc}"}

    cfg = _load_config(session_id)
    sdir = _session_dir(session_id)
    base = os.environ.get("EA_BASE_URL", "https://dev-ea.titanrts.com/ords/r/tjdcom/ea")
    target = url or f"{base.rstrip('/')}/login"

    events_path = sdir / "events.jsonl"
    if events_path.exists():
        events_path.unlink()
    stop_path = _stop_flag(session_id)
    if stop_path.exists():
        stop_path.unlink()

    elements_dir = sdir / "elements"
    elements_dir.mkdir(parents=True, exist_ok=True)
    dom_dir = sdir / "dom"
    dom_dir.mkdir(parents=True, exist_ok=True)

    event_count = 0
    element_count = 0
    dom_index = 0

    def log_event(kind: str, payload: dict[str, Any]) -> None:
        nonlocal event_count
        event_count += 1
        event = {"id": event_count, "at": datetime.now(timezone.utc).isoformat(), "kind": kind, **payload}
        _append_event(session_id, event)

    status = {
        "session_id": session_id,
        "status": "recording",
        "pid": os.getpid(),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "target_url": target,
        "config": cfg,
        "events": 0,
    }
    _write_status(session_id, status)

    def persist_element(action: str, meta: dict[str, Any]) -> None:
        nonlocal element_count, dom_index
        element = meta.get("element") or {}
        if not cfg.get("dom_snapshots"):
            return
        element_count += 1
        dom_index += 1
        stem = f"{action}_{element_count:04d}"
        elem_path = elements_dir / f"{stem}.json"
        elem_path.write_text(json.dumps(element, indent=2, ensure_ascii=False), encoding="utf-8")
        html_path = dom_dir / f"{stem}.html"
        html_path.write_text(str(element.get("outerHTML") or ""), encoding="utf-8")
        meta["element_file"] = elem_path.name
        meta["dom_file"] = html_path.name
        meta["dom_index"] = dom_index

    def on_click(_src, payload: Any) -> None:
        meta = payload if isinstance(payload, dict) else {"selector": str(payload)}
        persist_element("click", meta)
        log_event("interaction", meta)

    def on_input(_src, payload: Any) -> None:
        meta = payload if isinstance(payload, dict) else {"selector": str(payload)}
        persist_element(str(meta.get("action") or "input"), meta)
        log_event("interaction", meta)

    with sync_playwright() as pw:
        channel = "chrome" if os.environ.get("EA_USE_SYSTEM_CHROME", "true").lower() != "false" else None
        headless = os.environ.get("EA_HEADLESS", "false").lower() == "true"
        browser = pw.chromium.launch(headless=headless, channel=channel)
        context = browser.new_context()
        page = context.new_page()

        if cfg.get("interactions"):
            page.add_init_script(INTERACTION_INIT_SCRIPT)
            page.expose_binding("_scoutRecordClick", on_click)
            page.expose_binding("_scoutRecordInput", on_input)

        if cfg.get("console"):
            page.on("console", lambda msg: log_event("console", {"level": msg.type, "text": msg.text[:300]}))

        if cfg.get("network"):
            page.on(
                "request",
                lambda req: log_event("network", {"phase": "request", "url": req.url[:200], "method": req.method}),
            )

        def on_nav(frame) -> None:
            nonlocal dom_index
            if frame != page.main_frame:
                return
            try:
                log_event(
                    "navigation",
                    {
                        "url": page.url,
                        "title": page.title(),
                        "page_alias": _page_alias(page.url),
                    },
                )
                if cfg.get("dom_snapshots"):
                    dom_index += 1
                    dom_path = dom_dir / f"nav_{dom_index:04d}.html"
                    dom_path.write_text(page.content(), encoding="utf-8")
                    log_event(
                        "dom_snapshot",
                        {"reason": "navigation", "dom_file": dom_path.name, "url": page.url, "title": page.title()},
                    )
            except Exception as exc:
                log_event("error", {"phase": "navigation", "message": str(exc)[:200]})

        page.on("framenavigated", on_nav)

        page.goto(target, wait_until="domcontentloaded", timeout=60_000)
        log_event("session_start", {"url": page.url, "title": page.title(), "target": target})

        if cfg.get("dom_snapshots"):
            dom_index += 1
            dom_path = dom_dir / f"initial_{dom_index:04d}.html"
            dom_path.write_text(page.content(), encoding="utf-8")
            log_event("dom_snapshot", {"reason": "initial", "dom_file": dom_path.name, "url": page.url})

        deadline = time.time() + max_seconds
        while time.time() < deadline and not _should_stop(session_id):
            status["events"] = event_count
            _write_status(session_id, status)
            time.sleep(0.15)

        context.close()
        browser.close()

    final_status = "stopped" if _should_stop(session_id) else "completed"
    if stop_path.exists():
        stop_path.unlink(missing_ok=True)

    log_event("session_end", {"status": final_status, "events": event_count, "elements": element_count})

    status.update(
        {
            "status": final_status,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "events": event_count,
            "elements_captured": element_count,
            "events_file": "events.jsonl",
            "dir": str(sdir.relative_to(ROOT)),
        }
    )
    _write_status(session_id, status)
    return {"ok": True, "session_id": session_id, "status": final_status, "events": event_count}


def _page_alias(url: str) -> str:
    try:
        from plugins.qa_apex.crawler.selectors import parse_apex_url

        parsed = parse_apex_url(url)
        return str(parsed.page_alias or "")
    except Exception:
        return ""


def cmd_start(session_id: str, *, url: str | None = None, max_seconds: int = 3600) -> dict[str, Any]:
    current = cmd_status(session_id)
    if current.get("status") == "recording":
        return {"ok": False, "error": "session_already_recording", "session_id": session_id}
    return _run_session(session_id, url=url, max_seconds=max_seconds)


def cmd_record(session_id: str, *, url: str | None = None, max_seconds: int = 120) -> dict[str, Any]:
    """Blocking record — kept for CLI backward compatibility."""
    return _run_session(session_id, url=url, max_seconds=max_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="ScoutAI Browser Recorder")
    parser.add_argument("command", choices=["status", "configure", "record", "start", "stop", "events"])
    parser.add_argument("--session-id", default="scout-default")
    parser.add_argument("--url", default=None)
    parser.add_argument("--max-seconds", type=int, default=3600)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--config-json", default="{}")
    args = parser.parse_args()

    if args.command == "status":
        result = cmd_status(args.session_id)
    elif args.command == "configure":
        cfg = json.loads(args.config_json or "{}")
        result = cmd_configure(args.session_id, cfg)
    elif args.command == "events":
        result = cmd_events(args.session_id, offset=args.offset)
    elif args.command == "stop":
        result = cmd_stop(args.session_id)
    elif args.command == "start":
        result = cmd_start(args.session_id, url=args.url, max_seconds=args.max_seconds)
    else:
        result = cmd_record(args.session_id, url=args.url, max_seconds=args.max_seconds)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
