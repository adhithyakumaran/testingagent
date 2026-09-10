"""KB-aware crawl seed URLs — prioritize known flow entry points before BFS discovery."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def _base_url() -> str:
    return os.environ.get("EA_BASE_URL", "https://dev-ea.titanrts.com").rstrip("/")


def _resolve_route(route: str, base: str) -> str:
    route = (route or "").strip()
    if not route:
        return ""
    if route.startswith("http"):
        return route
    if not route.startswith("/"):
        route = f"/{route}"
    return f"{base}{route}"


def load_kb_seed_urls(discovery_root: Path, *, flow_ids: list[str] | None = None) -> list[str]:
    """Collect entry_point routes from READY flow YAML files."""
    try:
        import yaml
    except ImportError:
        return []

    flows_dir = discovery_root / "flows"
    index_path = flows_dir / "index.yaml"
    if not index_path.exists():
        return []

    try:
        index = yaml.safe_load(index_path.read_text(encoding="utf-8")) or {}
    except Exception:
        return []

    targets = flow_ids or list(index.get("sme_ready") or [])
    base = _base_url()
    seeds: list[str] = []
    seen: set[str] = set()

    for fid in targets:
        meta_path = flows_dir / f"{fid}.yaml"
        if not meta_path.exists():
            continue
        try:
            doc = yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        route = (doc.get("entry_point") or {}).get("route")
        url = _resolve_route(str(route or ""), base)
        if url and url not in seen:
            seen.add(url)
            seeds.append(url)

    return seeds


def home_card_seed_urls(page_url: str, card_hrefs: list[str]) -> list[str]:
    """Normalize home navigation card hrefs into absolute crawl seeds."""
    from plugins.qa_apex.crawler.selectors import absolutize, is_skippable_path

    out: list[str] = []
    seen: set[str] = set()
    for href in card_hrefs:
        if not href or is_skippable_path(href):
            continue
        abs_url = absolutize(page_url, href)
        if abs_url and abs_url not in seen:
            seen.add(abs_url)
            out.append(abs_url)
    return out


def merge_seed_queues(priority: list[str], discovered: list[str]) -> list[str]:
    """Priority seeds first, then BFS discoveries — deduped."""
    out: list[str] = []
    seen: set[str] = set()
    for url in [*priority, *discovered]:
        if url and url not in seen:
            seen.add(url)
            out.append(url)
    return out
