#!/usr/bin/env python3
"""Scheduled crawl — run independently of chat intent (post-deploy / nightly cron).

Usage:
  PYTHONPATH=services/agent-runtime:services/qa-orchestrator:. \\
  QA_DISCOVERY_ROOT=data/discovery-kb \\
  python scripts/scheduled_crawl.py

Env:
  QA_CRAWL_MAX_PAGES=60       — page budget (default 60)
  QA_CRAWL_DRY_RUN=false      — set true for CI without browser
  QA_CRAWL_HEADLESS=true
  EA_BASE_URL / EA_USERNAME / EA_PASSWORD — UAT credentials
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for entry in (
    ROOT / "services" / "agent-runtime",
    ROOT / "services" / "qa-orchestrator",
    ROOT,
):
    s = str(entry)
    if s not in sys.path:
        sys.path.insert(0, s)

from plugins.qa_apex.crawler.engine import ApexCrawler, CrawlConfig
from plugins.qa_apex.crawler.persistence import (
    build_snapshot,
    coverage_metrics,
    diff_snapshots,
    diff_suggestions,
    load_latest_snapshot,
    save_snapshot,
)
from plugins.qa_apex.crawler.seeds import load_kb_seed_urls
from repo_paths import discovery_root


def main() -> int:
    root = discovery_root()
    os.environ.setdefault("QA_DISCOVERY_ROOT", str(root))
    dry = os.environ.get("QA_CRAWL_DRY_RUN", "").lower() in {"1", "true", "yes"}
    max_pages = int(os.environ.get("QA_CRAWL_MAX_PAGES", "60"))
    base = os.environ.get("EA_BASE_URL", "https://dev-ea.titanrts.com").rstrip("/")
    login = os.environ.get("EA_LOGIN_URL", "/ords/r/tjdcom/ea/login")
    seed = login if login.startswith("http") else f"{base}{login if login.startswith('/') else '/' + login}"
    priority = load_kb_seed_urls(root)

    report = ApexCrawler(
        config=CrawlConfig(
            seed_url=seed,
            priority_urls=tuple(priority),
            max_pages=max_pages,
            dry_run=dry,
            headless=os.environ.get("QA_CRAWL_HEADLESS", "true").lower() != "false",
        )
    ).run()

    report_dict = report.to_dict()
    snapshot = build_snapshot(report_dict)
    previous = load_latest_snapshot(root)
    diff = diff_snapshots(previous, snapshot)
    save_snapshot(root, snapshot)
    coverage = coverage_metrics(root, report_dict)
    suggestions = diff_suggestions(diff)
    suggestions.append(str(coverage.get("coverage_note", "")))

    out_dir = ROOT / "artifacts" / "crawl_report"
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "ok": report.ok,
        "mode": report.mode,
        "stats": report.stats,
        "diff": diff,
        "coverage": coverage,
        "suggestions": suggestions,
        "priority_seeds": len(priority),
    }
    (out_dir / "latest.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
