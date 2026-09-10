from __future__ import annotations

import os
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any, Callable
from urllib.parse import urlparse

from plugins.qa_apex.crawler.apex_waits import dismiss_modal_if_present, wait_for_ajax, wait_settle
from plugins.qa_apex.crawler.selectors import (
    absolutize,
    is_skippable_path,
    normalize_page_key,
    parse_apex_url,
    same_host,
    with_session,
)
from plugins.qa_apex.crawler.seeds import home_card_seed_urls
from plugins.qa_apex.crawler.session import SessionConfig, login_apex, session_from_env


@dataclass
class CrawlConfig:
    seed_url: str | None = None
    priority_urls: tuple[str, ...] = ()
    max_pages: int = 60
    same_url_limit: int = 1
    modal_timeout_ms: int = 3000
    navigation_timeout_ms: int = 45_000
    settle_ms: int = 1200
    ajax_timeout_ms: int = 8000
    allowed_apps: tuple[str, ...] = ("ea", "ea1", "gc")
    skip_external_hosts: bool = True
    headless: bool = True
    harvest_home_cards: bool = True
    user_agent: str = (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 BaseAgentCrawler/0.2"
    )
    dry_run: bool = False  # no browser — for unit/CI without target


@dataclass
class PageSnapshot:
    key: str
    url: str
    title: str
    app_alias: str | None
    page_alias: str | None
    workspace: str | None
    session: str | None
    links_found: int = 0
    body_excerpt: str = ""
    errors: list[str] = field(default_factory=list)
    modal_events: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class CrawlReport:
    ok: bool
    mode: str
    pages: list[dict[str, Any]] = field(default_factory=list)
    flows: list[dict[str, Any]] = field(default_factory=list)
    blockers: list[dict[str, Any]] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)
    apex: dict[str, Any] = field(default_factory=dict)
    rules: list[str] = field(default_factory=list)
    body_text: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ApexCrawler:
    """Bounded, anti-stuck APEX crawler.

    Guarantees:
    - Stops at max_pages
    - Visits each normalized page key at most same_url_limit times
    - Modal dismiss/skip within modal_timeout_ms
    - Never uses LLM
    - dry_run mode returns structured empty-ok report for CI
    """

    def __init__(self, config: CrawlConfig | None = None, session: SessionConfig | None = None) -> None:
        self.config = config or CrawlConfig()
        self.session = session if session is not None else session_from_env()

    def run(self, *, playwright_factory: Callable[[], Any] | None = None) -> CrawlReport:
        cfg = self.config
        if cfg.dry_run or not cfg.seed_url and self.session is None:
            return CrawlReport(
                ok=True,
                mode="dry_run",
                stats={"pages": 0, "skipped": 0, "reason": "dry_run_or_no_seed"},
                rules=["rule.budget.max_pages", "rule.anti_stuck.same_url"],
                apex={"notes": ["dry_run — no browser launched"]},
            )

        seed = cfg.seed_url or (self.session.login_url if self.session else None)
        if not seed:
            return CrawlReport(ok=False, mode="live", blockers=[{"reason": "crawl.no_seed"}])

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return CrawlReport(
                ok=False,
                mode="live",
                blockers=[{"reason": "crawl.playwright_missing"}],
                rules=["rule.budget.max_pages"],
            )

        started = time.monotonic()
        visited: dict[str, int] = {}
        pages: list[PageSnapshot] = []
        blockers: list[dict[str, Any]] = []
        queue: deque[str] = deque()
        priority_seeds = list(cfg.priority_urls)
        current_session: str | None = None
        host = urlparse(seed).hostname

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=cfg.headless)
            context = browser.new_context(user_agent=cfg.user_agent)
            page = context.new_page()
            page.set_default_navigation_timeout(cfg.navigation_timeout_ms)

            if self.session:
                login_result = login_apex(page, self.session)
                if not login_result.get("ok"):
                    browser.close()
                    return CrawlReport(
                        ok=False,
                        mode="live",
                        blockers=[{"reason": login_result.get("reason"), "url": login_result.get("url")}],
                        stats={"elapsed_ms": int((time.monotonic() - started) * 1000)},
                    )
                current_session = login_result.get("session")
                queue.append(page.url)
            else:
                queue.append(seed)

            for purl in priority_seeds:
                queue.appendleft(with_session(purl, current_session) if current_session else purl)

            home_cards_harvested = False

            while queue and len(pages) < cfg.max_pages:
                url = queue.popleft()
                key = normalize_page_key(url)
                if visited.get(key, 0) >= cfg.same_url_limit:
                    continue
                visited[key] = visited.get(key, 0) + 1

                parsed = parse_apex_url(url)
                if cfg.skip_external_hosts and host and not same_host(url, f"https://{host}/"):
                    blockers.append({"reason": "skip.external_host", "url": url})
                    continue
                if parsed.app_alias and parsed.app_alias.lower() not in {a.lower() for a in cfg.allowed_apps}:
                    # Allow login pages without app filter when path odd
                    if parsed.page_alias and parsed.page_alias.lower() != "login":
                        blockers.append({"reason": "skip.app_not_allowed", "url": url, "app": parsed.app_alias})
                        continue

                snap = self._visit(page, url, current_session)
                if snap.session:
                    current_session = snap.session
                pages.append(snap)

                if (
                    cfg.harvest_home_cards
                    and not home_cards_harvested
                    and snap.page_alias
                    and snap.page_alias.lower() == "home"
                ):
                    home_cards_harvested = True
                    try:
                        card_hrefs = page.eval_on_selector_all(
                            "a.custom-card-wrap[href], a.t-Card-wrap[href], li.t-Cards-item a[href]",
                            "els => els.map(e => e.getAttribute('href'))",
                        )
                        for card_url in home_card_seed_urls(page.url, card_hrefs or []):
                            nkey = normalize_page_key(card_url)
                            if visited.get(nkey, 0) < cfg.same_url_limit:
                                queue.appendleft(
                                    with_session(card_url, current_session) if current_session else card_url
                                )
                    except Exception:
                        pass

                # Extract links (anchors + APEX navigation buttons)
                try:
                    hrefs = page.eval_on_selector_all(
                        "a[href], button[data-url], [data-link]",
                        """els => els.map(e => e.getAttribute('href') || e.getAttribute('data-url') || e.getAttribute('data-link'))""",
                    )
                except Exception:
                    hrefs = []
                snap.links_found = len(hrefs or [])
                for href in hrefs or []:
                    abs_url = absolutize(page.url, href)
                    if not abs_url:
                        continue
                    if is_skippable_path(abs_url):
                        continue
                    if cfg.skip_external_hosts and host and not same_host(abs_url, f"https://{host}/"):
                        continue
                    nkey = normalize_page_key(abs_url)
                    if visited.get(nkey, 0) >= cfg.same_url_limit:
                        continue
                    if len(pages) + len(queue) >= cfg.max_pages * 4:
                        break
                    # Prefer session-bearing navigation target
                    queue.append(with_session(abs_url, current_session) if current_session else abs_url)

            browser.close()

        # Build candidate flow edges from sequential page aliases
        flows = []
        aliases = [p.page_alias for p in pages if p.page_alias]
        if len(aliases) >= 2:
            flows.append(
                {
                    "id": "candidate.crawl_path",
                    "name": "crawl_observed_path",
                    "steps": [{"page": a, "action": "visit"} for a in aliases[:20]],
                    "source": "live_crawl",
                }
            )

        body_bits = " ".join(p.body_excerpt for p in pages)
        return CrawlReport(
            ok=True,
            mode="live",
            pages=[asdict(p) for p in pages],
            flows=flows,
            blockers=blockers,
            stats={
                "pages": len(pages),
                "visited_keys": len(visited),
                "blockers": len(blockers),
                "truncated": len(pages) >= cfg.max_pages,
                "elapsed_ms": int((time.monotonic() - started) * 1000),
                "queue_remaining": len(queue),
                "priority_seeds": len(priority_seeds),
                "home_cards_harvested": home_cards_harvested,
            },
            apex={
                "workspace": next((p.workspace for p in pages if p.workspace), None),
                "apps": sorted({p.app_alias for p in pages if p.app_alias}),
                "session_captured": bool(current_session),
                "notes": [
                    "Prefer click navigation to preserve session",
                    "Append session on explicit goto",
                    "Wait for wwv_flow.ajax on LOVs/IG",
                    "Modal timeout then dismiss — never hang",
                ],
            },
            rules=[
                "rule.session.required",
                "rule.friendly_url.parse",
                "rule.budget.max_pages",
                "rule.anti_stuck.same_url",
                "rule.anti_stuck.modal_timeout",
            ],
            body_text=body_bits[:4000],
        )

    def _visit(self, page: Any, url: str, session: str | None) -> PageSnapshot:
        cfg = self.config
        target = with_session(url, session) if session else url
        errors: list[str] = []
        modal_events: list[dict[str, Any]] = []
        try:
            page.goto(target, wait_until="domcontentloaded")
            wait_for_ajax(page, timeout_ms=cfg.ajax_timeout_ms)
            wait_settle(page, settle_ms=cfg.settle_ms)
            modal = dismiss_modal_if_present(page, timeout_ms=cfg.modal_timeout_ms)
            if modal.get("found"):
                modal_events.append(modal)
        except Exception as exc:
            errors.append(f"nav:{type(exc).__name__}:{exc}")
        parsed = parse_apex_url(page.url)
        title = ""
        excerpt = ""
        try:
            title = page.title() or ""
            excerpt = (page.inner_text("body") or "")[:500]
        except Exception as exc:
            errors.append(f"read:{type(exc).__name__}")
        # Technical error signals
        low = excerpt.lower()
        if "ora-" in low or "apex error" in low or "unexpected error" in low:
            errors.append("apex.error_page")
        return PageSnapshot(
            key=normalize_page_key(page.url or target),
            url=page.url or target,
            title=title,
            app_alias=parsed.app_alias,
            page_alias=parsed.page_alias,
            workspace=parsed.workspace,
            session=parsed.session or session,
            body_excerpt=excerpt,
            errors=errors,
            modal_events=modal_events,
        )
