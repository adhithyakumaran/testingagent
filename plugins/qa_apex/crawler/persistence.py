"""Crawl snapshot persistence and diffing for change detection."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _snapshot_dir(discovery_root: Path) -> Path:
    d = discovery_root / "crawl_snapshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _page_signature(page: dict[str, Any]) -> str:
    raw = "|".join(
        [
            str(page.get("key") or page.get("url") or ""),
            str(page.get("page_alias") or ""),
            str(page.get("title") or "")[:80],
            str(page.get("body_excerpt") or "")[:200],
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def build_snapshot(report: dict[str, Any]) -> dict[str, Any]:
    pages = report.get("pages") or []
    signatures = {str(p.get("key") or p.get("url")): _page_signature(p) for p in pages if p.get("key") or p.get("url")}
    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "mode": report.get("mode"),
        "stats": report.get("stats"),
        "pages": pages,
        "flows": report.get("flows") or [],
        "signatures": signatures,
        "page_keys": sorted(signatures.keys()),
    }


def load_latest_snapshot(discovery_root: Path) -> dict[str, Any] | None:
    snap_dir = _snapshot_dir(discovery_root)
    files = sorted(snap_dir.glob("snapshot_*.json"), reverse=True)
    if not files:
        return None
    try:
        return json.loads(files[0].read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def save_snapshot(discovery_root: Path, snapshot: dict[str, Any]) -> Path:
    snap_dir = _snapshot_dir(discovery_root)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = snap_dir / f"snapshot_{stamp}.json"
    path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    latest = snap_dir / "latest.json"
    latest.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    return path


def diff_snapshots(previous: dict[str, Any] | None, current: dict[str, Any]) -> dict[str, Any]:
    if not previous:
        return {
            "is_first_run": True,
            "new_pages": current.get("page_keys") or [],
            "removed_pages": [],
            "changed_pages": [],
            "unchanged_count": len(current.get("page_keys") or []),
        }

    prev_sigs = previous.get("signatures") or {}
    curr_sigs = current.get("signatures") or {}
    prev_keys = set(prev_sigs.keys())
    curr_keys = set(curr_sigs.keys())

    new_pages = sorted(curr_keys - prev_keys)
    removed_pages = sorted(prev_keys - curr_keys)
    changed_pages = sorted(k for k in curr_keys & prev_keys if prev_sigs.get(k) != curr_sigs.get(k))

    return {
        "is_first_run": False,
        "previous_at": previous.get("captured_at"),
        "new_pages": new_pages,
        "removed_pages": removed_pages,
        "changed_pages": changed_pages,
        "unchanged_count": len(curr_keys & prev_keys) - len(changed_pages),
    }


def coverage_metrics(discovery_root: Path, report: dict[str, Any]) -> dict[str, Any]:
    """Estimate KB flow reachability from crawl page aliases."""
    index_path = discovery_root / "flows" / "index.yaml"
    ready_ids: list[str] = []
    if index_path.exists():
        try:
            import yaml

            data = yaml.safe_load(index_path.read_text(encoding="utf-8"))
            ready_ids = list(dict.fromkeys(data.get("sme_ready") or []))
        except Exception:
            pass

    ready_count = len(ready_ids) or 19
    aliases = {str(p.get("page_alias")).lower() for p in (report.get("pages") or []) if p.get("page_alias")}

    matched = 0
    try:
        import yaml

        flows_dir = discovery_root / "flows"
        for fid in ready_ids:
            meta_path = flows_dir / f"{fid}.yaml"
            if not meta_path.exists():
                continue
            doc = yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}
            pages = [str(p).lower() for p in (doc.get("pages") or [])]
            entry = str((doc.get("entry_point") or {}).get("page") or "").lower()
            if entry and entry in aliases:
                matched += 1
                continue
            if any(p in aliases for p in pages):
                matched += 1
    except Exception:
        matched = 0

    pct = round(100 * matched / ready_count, 1) if ready_count else 0.0
    return {
        "pages_crawled": len(report.get("pages") or []),
        "unique_aliases": len(aliases),
        "ready_flows_in_kb": ready_count,
        "flows_matched_by_alias": matched,
        "coverage_percent": pct,
        "coverage_note": (
            f"Crawl coverage: {matched}/{ready_count} READY flows ({pct}%) matched by page alias — "
            f"{len(aliases)} unique aliases observed"
        ),
    }


def diff_suggestions(diff: dict[str, Any]) -> list[str]:
    out: list[str] = []
    if diff.get("is_first_run"):
        out.append("First crawl snapshot saved — future runs will diff against this baseline.")
        return out
    if diff.get("new_pages"):
        out.append(f"NEW pages detected ({len(diff['new_pages'])}): {', '.join(diff['new_pages'][:8])} — review for new BF-* flows.")
    if diff.get("removed_pages"):
        out.append(f"REMOVED pages ({len(diff['removed_pages'])}): possible deprecation or nav change.")
    if diff.get("changed_pages"):
        out.append(
            f"CHANGED DOM signatures ({len(diff['changed_pages'])}): {', '.join(diff['changed_pages'][:6])} — "
            "locators or UI may need SME review."
        )
    if not any([diff.get("new_pages"), diff.get("removed_pages"), diff.get("changed_pages")]):
        out.append("No structural changes vs last crawl snapshot.")
    return out
