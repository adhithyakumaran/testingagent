"""Finalize live browser session after agent run state is persisted."""

from __future__ import annotations

from pathlib import Path

from qa_orchestrator.live_browser_close import mark_session_closed, read_session_meta
from qa_orchestrator.live_browser_config import load_live_browser_config, run_profile_dir


def finalize_live_browser_after_agent_run(
    run_id: str,
    *,
    keep_browser_open: bool | None = None,
) -> dict[str, object]:
    """
    Normal QA runs close the browser inside Playwright worker teardown.
    After journal/snapshot persistence, ensure session metadata reflects CLOSED
    when keep-open inspection mode is not enabled.
    """
    cfg = load_live_browser_config()
    keep = keep_browser_open if keep_browser_open is not None else cfg.keep_browser_open
    if keep or not cfg.is_live or not run_id:
        return read_session_meta(Path(run_profile_dir(run_id)))

    profile = Path(run_profile_dir(run_id))
    meta = mark_session_closed(profile, extra={"finalized_by": "orchestrator"})
    try:
        from qa_orchestrator.live_browser_events import get_event_store

        store = get_event_store(run_id)
        diag = meta.get("diagnostics") if isinstance(meta.get("diagnostics"), dict) else {}
        close_count = diag.get("browser_close_count", 1)
        store.emit(
            phase="BROWSER",
            action="CLOSE",
            status="OK",
            value_summary=f"automatic_teardown browser_close_count={close_count}",
        )
    except Exception:
        pass
    return meta
