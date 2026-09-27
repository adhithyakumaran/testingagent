"""Live interactive browser execution configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LiveBrowserConfig:
    run_mode: str
    live_browser: bool
    headless: bool
    keep_browser_open: bool
    browser_channel: str
    action_delay_ms: int
    live_timeout_ms: int
    base_url: str

    @property
    def is_live(self) -> bool:
        return self.run_mode in {"LIVE", "LIVE_DEMO"} or self.live_browser

    @property
    def is_live_demo(self) -> bool:
        return self.run_mode == "LIVE_DEMO"

    @property
    def is_dry_run(self) -> bool:
        return self.run_mode == "DRY_RUN" or os.environ.get("QA_RUNNER", "").lower() in {
            "dry_run",
            "dry-run",
            "mock",
        }


def _truthy(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


def load_live_browser_config() -> LiveBrowserConfig:
    run_mode = (os.environ.get("QA_RUN_MODE") or "CI").strip().upper()
    live_browser = _truthy("QA_LIVE_BROWSER") or run_mode in {"LIVE", "LIVE_DEMO"}

    if run_mode == "CI":
        headless = True
        keep_open = False
        channel = "chromium"
        delay = 0
    elif run_mode == "DRY_RUN":
        headless = True
        keep_open = False
        channel = "chromium"
        delay = 0
    elif run_mode == "LIVE_DEMO":
        headless = False
        # Normal Ask Agent QA runs close the browser once after the full run.
        # Set QA_KEEP_BROWSER_OPEN=true only for live inspection / debugging.
        keep_open = _truthy("QA_KEEP_BROWSER_OPEN", "false")
        channel = os.environ.get("QA_BROWSER_CHANNEL", "chrome")
        delay = int(os.environ.get("QA_LIVE_ACTION_DELAY_MS", "500") or "500")
    elif run_mode == "LIVE":
        headless = _truthy("QA_BROWSER_HEADLESS", "false")
        keep_open = _truthy("QA_KEEP_BROWSER_OPEN", "false")
        channel = os.environ.get("QA_BROWSER_CHANNEL", "chrome")
        delay = int(os.environ.get("QA_LIVE_ACTION_DELAY_MS", "0") or "0")
    else:
        headless = _truthy("QA_BROWSER_HEADLESS", "true")
        keep_open = _truthy("QA_KEEP_BROWSER_OPEN", "false")
        channel = os.environ.get("QA_BROWSER_CHANNEL", "chromium")
        delay = int(os.environ.get("QA_LIVE_ACTION_DELAY_MS", "0") or "0")

    if live_browser and run_mode not in {"CI", "DRY_RUN"}:
        headless = _truthy("QA_BROWSER_HEADLESS", "false" if run_mode in {"LIVE", "LIVE_DEMO"} else "true")

    timeout_ms = int(os.environ.get("QA_LIVE_BROWSER_TIMEOUT_MS", "3600000") or "3600000")
    base_url = (os.environ.get("EA_BASE_URL") or "").strip()

    return LiveBrowserConfig(
        run_mode=run_mode,
        live_browser=live_browser,
        headless=headless,
        keep_browser_open=keep_open,
        browser_channel=channel,
        action_delay_ms=max(0, delay),
        live_timeout_ms=max(60_000, timeout_ms),
        base_url=base_url,
    )


def run_profile_dir(run_id: str) -> str:
    root = Path(os.environ.get("QA_AUTOMATION_DIR", "apps/automation"))
    repo = root
    for parent in [root, *root.parents]:
        if (parent / "reports").exists():
            repo = parent
            break
    profile = repo / "reports" / "browser-profiles" / run_id
    profile.mkdir(parents=True, exist_ok=True)
    return str(profile.resolve())


def events_path(run_id: str) -> str:
    root = Path(os.environ.get("QA_AUTOMATION_DIR", "apps/automation"))
    repo = root
    for parent in [root, *root.parents]:
        if (parent / "reports").exists():
            repo = parent
            break
    events_dir = repo / "reports" / "live-events"
    events_dir.mkdir(parents=True, exist_ok=True)
    return str((events_dir / f"{run_id}.jsonl").resolve())


def apply_live_browser_env(cfg: LiveBrowserConfig, env: dict[str, str], *, run_id: str) -> dict[str, str]:
    out = dict(env)
    out["QA_RUN_MODE"] = cfg.run_mode
    out["QA_LIVE_BROWSER"] = "true" if cfg.is_live else "false"
    out["QA_BROWSER_HEADLESS"] = "false" if not cfg.headless else "true"
    out["EA_HEADLESS"] = "false" if not cfg.headless else "true"
    out["QA_KEEP_BROWSER_OPEN"] = "true" if cfg.keep_browser_open else "false"
    out["QA_BROWSER_CHANNEL"] = cfg.browser_channel
    out["EA_BROWSER_CHANNEL"] = cfg.browser_channel
    out["QA_LIVE_ACTION_DELAY_MS"] = str(cfg.action_delay_ms)
    out["QA_LIVE_PROFILE_DIR"] = run_profile_dir(run_id)
    out["QA_LIVE_EVENTS_PATH"] = events_path(run_id)
    if cfg.base_url:
        out.setdefault("EA_BASE_URL", cfg.base_url)
    return out


def require_live_environment(cfg: LiveBrowserConfig) -> str | None:
    if not cfg.is_live:
        return None
    if not cfg.base_url:
        return "LIVE_ENV_BLOCKED: EA_BASE_URL is not configured"
    return None


def apply_run_mode_to_environ(mode: str) -> None:
    mode = (mode or "CI").strip().upper()
    os.environ["QA_RUN_MODE"] = mode
    cfg = load_live_browser_config()
    os.environ["QA_LIVE_BROWSER"] = "true" if cfg.is_live else "false"
    os.environ["QA_BROWSER_HEADLESS"] = "false" if not cfg.headless else "true"
    os.environ["EA_HEADLESS"] = "false" if not cfg.headless else "true"
    os.environ["QA_KEEP_BROWSER_OPEN"] = "true" if cfg.keep_browser_open else "false"
    os.environ["QA_BROWSER_CHANNEL"] = cfg.browser_channel
    os.environ["EA_BROWSER_CHANNEL"] = cfg.browser_channel
    os.environ["QA_LIVE_ACTION_DELAY_MS"] = str(cfg.action_delay_ms)
    if mode == "DRY_RUN":
        os.environ["QA_RUNNER"] = "dry_run"
    elif cfg.is_live:
        os.environ["QA_RUNNER"] = "playwright"
