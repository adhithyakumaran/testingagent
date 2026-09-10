from __future__ import annotations

import os
from typing import Any

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
from qa_orchestrator.flow_kb import YamlFlowKb
from qa_orchestrator.knowledge_graph import FlowKnowledgeGraph
from qa_orchestrator.models import DiscoveryResult, IntentClassification, SuiteSelectionPlan


class DiscoveryService:
    """Bounded APEX crawler for new_feature / discover modes — no LLM."""

    def __init__(
        self,
        graph: FlowKnowledgeGraph,
        *,
        dry_run: bool | None = None,
        max_pages: int = 25,
    ) -> None:
        self.graph = graph
        self.flow_kb: YamlFlowKb = graph.flow_kb
        env_dry = os.environ.get("QA_CRAWL_DRY_RUN", "").lower() in {"1", "true", "yes"}
        self.dry_run = dry_run if dry_run is not None else env_dry
        self.max_pages = max_pages

    def discover(
        self,
        intent: IntentClassification,
        suite_plan: SuiteSelectionPlan,
    ) -> DiscoveryResult:
        seed = self._seed_url(intent, suite_plan)
        max_pages = int(os.environ.get("QA_CRAWL_MAX_PAGES", str(self.max_pages)))
        priority = load_kb_seed_urls(
            self.graph.discovery_root,
            flow_ids=list(suite_plan.flow_ids or intent.flow_ids) or None,
        )
        cfg = CrawlConfig(
            seed_url=seed,
            priority_urls=tuple(priority),
            max_pages=max_pages,
            dry_run=self.dry_run or not seed,
            headless=os.environ.get("QA_CRAWL_HEADLESS", "true").lower() != "false",
            harvest_home_cards=os.environ.get("QA_CRAWL_HOME_CARDS", "true").lower() != "false",
        )
        report = ApexCrawler(config=cfg).run()
        report_dict = report.to_dict()
        snapshot = build_snapshot(report_dict)
        previous = load_latest_snapshot(self.graph.discovery_root)
        diff = diff_snapshots(previous, snapshot)
        save_snapshot(self.graph.discovery_root, snapshot)
        coverage = coverage_metrics(self.graph.discovery_root, report_dict)
        suggestions = self._suggestions(intent, report_dict, diff=diff, coverage=coverage)
        return DiscoveryResult(
            ok=bool(report.ok),
            mode=str(report.mode),
            pages_crawled=int((report.stats or {}).get("pages", 0)),
            seed_url=seed,
            suggestions=suggestions,
            report={**report_dict, "diff": diff, "coverage": coverage},
        )

    def _seed_url(self, intent: IntentClassification, suite_plan: SuiteSelectionPlan) -> str | None:
        overview = self.flow_kb.app_overview()
        base = os.environ.get("EA_BASE_URL", "https://dev-ea.titanrts.com")
        for fid in suite_plan.flow_ids or intent.flow_ids:
            meta = self.flow_kb.get(fid)
            if not meta:
                continue
            route = (meta.get("doc") or {}).get("entry_point", {}).get("route")
            if route:
                if route.startswith("http"):
                    return route
                return f"{base.rstrip('/')}{route}"
        login_route = overview.get("login_url", "/ords/r/tjdcom/ea/login")
        if login_route.startswith("http"):
            return login_route
        return f"{base.rstrip('/')}{login_route}"

    def _suggestions(
        self,
        intent: IntentClassification,
        report: dict[str, Any],
        *,
        diff: dict[str, Any] | None = None,
        coverage: dict[str, Any] | None = None,
    ) -> list[str]:
        suggestions: list[str] = []
        if diff:
            suggestions.extend(diff_suggestions(diff))
        if coverage:
            suggestions.append(str(coverage.get("coverage_note", "")))
        pages = report.get("pages") or []
        if pages:
            aliases = sorted({p.get("page_alias") for p in pages if p.get("page_alias")})
            if aliases:
                suggestions.append(
                    f"Crawl observed APEX pages: {', '.join(str(a) for a in aliases[:8])}. "
                    "Review for new KB flow entries or suite extensions."
                )
        errors = []
        for p in pages:
            errors.extend(p.get("errors") or [])
        if errors:
            suggestions.append(
                f"Technical signals during crawl ({len(errors)}): consider blocking defects before new tests."
            )
        if intent.execution_mode == "new_feature":
            for fid in intent.flow_ids[:3]:
                suggestions.append(
                    f"Proposed automation update for {fid}: extend "
                    f"apps/automation/test-design/flows/{fid}/test-cases.yaml with new UI scenario; "
                    f"generate Playwright spec apps/automation/tests/**/{fid}.spec.ts; SME approval required."
                )
            suggestions.append(
                "Draft pipeline: scenario → test case (P0/P1) → Playwright script with KB locators → "
                "per-flow suite.yaml → add @sanity tag after SME sign-off."
            )
            suggestions.append(
                "Use Browser Recorder (ScoutAI console) to capture DOM components, locators, and interaction "
                "paths — merge into data/discovery-kb/flows/ YAML before automation generation."
            )
        flows = report.get("flows") or []
        if flows:
            suggestions.append(
                "Candidate flow path captured from crawl — map to BF-* flow YAML when SME confirms."
            )
        if not suggestions and intent.execution_mode in {"new_feature", "discover"}:
            suggestions.append(
                "Run Browser Recorder session with DOM snapshots + interactions enabled to gather "
                "components for future script authoring."
            )
        return suggestions
